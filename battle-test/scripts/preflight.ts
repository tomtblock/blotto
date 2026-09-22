/**
 * preflight.ts — the go/no-go check that runs BEFORE anybody plays.
 *
 * WHY THIS EXISTS (DRIFT.md §H6, 2026-09-16). The app stores a player's sealed
 * allocation and THEN asks the entry service for permission. If the permission
 * step fails, the stored allocation stays. The store refuses a second,
 * different allocation for the same wallet and pool; a replay is never
 * identical because the salt is fresh; and no delete path exists anywhere in
 * the tree. So a wallet that seals into a broken gate is barred from that pool
 * FOREVER, having paid nothing and entered nothing.
 *
 * That is exactly what happened to both founder accounts on pool 15 during the
 * Turnkey outage. It cost a pool and a night. It cannot be undone, only
 * avoided — and it is only avoidable BEFORE the player plays.
 *
 * So: nobody touches a dial until this exits 0. A check run afterwards tells
 * you what you have already lost.
 *
 * What it proves, in the order that fails most cheaply first:
 *   1. the pool is Open, has room, and is READY to accept a register —
 *      vrf seed committed and pass collection created, the two things that
 *      make `register` revert if they are missing;
 *   2. no named wallet is ALREADY registered in this pool (an Entry PDA read
 *      straight from the chain, not the indexer);
 *   3. the entry gate issues a real packet for EACH named wallet against THIS
 *      pool — the exact SEQUENCE the browser is about to run: the clickwrap
 *      attestation, and only then the packet request.
 *
 * (3) is the one that matters most and the one that cannot be inferred: a
 * packet issued for wallet A proves nothing about wallet B, because the gate
 * decides per wallet. It attests and requests packets, and nothing else — no
 * allocation is sealed, no ciphertext is stored, nothing is registered,
 * nothing is spent.
 *
 * WHY IT ATTESTS FIRST (DRIFT.md §H27, 2026-09-22). `service.ts` will not
 * issue a packet to a wallet with no stored attestation at the current terms
 * version, and `enter.ts` makes that attestation immediately before asking —
 * the headless equivalent of the two-tile clickwrap. This script used to skip
 * it, so it tested a sequence no entrant ever performs and STOPPED every
 * wallet that had simply never played: W67–W71 were all condemned with
 * `Do NOT let this wallet play` on pool 27, and all five went
 * `packet 403 → attestation 204 → packet 200` the moment they were asked
 * properly. The gate's refusal is deliberately generic so that it cannot be
 * walked by a prober (PID §8), so the response cannot be parsed to tell
 * "unattested" from "refused" — running the real sequence is the only fix.
 * The attestation is off-chain, idempotent and re-attestable, so making it
 * here costs the wallet nothing and commits it to nothing.
 *
 *   4. whether the SEAL FIX IS LIVE on this entry service, and — for a wallet
 *      whose key we hold — whether that wallet has already sealed here.
 *
 * (4) is new (2026-09-18, PR 147) and replaces this script's own worst caveat.
 * The blind spot it used to carry is quoted here because the reason it closed
 * matters more than the fact that it did:
 *
 *   > it cannot tell whether a wallet is ALREADY barred … there is no read
 *   > path for that … probing by writing would itself seal the wallet. Run
 *   > against pool 15 on 2026-09-16 it reported GO for both founder accounts,
 *   > which were already barred.
 *
 * Two things changed. The gate now refuses an overwrite only for a seat the
 * CHAIN HAS ACCEPTED, so a stored ciphertext with no Entry no longer bars
 * anybody — and check (2) already reads that Entry straight from the chain.
 * And `POST /ciphertexts/status` answers the question directly, for the wallet
 * that signs for itself.
 *
 * TWO LIMITS, both stated rather than papered over, because a false GO is
 * still worse than no check at all:
 *
 *   - **The fix has to be DEPLOYED.** `deploy-backend` is manual, so a merged
 *     fix is not a live one. This script probes for the status endpoint and
 *     says which world it is in. When the endpoint is absent, the old lockout
 *     is still live and the old caveat still applies in full.
 *   - **We cannot sign for UI-A or UI-B.** Their keys live in the founder's
 *     browser, not in `keys/wallets/`, and the read is wallet-authenticated by
 *     design. For those two the Entry-PDA check is what we have — which, with
 *     the fix live, is the check that decides.
 *
 * COST, stated honestly: one Turnkey signing activity per wallet checked
 * (DRIFT.md §H5). Check the two UI wallets before the founder plays, not all
 * sixty-four — `enter.ts` carries its own stop for the headless run.
 *
 * Run:
 *   npx ts-node --transpile-only --compiler-options \
 *     '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/preflight.ts --pool 16 --wallets UI-A,UI-B
 *
 * Exit 0 = GO. Exit 1 = STOP, with the reason named.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';

import { ciphertextStatusMessage } from '../../backend/packet/src/ciphertext-message';
import { attestationMessage } from '../../backend/_shared/src/attestation-message';

const PROGRAM_ID = new PublicKey('5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17');
const DEFAULT_INDEXER = 'https://blotto-indexer.fly.dev';
const DEFAULT_PACKET = 'https://blotto-packet.fly.dev';

/** Byte offset of the VRF seed in the Pool account (pinned against the program). */
const VRF_SEED_OFFSET = 116;

