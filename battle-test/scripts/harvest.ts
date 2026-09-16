/**
 * `harvest.ts` — collect what ACTUALLY happened (manual §5.4).
 *
 * Writes `registry/<test>.actual.json` from four sources, each named per field
 * so nothing in the report is "just known":
 *
 *   pool state, entrants, results root   the indexer's /pools (derived from
 *                                        the chain's own events)
 *   per-seat entries, refunded flags     the indexer's /pools/<pda>/entries
 *   balances                             read directly from the cluster
 *   register signatures and slots        our own enter.ts log
 *
 * It FAILS LOUDLY rather than writing partial data: a half-harvested file that
 * looks complete is worse than none, because the reconcile downstream would
 * silently compare against gaps.
 *
 * Run (from battle-test/):
 *   BLOTTO_BT_SEED=<hex> BLOTTO_RPC_URL=<url> npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/harvest.ts --test T1 --pool 14
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Connection, PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17');
const DEFAULT_INDEXER = 'https://blotto-indexer.fly.dev';

interface PoolView {
  pool: string; id: string; tier: number; entry_lamports: string; pot_lamports: string;
  state: string; entrants: number; results_root: string | null; secret: string | null;
  min_seats: number; fill_deadline: string; outcome_if_deadline_now: string;
}

interface EntryView {
  pool: string; player: string; idx: number; battles_hash: string; class: number;
  pass_asset: string; flagged: boolean; refunded: boolean; terms_version: number;
  next_place_lamports: string; sanctions_hold: boolean;
}

const flag = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const test = flag('test');
  const poolId = flag('pool');
  if (!test || !poolId) throw new Error('--test <T1> and --pool <id> are both required');
  const indexer = flag('indexer') ?? process.env.BLOTTO_INDEXER_URL ?? DEFAULT_INDEXER;
  const rpc = process.env.BLOTTO_RPC_URL ?? process.env.RPC_URL;
  if (!rpc) throw new Error('BLOTTO_RPC_URL is not set');

  const pools = (await (await fetch(`${indexer}/pools`)).json()) as PoolView[];
  const pool = pools.find((p) => String(p.id) === String(poolId));
  if (!pool) throw new Error(`pool ${poolId} is not in the indexer — refusing to write a partial harvest`);

  const entries = (await (await fetch(`${indexer}/pools/${pool.pool}/entries`)).json()) as EntryView[];
  if (entries.length !== pool.entrants) {
    throw new Error(
      `the indexer reports ${pool.entrants} entrants but returned ${entries.length} entries — ` +
      'refusing to write a partial harvest; re-run once it has caught up'
    );
  }

  // The roster turns addresses back into the identities the plan speaks in.
  const roster = JSON.parse(
    readFileSync(resolve(__dirname, '..', 'registry', 'wallets.json'), 'utf8')
  ) as { wallets: { id: string; address: string; kind: string }[] };
  const byAddress = new Map(roster.wallets.map((w) => [w.address, w]));

  // Our own log of what enter.ts sent, if this pool had headless seats.
  const evidenceDir = resolve(__dirname, '..', 'evidence', `${test}-pool-${pool.id}`);
  const logPath = resolve(evidenceDir, 'headless-register.log');
  const sigByWallet = new Map<string, { signature?: string; slot?: number }>();
  if (existsSync(logPath)) {
    for (const line of readFileSync(logPath, 'utf8').split('\n').filter(Boolean)) {
      try {
        const r = JSON.parse(line) as { wallet: string; signature?: string; slot?: number; ok: boolean };
        if (r.ok) sigByWallet.set(r.wallet, { signature: r.signature, slot: r.slot });
      } catch { /* a malformed line is not worth failing the harvest over */ }
    }
  }

  const connection = new Connection(rpc, { commitment: 'confirmed' });
  const keys = entries.map((e) => new PublicKey(e.player));

  // Seats enter.ts did not place — the founder's UI entries — have no line in
  // our log, but the chain has the answer: an Entry PDA is created by
  // `register` and by nothing else, so its OLDEST signature is that register.
  // Without this the report would carry evidence for the headless seats and a
  // dash for the human ones, which is the wrong way round.
  const poolKey = new PublicKey(pool.pool);
  const missing = entries.filter((e) => {
    const w = byAddress.get(e.player);
    return !w || !sigByWallet.has(w.id);
  });
  for (const e of missing) {
    const [entryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('entry'), poolKey.toBuffer(), new PublicKey(e.player).toBuffer()],
      PROGRAM_ID
    );
    try {
      const sigs = await connection.getSignaturesForAddress(entryPda, { limit: 20 }, 'confirmed');
      const landed = sigs.filter((x) => !x.err);
      const oldest = landed[landed.length - 1];
      if (oldest) {
        const w = byAddress.get(e.player);
        sigByWallet.set(w?.id ?? e.player, { signature: oldest.signature, slot: oldest.slot });
      }
    } catch {
      // A signature lookup that fails leaves the field null rather than
      // failing the harvest — the entry itself is already proven by the
      // indexer and the Entry account's existence.
    }
  }
  const [platform] = PublicKey.findProgramAddressSync([Buffer.from('platform')], PROGRAM_ID);
  const le = Buffer.alloc(8); le.writeBigUInt64LE(BigInt(pool.id));
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), le], PROGRAM_ID);

  const infos = await connection.getMultipleAccountsInfo([...keys, platform, vault], 'confirmed');
  const balanceOf = new Map<string, string>();
  entries.forEach((e, i) => balanceOf.set(e.player, String(infos[i]?.lamports ?? 0)));
  const treasuryLamports = String(infos[keys.length]?.lamports ?? 0);
  const vaultLamports = String(infos[keys.length + 1]?.lamports ?? 0);

  const seats = entries
    .sort((a, b) => a.idx - b.idx)
    .map((e) => {
      const w = byAddress.get(e.player);
      const sig = sigByWallet.get(w?.id ?? '');
      return {
        seat: e.idx,
        wallet: w?.id ?? `UNKNOWN(${e.player})`,
        route: w?.kind === 'ui' ? 'ui' : w?.kind === 'headless' ? 'direct' : 'unknown',
        address: e.player,
        battlesHash: e.battles_hash,
        passAsset: e.pass_asset,
        termsVersion: e.terms_version,
        flagged: e.flagged,
        refunded: e.refunded,
        sanctionsHold: e.sanctions_hold,
        nextPlaceLamports: e.next_place_lamports,
        registerSig: sig?.signature ?? null,
        slot: sig?.slot ?? null,
        balanceAfter: balanceOf.get(e.player) ?? null,
      };
    });

  const unknown = seats.filter((s) => s.wallet.startsWith('UNKNOWN'));

  const doc = {
    schema: 'blotto-rehearsal-actual/1',
    test,
    poolId: pool.id,
    poolPda: pool.pool,
    tier: pool.tier,
    cluster: 'devnet',
    harvestedAt: new Date().toISOString(),
    slot: await connection.getSlot('confirmed'),
    terminalState: pool.state,
    entrants: pool.entrants,
    minSeats: pool.min_seats,
    entryLamports: pool.entry_lamports,
    potLamports: pool.pot_lamports,
    fillDeadline: pool.fill_deadline,
    resultsRoot: pool.results_root,
    revealedSecret: pool.secret,
    outcomeIfDeadlineNow: pool.outcome_if_deadline_now,
    treasuryLamports,
    vaultLamports,
    sources: {
      poolState: `${indexer}/pools`,
      entries: `${indexer}/pools/${pool.pool}/entries`,
      balances: 'cluster, getMultipleAccountsInfo at the slot above',
      registerSignatures: existsSync(logPath) ? 'evidence/…/headless-register.log' : 'not present (no headless seats yet)',
    },
    unknownEntrants: unknown.map((s) => s.address),
    seats,
  };

  mkdirSync(resolve(__dirname, '..', 'registry'), { recursive: true });
  const out = resolve(__dirname, '..', 'registry', `${test}.actual.json`);
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');

  console.log(`pool ${pool.id} — ${pool.state}, ${pool.entrants} entrants, min_seats ${pool.min_seats}`);
  console.log(`vault ${vaultLamports} lamports · treasury ${treasuryLamports} lamports`);
  console.log(`${seats.filter((s) => s.refunded).length} of ${seats.length} seats marked refunded`);
  if (unknown.length > 0) {
    console.log(`\nWARNING: ${unknown.length} entrant(s) are not in wallets.json — someone else entered this pool:`);
    for (const s of unknown) console.log(`  ${s.address}`);
  }
  console.log(`\nwrote ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
