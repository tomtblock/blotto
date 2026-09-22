/**
 * The 65th entry — what a player who arrives a moment too late actually gets.
 *
 * `enter.ts` refuses a pool that is not Open, and rightly: its job is to fill
 * one. This script does the opposite job. It drives the SAME path an ordinary
 * entrant drives — attest, seal, packet, register — against a pool that has
 * already sealed, and records what each step answers.
 *
 * WHY IT SENDS A TRANSACTION THAT IT EXPECTS TO FAIL. The claim under test is
 * that the program refuses the 65th entry at the STATE gate rather than the
 * capacity gate: `register.rs` checks paused, then the service-key bar, then
 * `pool.state == Open` (PoolNotOpen, 6000), then the deadline, then
 * `entrants < CAPACITY` (PoolFull, 6010). The 64th entry seals the pool, so a
 * 65th can never reach the fifth gate and 6010 can never fire for a pool that
 * filled. A simulation would show that too, but only a landed transaction
 * proves the refusal costs the signer a fee and nothing else — no entry, no
 * pass, no rent. The balance delta is the evidence, so the transaction is
 * sent for real, with preflight skipped so the revert happens on chain rather
 * than in a node's simulator.
 *
 * NOTHING CAN BE BURNT HERE. A wallet is burnt by storing a ciphertext it
 * never registers (DRIFT.md §H6). On a sealed pool the ciphertext route
 * refuses at its first gate, before the signature and before any write, so
 * there is nothing to store and nothing to strand. The refusal it returns is
 * itself part of the evidence: `pool filled` when the pool reached capacity,
 * `pool closed to entries` when the clock ran out.
 *
 * Run (from battle-test/):
 *   BLOTTO_BT_SEED=<hex> BLOTTO_RPC_URL=<url> npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/late-attempt.ts --pool 27 --wallets W63-W71 [--out <path>]
 */

import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import nacl from 'tweetnacl';
import {
  Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { buildEd25519Instruction, buildRegisterInstruction, type IssuedPacket } from './enter';
import { encodePayload, payloadBattlesHash } from '../../backend/sealing/src/payload';
import { seal as sealBox } from '../../backend/sealing/src/sealedbox';
import { ciphertextMessage } from '../../backend/packet/src/ciphertext-message';
import { attestationMessage } from '../../backend/_shared/src/attestation-message';

const PROGRAM_ID = new PublicKey('5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17');
const DEFAULT_INDEXER = 'https://blotto-indexer.fly.dev';
const DEFAULT_PACKET = 'https://blotto-packet.fly.dev';

/** Anchor numbers a program's error enum from 6000 in declaration order. */
const POOL_NOT_OPEN = 6000;
const POOL_FULL = 6010;

interface TermsEdition { version: number; updated: string }

interface PoolView {
  pool: string; id: string; state: string; entrants: number;
  sealing_pubkey: string; min_seats: number;
}

interface AttemptResult {
  wallet: string;
  address: string;
  balanceBefore: string;
  balanceAfter: string;
  lamportsSpent: string;
  attestation: number | null;
  packet: number | null;
  ciphertextStatus: number | null;
  ciphertextBody: string | null;
  signature: string | null;
  registerError: string | null;
  customErrorCode: number | null;
  verdict: string;
}

const u64le = (v: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
const fromB64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));
const unhex = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'hex'));

function derivePdas(poolId: bigint, player: PublicKey) {
  const idLe = u64le(poolId);
  const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
  const pool = pda([Buffer.from('pool'), idLe]);
  return {
    config: pda([Buffer.from('config')]),
    pool,
    vault: pda([Buffer.from('vault'), idLe]),
    platform: pda([Buffer.from('platform')]),
    entry: pda([Buffer.from('entry'), pool.toBuffer(), player.toBuffer()]),
    passCollection: pda([Buffer.from('pass_collection'), pool.toBuffer()]),
  };
}

function loadWallet(index: number): Keypair {
  const path = resolve(__dirname, '..', 'keys', 'wallets', `${String(index).padStart(2, '0')}.json`);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(path, 'utf8')) as number[]));
}