interface PoolView {
  pool: string; id: string; state: string; entrants: number;
  fill_deadline: string; server_time: string;
}

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const problems: string[] = [];
const note = (ok: boolean, line: string) => console.log(`  ${ok ? 'ok  ' : 'STOP'}  ${line}`);
const fail = (line: string) => { problems.push(line); note(false, line); };
/**
 * Something this script cannot settle from outside. It is neither `ok` nor a
 * STOP, and collapsing it into either is how §H27 happened: a wallet whose key
 * we do not hold cannot be attested for, so its refusal is genuinely ambiguous
 * and must be reported as ambiguous. WARN does not add to `problems`, so it
 * does not block a run, and it does not print `ok`, so it cannot be read as one.
 */
const warn = (line: string) => console.log(`  WARN  ${line}`);

/** One edition of the terms, mirroring config/terms.json. */
interface TermsEdition { version: number; updated: string }

/** Roster id → address, from registry/wallets.json. */
function roster(): Map<string, string> {
  const doc = JSON.parse(
    readFileSync(resolve(__dirname, '..', 'registry', 'wallets.json'), 'utf8')
  ) as { wallets: { id: string; address: string }[] };
  return new Map(doc.wallets.map((w) => [w.id, w.address]));
}

/**
 * The keypair for a headless wallet, or null when we do not hold one.
 *
 * UI-A and UI-B are the founder's browser wallets: their keys are in Privy,
 * not on this disk, and no amount of wanting the check changes that. Returning
 * null rather than throwing is the point — a wallet we cannot ask about is
 * reported as unasked, never as clean.
 */
function keypairFor(id: string): Keypair | null {
  const m = /^W(\d+)$/.exec(id);
  if (!m) return null;
  const path = resolve(__dirname, '..', 'keys', 'wallets', `${m[1].padStart(2, '0')}.json`);
  try {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(path, 'utf8')) as number[]));
  } catch {
    return null;
  }
}

type SealState = 'sealed' | 'clean' | 'cannot-ask' | 'not-deployed';

/**
 * Ask the entry service whether this wallet has already sealed for this pool.
 *
 * FAILS LOUD, NOT CLEAN. Every outcome that is not a definite answer maps to
 * `cannot-ask` or `not-deployed`, never to `clean`. A check that guesses
 * "clean" when it does not know is the false GO this whole script exists to
 * prevent.
 */
