/**
 * Balance snapshots — the raw material of the conservation table (manual §8.0,
 * §8.10, §11.3).
 *
 * Money conservation is the claim the report has to defend: every lamport that
 * entered a pool is accounted for at the end. That is only checkable if the
 * BEFORE figures were captured before anything happened, so this runs at loop
 * step 8.0 (before the first entry) and again at 8.10 (after settlement), and
 * the two files are diffed.
 *
 * It records, with the source named per line so nothing is "just known":
 *   - every headless wallet and both UI wallets, from the chain
 *   - the platform treasury PDA and, when a pool id is given, its prize vault
 *   - the funder
 *
 * Run (from battle-test/):
 *   BLOTTO_BT_SEED=<hex> BLOTTO_RPC_URL=<url> npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/snapshot.ts --label before --test T1 [--pool 14]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Connection, PublicKey } from '@solana/web3.js';
import { deriveAll, masterFromEnv } from './keys';

const PROGRAM_ID = new PublicKey('5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17');

const sol = (l: bigint): string => {
  const whole = l / 1_000_000_000n;
  const frac = (l % 1_000_000_000n).toString().padStart(9, '0');
  return `${whole}.${frac}`;
};

interface Row { id: string; kind: string; address: string; lamports: string; sol: string }

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (n: string): string | undefined => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const label = flag('label') ?? 'snapshot';
  const test = flag('test') ?? 'ad-hoc';
  const poolId = flag('pool');
  const rpc = process.env.BLOTTO_RPC_URL ?? process.env.RPC_URL;
  if (!rpc) throw new Error('BLOTTO_RPC_URL is not set');

  const connection = new Connection(rpc, { commitment: 'confirmed' });
  const { funder, wallets } = deriveAll(masterFromEnv());

  const rosterPath = resolve(__dirname, '..', 'registry', 'wallets.json');
  const roster = JSON.parse(readFileSync(rosterPath, 'utf8')) as {
    wallets: { id: string; kind: string; address: string }[];
  };
  const ui = roster.wallets.filter((w) => w.kind === 'ui');

  const [platform] = PublicKey.findProgramAddressSync([Buffer.from('platform')], PROGRAM_ID);
  const targets: { id: string; kind: string; key: PublicKey }[] = [
    { id: 'funder', kind: 'funder', key: funder.publicKey },
    { id: 'treasury', kind: 'program', key: platform },
    ...wallets.map((w, i) => ({ id: `W${String(i).padStart(2, '0')}`, kind: 'headless', key: w.publicKey })),
    ...ui.map((w) => ({ id: w.id, kind: 'ui', key: new PublicKey(w.address) })),
  ];

  if (poolId) {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(BigInt(poolId));
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), le], PROGRAM_ID);
    targets.push({ id: `vault-${poolId}`, kind: 'program', key: vault });
  }

  const rows: Row[] = [];
  let headlessTotal = 0n;
  for (let i = 0; i < targets.length; i += 100) {
    const slice = targets.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(slice.map((t) => t.key), 'confirmed');
    infos.forEach((info, k) => {
      const t = slice[k];
      const lamports = BigInt(info?.lamports ?? 0);
      if (t.kind === 'headless') headlessTotal += lamports;
      rows.push({ id: t.id, kind: t.kind, address: t.key.toBase58(), lamports: lamports.toString(), sol: sol(lamports) });
    });
  }

  const doc = {
    schema: 'blotto-rehearsal-snapshot/1',
    label,
    test,
    poolId: poolId ?? null,
    cluster: 'devnet',
    takenAt: new Date().toISOString(),
    slot: await connection.getSlot('confirmed'),
    headlessTotalLamports: headlessTotal.toString(),
    rows,
  };

  const dir = resolve(__dirname, '..', 'evidence', poolId ? `${test}-pool-${poolId}` : test);
  mkdirSync(dir, { recursive: true });
  const out = resolve(dir, `balances-${label}.json`);
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');

  const named = rows.filter((r) => r.kind !== 'headless');
  for (const r of named) console.log(`  ${r.id.padEnd(12)} ${r.sol.padStart(16)} SOL  ${r.address}`);
  console.log(`  ${'headless x' + wallets.length} ${sol(headlessTotal).padStart(14)} SOL (total)`);
  console.log(`\nwrote ${out} at slot ${doc.slot}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