function parseWallets(spec: string): string[] {
  const out: string[] = [];
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const range = /^W(\d+)-W(\d+)$/i.exec(part);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (b < a) throw new Error(`bad --wallets range: ${part}`);
      for (let i = a; i <= b; i++) out.push(`W${String(i).padStart(2, '0')}`);
    } else if (/^W\d+$/i.test(part)) {
      out.push(`W${String(Number(part.slice(1))).padStart(2, '0')}`);
    } else {
      throw new Error(`bad --wallets entry: ${part}`);
    }
  }
  return out;
}

/** Read Anchor's custom error number out of whatever web3.js threw. */
function customErrorCode(message: string): number | null {
  const custom = /"Custom":\s*(\d+)/.exec(message) ?? /custom program error: 0x([0-9a-f]+)/i.exec(message);
  if (!custom) return null;
  return custom[0].includes('0x') ? parseInt(custom[1], 16) : Number(custom[1]);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (n: string): string | undefined => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const poolId = flag('pool') ?? (() => { throw new Error('--pool <id> is required'); })();
  const walletIds = parseWallets(flag('wallets') ?? (() => { throw new Error('--wallets is required'); })());
  const indexer = flag('indexer') ?? process.env.BLOTTO_INDEXER_URL ?? DEFAULT_INDEXER;
  const packetApi = flag('packet') ?? process.env.BLOTTO_PACKET_URL ?? DEFAULT_PACKET;
  const rpc = flag('rpc') ?? process.env.BLOTTO_RPC_URL ?? process.env.RPC_URL;
  if (!rpc) throw new Error('BLOTTO_RPC_URL is not set');

  const terms = JSON.parse(
    readFileSync(resolve(__dirname, '..', '..', 'config', 'terms.json'), 'utf8')
  ) as TermsEdition;
  const connection = new Connection(rpc, { commitment: 'confirmed' });

  const pools = (await (await fetch(`${indexer}/pools`)).json()) as PoolView[];
  const pool = pools.find((p) => p.id === String(poolId));
  if (!pool) throw new Error(`pool ${poolId} is not in the indexer`);

  console.log(`pool ${pool.id} (${pool.pool}) — ${pool.state}, ${pool.entrants} entrants`);
  if (pool.state === 'Open') {
    throw new Error(
      `pool ${pool.id} is still Open. A late attempt against an Open pool would SUCCEED and ` +
      'take a seat — refusing to run.'
    );
  }
  console.log(`${walletIds.length} late attempts: ${walletIds.join(', ')}\n`);

  const results: AttemptResult[] = [];
  for (const walletId of walletIds) {
    const index = Number(walletId.slice(1));
    const player = loadWallet(index);
    const address = player.publicKey.toBase58();
    const before = BigInt(await connection.getBalance(player.publicKey));

    const r: AttemptResult = {
      wallet: walletId, address,
      balanceBefore: before.toString(), balanceAfter: before.toString(), lamportsSpent: '0',
      attestation: null, packet: null, ciphertextStatus: null, ciphertextBody: null,
      signature: null, registerError: null, customErrorCode: null, verdict: 'not attempted',
    };

    try {
      // 1. the clickwrap, exactly as an ordinary entrant makes it
      const attMsg = attestationMessage(address, terms);
      const attRes = await fetch(`${packetApi}/attestation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          wallet: address, termsVersion: terms.version,
          signature: b64(nacl.sign.detached(attMsg, player.secretKey)),
        }),
      });
      r.attestation = attRes.status;

      // 2. the sealed allocation. On a sealed pool this is refused at gate 1,
      //    before the signature and before any write, so nothing is stored.
      const battles = Array.from({ length: 7 }, () => [20, 20, 20, 20, 20]);
      const payload = {
        battles: battles as never,
        salt: Uint8Array.from(randomBytes(32)),
        timingsMs: Array.from({ length: 7 }, () => 1500),
        deviceHash: new Uint8Array(nacl.hash(player.secretKey.slice(0, 32)).slice(0, 32)),
      };
      const payloadBytes = encodePayload(payload);
      const ciphertext = sealBox(payloadBytes, unhex(pool.sealing_pubkey));
      const battlesHash = payloadBattlesHash(payload);

      const ctMsg = ciphertextMessage(pool.pool, address, ciphertext);
      const ctRes = await fetch(`${packetApi}/ciphertexts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pool: pool.pool, player: address,
          ciphertext: b64(ciphertext),
          signature: b64(nacl.sign.detached(ctMsg, player.secretKey)),
        }),
      });
      r.ciphertextStatus = ctRes.status;
      r.ciphertextBody = (await ctRes.text()).trim();

      // 3. the entry packet
      const pkRes = await fetch(`${packetApi}/packet`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: address, pool: pool.pool }),
      });
      r.packet = pkRes.status;
      if (!pkRes.ok) {
        r.verdict = 'refused at the entry gate, never reached the program';
        results.push(r);
        console.log(`  ${walletId}  packet ${pkRes.status} — never reached the chain`);
        continue;
      }
      const body = (await pkRes.json()) as { message: string; signature: string; publicKey: string };
      const packet: IssuedPacket = {
        message: fromB64(body.message),
        signature: fromB64(body.signature),
        publicKey: fromB64(body.publicKey),
      };

      // 4. register — sent for real, preflight skipped, expected to revert
      const passAsset = Keypair.generate();
      const pdas = derivePdas(BigInt(pool.id), player.publicKey);
      const tx = new Transaction()
        .add(buildEd25519Instruction(packet))
        .add(buildRegisterInstruction({
          poolId: BigInt(pool.id), player: player.publicKey,
          passAsset: passAsset.publicKey, battlesHash, pdas,
        }));
      tx.feePayer = player.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

      try {
        r.signature = await sendAndConfirmTransaction(connection, tx, [player, passAsset], {
          commitment: 'confirmed', maxRetries: 5, skipPreflight: true,
        });
        r.verdict = 'REGISTERED — the pool accepted a 65th entry. This is a FAILURE.';
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        r.registerError = message;
        r.customErrorCode = customErrorCode(message);
        r.verdict = r.customErrorCode === POOL_NOT_OPEN
          ? 'refused by the program at the STATE gate (PoolNotOpen, 6000)'
          : r.customErrorCode === POOL_FULL
            ? 'refused with PoolFull (6010) — the CAPACITY gate, which should be unreachable'
            : `refused, but not with a recognised gate error (${r.customErrorCode ?? 'none'})`;
      }
    } catch (e) {
      r.registerError = e instanceof Error ? e.message : String(e);
      r.verdict = 'the attempt could not be completed';
    }

    const after = BigInt(await connection.getBalance(player.publicKey));
    r.balanceAfter = after.toString();
    r.lamportsSpent = (before - after).toString();
    results.push(r);
    console.log(
      `  ${walletId}  ciphertext ${r.ciphertextStatus} ${r.ciphertextBody ?? ''}  ` +
      `| error ${r.customErrorCode ?? '-'}  | spent ${r.lamportsSpent} lamports`
    );
  }

  const refusedCorrectly = results.filter((x) => x.customErrorCode === POOL_NOT_OPEN).length;
  const registered = results.filter((x) => x.verdict.startsWith('REGISTERED')).length;
  const spent = results.map((x) => BigInt(x.lamportsSpent));

  console.log(`\n${refusedCorrectly} of ${results.length} refused with PoolNotOpen (6000)`);
  console.log(`${registered} took a seat (must be 0)`);
  console.log(
    `lamports spent: min ${spent.length ? spent.reduce((a, b) => (b < a ? b : a)).toString() : '-'}` +
    `, max ${spent.length ? spent.reduce((a, b) => (b > a ? b : a)).toString() : '-'}`
  );

  const out = flag('out') ?? resolve(__dirname, '..', 'evidence', `T6-pool-${pool.id}`, 'late-attempts.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({
    pool: { id: pool.id, pda: pool.pool, state: pool.state, entrants: pool.entrants },
    capturedAt: new Date().toISOString(),
    expected: { error: 'PoolNotOpen', code: POOL_NOT_OPEN, notCode: POOL_FULL },
    attempts: results,
  }, null, 2) + '\n');
  console.log(`\nevidence -> ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
