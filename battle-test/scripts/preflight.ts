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
 *      pool — the exact call the browser is about to make.
 *
 * (3) is the one that matters most and the one that cannot be inferred: a
 * packet issued for wallet A proves nothing about wallet B, because the gate
 * decides per wallet. It requests packets and nothing else — no allocation is
 * sealed, no ciphertext is stored, nothing is registered, nothing is spent.
 *
 * WHAT THIS CANNOT DO, stated plainly because a false GO is worse than no
 * check at all: it cannot tell whether a wallet is ALREADY barred. Detecting
 * that means asking whether a ciphertext is stored for this wallet and pool,
 * and there is no read path for that — the sealed boxes deliberately have no
 * public reader (PR 134), and probing by writing would itself seal the wallet.
 * So this check stops you CREATING a lockout; it cannot find one that already
 * exists. Run against pool 15 on 2026-09-16 it reported GO for both founder
 * accounts, which were already barred. An unbarred wallet cannot be
 * distinguished from a barred one from outside — which is why the product fix
 * in `docs/FIX-seal-lockout.md` includes a wallet-authenticated read.
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
import { Connection, PublicKey } from '@solana/web3.js';

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

/** Roster id → address, from registry/wallets.json. */
function roster(): Map<string, string> {
  const doc = JSON.parse(
    readFileSync(resolve(__dirname, '..', 'registry', 'wallets.json'), 'utf8')
  ) as { wallets: { id: string; address: string }[] };
  return new Map(doc.wallets.map((w) => [w.id, w.address]));
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
  if (!rpc) throw new Error('set BLOTTO_RPC_URL (or pass --rpc)');

  const ids = walletArg.split(',').map((s) => s.trim()).filter(Boolean);
  const addresses = roster();
  const connection = new Connection(rpc, 'confirmed');

  console.log(`preflight — pool ${poolId}, wallets ${ids.join(', ')}\n`);

  // ---- 1. the pool ------------------------------------------------------
  const pools = (await (await fetch(`${indexer}/pools`)).json()) as PoolView[];
  const pool = pools.find((p) => p.id === String(poolId));
  if (!pool) {
    fail(`pool ${poolId} is not in the indexer's projection`);
    return done();
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

    // The exact call the browser is about to make. Per wallet, because the
    // gate decides per wallet: a packet for one proves nothing about another.
    const res = await fetch(`${packetApi}/packet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: address, pool: pool.pool }),
    });
    if (res.status === 200) {
      note(true, `${id} the entry gate issued a packet (${res.status})`);
    } else {
      fail(
        `${id} the entry gate REFUSED (${res.status}). Do NOT let this wallet play: ` +
        `it would seal, fail, and be barred from pool ${pool.id} for good.`
      );
    }
  }

  done();
}

function done(): void {
  console.log('');
  if (problems.length === 0) {
    console.log('GO — every check passed. The named wallets may play this pool now.');
    console.log('Re-run this if more than a few minutes pass before they do.');
    console.log(
      'Caveat, and it is not a small one: this CANNOT see whether a wallet is already\n' +
      'barred from this pool by a previous seal. There is no read path for that. GO means\n' +
      '"nothing here will create a lockout", not "this wallet can definitely enter".'
    );
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