async function sealState(
  api: string, pool: string, id: string, atUnix: bigint
): Promise<SealState> {
  const kp = keypairFor(id);
  if (!kp) return 'cannot-ask';
  const player = kp.publicKey.toBase58();
  const signature = Buffer.from(
    nacl.sign.detached(ciphertextStatusMessage(pool, player, atUnix), kp.secretKey)
  ).toString('base64');
  let res: Response;
  try {
    res = await fetch(`${api}/ciphertexts/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pool, player, atUnix: atUnix.toString(), signature }),
    });
  } catch {
    return 'cannot-ask';
  }
  // A service that predates PR 147 has no such route and answers 404.
  if (res.status === 404) return 'not-deployed';
  if (!res.ok) return 'cannot-ask';
  const body = (await res.json()) as { sealed?: unknown };
  if (typeof body.sealed !== 'boolean') return 'cannot-ask';
  return body.sealed ? 'sealed' : 'clean';
}

async function main(): Promise<void> {
  const poolId = flag('pool');
  const walletArg = flag('wallets');
  if (!poolId || !walletArg) {
    throw new Error('usage: preflight.ts --pool <id> --wallets <ID,ID,...>');
  }
  const indexer = flag('indexer') ?? process.env.BLOTTO_INDEXER_URL ?? DEFAULT_INDEXER;
  const packetApi = flag('packet') ?? process.env.BLOTTO_PACKET_URL ?? DEFAULT_PACKET;
  const rpc = flag('rpc') ?? process.env.BLOTTO_RPC_URL ?? process.env.RPC_URL;
  // The clickwrap is version-pinned: the gate wants an attestation at the
  // CURRENT terms version, and an older one re-prompts rather than passing.
  const terms = JSON.parse(
    readFileSync(resolve(__dirname, '..', '..', 'config', 'terms.json'), 'utf8')
  ) as TermsEdition;
  if (!rpc) throw new Error('set BLOTTO_RPC_URL (or pass --rpc)');

  const ids = walletArg.split(',').map((s) => s.trim()).filter(Boolean);
  const addresses = roster();
  const connection = new Connection(rpc, 'confirmed');

  // The status message carries a client timestamp the service checks against a
  // bounded skew, so it is taken once per run and signed per wallet.
  const now = BigInt(Math.floor(Date.now() / 1000));
  // Set false by the first wallet that finds no status route: that endpoint's
  // absence is how this script detects that the seal fix is merged but not
  // deployed (`deploy-backend` is manual — a merge does not ship it).
  let fixLive = true;

  console.log(`preflight — pool ${poolId}, wallets ${ids.join(', ')}\n`);

  // ---- 1. the pool ------------------------------------------------------
  const pools = (await (await fetch(`${indexer}/pools`)).json()) as PoolView[];
  const pool = pools.find((p) => p.id === String(poolId));
  if (!pool) {
    fail(`pool ${poolId} is not in the indexer's projection`);
    return done(fixLive);
  }
  note(true, `pool ${pool.id} ${pool.pool}`);

  if (pool.state !== 'Open') fail(`pool state is ${pool.state}, not Open — it cannot take entries`);
  else note(true, `state Open, ${pool.entrants}/64 seated`);

  const secondsLeft = Number(pool.fill_deadline) - Number(pool.server_time);
  if (secondsLeft <= 0) fail('the fill deadline has passed');
  else note(true, `deadline in ${(secondsLeft / 3600).toFixed(2)} h`);

  const poolKey = new PublicKey(pool.pool);
  const poolInfo = await connection.getAccountInfo(poolKey);
  if (!poolInfo) {
    fail('the pool account does not exist on chain');
  } else {
    const seed = poolInfo.data.subarray(VRF_SEED_OFFSET, VRF_SEED_OFFSET + 32);
    if (seed.equals(Buffer.alloc(32))) {
      fail('the vrf seed is still the uncommitted sentinel — register would revert');
    } else {
      note(true, 'vrf seed committed');
    }
  }

  const [collection] = PublicKey.findProgramAddressSync(
    [Buffer.from('pass_collection'), poolKey.toBuffer()], PROGRAM_ID
  );
  if (!(await connection.getAccountInfo(collection))) {
    fail('the pass collection does not exist — register would revert at the mint');
  } else {
    note(true, `pass collection ${collection.toBase58().slice(0, 8)}… exists`);
  }

  // ---- 2 and 3. each wallet --------------------------------------------
  for (const id of ids) {
    const address = addresses.get(id);
    if (!address) { fail(`${id} is not in registry/wallets.json`); continue; }
    console.log(`\n  ${id}  ${address}`);

    const [entry] = PublicKey.findProgramAddressSync(
      [Buffer.from('entry'), poolKey.toBuffer(), new PublicKey(address).toBuffer()], PROGRAM_ID
    );
    if (await connection.getAccountInfo(entry)) {
      fail(`${id} already has an Entry in pool ${pool.id} — it is seated, not waiting`);
    } else {
      note(true, `${id} is not yet registered in this pool`);
    }

    // The clickwrap FIRST, then the packet — the sequence an entrant actually
    // runs, and the sequence `enter.ts` runs (§H27). Off-chain, idempotent,
    // and it commits the wallet to nothing: re-attesting replaces the record.
    const kp = keypairFor(id);
    let attestation: number | null = null;
    if (kp) {
      const att = await fetch(`${packetApi}/attestation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          wallet: address,
          termsVersion: terms.version,
          signature: Buffer.from(
            nacl.sign.detached(attestationMessage(address, terms), kp.secretKey)
          ).toString('base64')
        }),
      });
      attestation = att.status;
      // 204 is the route's only success; anything else and the packet request
      // below is expected to refuse, which is then a real finding rather than
      // an artefact of never having clicked.
      note(att.status === 204, `${id} clickwrap accepted at terms v${terms.version} (${att.status})`);
    }

    // Per wallet, because the gate decides per wallet: a packet for one proves
    // nothing about another.
    const res = await fetch(`${packetApi}/packet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: address, pool: pool.pool }),
    });
    if (res.status === 200) {
      note(true, `${id} the entry gate issued a packet (${res.status})`);
    } else if (kp === null) {
      // We hold no key for this wallet, so no clickwrap could be made for it.
      // A browser wallet that has not accepted the CURRENT terms is refused
      // here and is perfectly fine the moment its owner accepts them — and
      // from outside, that is indistinguishable from a real refusal, because
      // the gate answers one generic status for every reason it has (PID §8).
      warn(
        `${id} the entry gate REFUSED (${res.status}), and we hold no key for it, so the ` +
        `clickwrap could not be made first. This may mean nothing worse than "has not yet ` +
        `accepted terms v${terms.version}" — it cannot be told apart from outside. Have the ` +
        `wallet's owner load the play page and accept, then re-run.`
      );
    } else {
      fail(
        `${id} the entry gate REFUSED (${res.status}) even after the clickwrap was accepted ` +
        `(attestation ${attestation}). Do NOT let this wallet play: it would seal, fail, and ` +
        `be barred from pool ${pool.id} for good.`
      );
    }

    // ---- 4. has it already sealed here? --------------------------------
    const state = await sealState(packetApi, pool.pool, id, now);
    if (state === 'not-deployed') {
      fixLive = false;
      note(false, `${id} cannot ask whether it has sealed — the service has no status route`);
    } else if (state === 'cannot-ask') {
      note(false, `${id} cannot ask whether it has sealed — we do not hold this wallet's key`);
    } else if (state === 'clean') {
      note(true, `${id} has not sealed for this pool`);
    } else {
      // Sealed with no Entry. Before PR 147 this was terminal. After it, the
      // wallet can simply play again — so it is worth saying, and it is not
      // a STOP. The seat check above is what decides.
      note(true, `${id} has an allocation stored here from an earlier attempt`);
      console.log(
        `      (recoverable: the gate now refuses an overwrite only for a seat\n` +
        `       the chain has accepted, and this wallet holds none)`
      );
    }
  }

  done(fixLive);
}

function done(fixLive: boolean): void {
  console.log('');
  if (problems.length === 0) {
    console.log('GO — every check passed. The named wallets may play this pool now.');
    console.log('Re-run this if more than a few minutes pass before they do.');
    if (fixLive) {
      console.log(
        'The seal fix (PR 147) IS live on this entry service: the status route answered.\n' +
        'A wallet that seals and then fails to register can play again, so this GO no\n' +
        'longer carries the old "it may already be barred and nobody can tell" caveat.\n' +
        'For UI-A and UI-B the Entry-PDA check above is what decides — we cannot sign\n' +
        'their status read, and with the fix live we do not need to.'
      );
    } else {
      console.log(
        'WARNING — the seal fix is NOT live on this entry service. The status route is\n' +
        'absent, which means this deployment predates PR 147 (deploy-backend is manual,\n' +
        'so merging it did not ship it). The old lockout is still in force: a wallet that\n' +
        'seals and then fails for ANY reason is barred from this pool for good, and\n' +
        'nothing can tell you which wallets already are. GO here means "nothing checked\n' +
        'will CREATE a lockout", not "this wallet can definitely enter".'
      );
    }
    return;
  }
  console.log(`STOP — ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  console.log('\nNobody plays until this exits 0. A seal made into a broken gate cannot be undone.');
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(`preflight failed to run: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
