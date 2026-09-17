/**
 * `enter.ts` — the headless entrant (manual §6.1, the direct route).
 *
 * One wallet, one seat, exactly what `app/src/entry/submit.ts` does:
 *
 *   battles + timings
 *     → 32-byte salt
 *     → encodePayload  (the client invariant: five non-negative integers
 *                       summing to exactly 100, in the fixed stat order)
 *     → seal  to the pool's published X25519 key
 *     → POST /ciphertexts  with a wallet signature over ciphertextMessage
 *     → POST /packet       for the Ed25519-signed entry packet
 *     → register           Ed25519 verify instruction FIRST, then register
 *
 * WHY IT MIRRORS THE APP RATHER THAN THE REHEARSAL HARNESS.
 * `tests/rehearsal/src/orchestrator.ts` looks like it already does this, and
 * does not: it seals into a memory store and then fabricates the entry rows,
 * writing the pool straight to `Sealed`. It never registers, never requests a
 * packet and makes no HTTP call (its own header says the devnet rehearsal is
 * a different thing entirely). So the sealing half is shared with it and the
 * register leg is mirrored from `app/src/entry/register-tx.ts`, whose byte
 * layouts are pinned against the compiled program by `register-tx.test.ts`
 * and `tests/litesvm/src/lib.rs`.
 *
 * ORDERING IS LOAD-BEARING. The ciphertext is stored BEFORE the transaction:
 * a paid entry whose ciphertext never landed is the lost-ciphertext failure
 * mode. A stored ciphertext with no paid entry is harmless.
 *
 * THE DEVICE MARKER. The app derives it per browser profile AND per pool, so
 * one browser's two pools are unlinkable. A headless wallet is its own
 * device, so the marker is derived per wallet and per pool from the master
 * seed. Every wallet therefore carries a DISTINCT marker, which is the
 * honest shape: sixty-one identical markers would group the whole field
 * under `device_ip_correlation` and manufacture a finding that says nothing.
 *
 * Run (from battle-test/):
 *   BLOTTO_BT_SEED=<hex> BLOTTO_RPC_URL=<url> \
 *     npx ts-node --transpile-only --compiler-options \
 *     '{"module":"commonjs","moduleResolution":"node"}' scripts/enter.ts \
 *     --test T1 --pool 14 --wallets W00-W09 [--dry-run] [--concurrency 4]
 *
 * `--dry-run` does everything except send the transaction: it seals, stores
 * nothing, requests no packet, and prints the encoded instruction bytes. Use
 * it to prove the encoding without touching a pool.
 *
 * `--simulate` goes one step further and asks the LIVE program whether the
 * transaction would be accepted, without committing it. This is how the
 * register leg is proved before a real pool depends on it: the manual says
 * never to dry-run against devnet, and it is right about SENDING — a stray
 * registration locks its tier for the whole fill window. A simulation sends
 * nothing, so it carries none of that risk, and it is the only way to check
 * the account order and the instruction data against the deployed program
 * rather than against our own reading of it.
 */

import { createHash, randomBytes } from 'crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import nacl from 'tweetnacl';

import { encodePayload, payloadBattlesHash } from '../../backend/sealing/src/payload';
import { seal as sealBox } from '../../backend/sealing/src/sealedbox';
import { ciphertextMessage } from '../../backend/packet/src/ciphertext-message';
import { attestationMessage } from '../../backend/_shared/src/attestation-message';
import { poolPopulation, generateEntrant, type GeneratedEntrant } from '../../tests/rehearsal/src/strategies';
import { deriveKeypair, masterFromEnv, walletLabel, DERIVATION_DOMAIN } from './keys';

/** One edition of the terms, mirroring config/terms.json. */
interface TermsEdition { version: number; updated: string }

// --- constants pinned against the program -----------------------------------

const PROGRAM_ID = new PublicKey('5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17');
const MPL_CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const ED25519_PROGRAM = new PublicKey('Ed25519SigVerify111111111111111111111111111');
const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const SLOT_HASHES_SYSVAR = new PublicKey('SysvarS1otHashes111111111111111111111111111');
const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');

const DEFAULT_INDEXER = 'https://blotto-indexer.fly.dev';
const DEFAULT_PACKET = 'https://blotto-packet.fly.dev';

// --- small helpers -----------------------------------------------------------

const u64le = (v: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};

/** Anchor's global instruction discriminator. */
const discriminator = (name: string): Buffer =>
  createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

const unhex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'hex'));
const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');
const fromB64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'base64'));

interface Flags { [k: string]: string }

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[a.slice(2)] = 'true'; continue; }
    out[a.slice(2)] = next;
    i++;
  }
  return out;
}

/** "W00-W09" or "W00,W03,W07" → ['W00', …]. */
function parseWallets(spec: string): string[] {
  if (spec.includes('-')) {
    const [a, b] = spec.split('-');
    const lo = Number(a.replace(/^W/i, ''));
    const hi = Number(b.replace(/^W/i, ''));
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) {
      throw new Error(`bad --wallets range: ${spec}`);
    }
    return Array.from({ length: hi - lo + 1 }, (_, i) => `W${String(lo + i).padStart(2, '0')}`);
  }
  return spec.split(',').map((s) => s.trim()).filter(Boolean);
}

// --- the pool, read from the published indexer ------------------------------

interface PoolView {
  pool: string;
  id: string;
  tier: number;
  entry_lamports: string;
  pot_lamports: string;
  state: string;
  entrants: number;
  sealing_pubkey: string;
  min_seats: number;
  fill_deadline: string;
  outcome_if_deadline_now: string;
}

async function readPool(indexer: string, poolId: string): Promise<PoolView> {
  const res = await fetch(`${indexer}/pools`);
  if (!res.ok) throw new Error(`indexer /pools: ${res.status}`);
  const pools = (await res.json()) as PoolView[];
  const p = pools.find((x) => String(x.id) === String(poolId));
  if (!p) throw new Error(`pool ${poolId} not found in the indexer`);
  return p;
}

// --- PDAs --------------------------------------------------------------------

interface Pdas {
  config: PublicKey; pool: PublicKey; vault: PublicKey;
  platform: PublicKey; entry: PublicKey; passCollection: PublicKey;
}

function derivePdas(poolId: bigint, player: PublicKey): Pdas {
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

// --- instructions ------------------------------------------------------------

export interface IssuedPacket {
  message: Uint8Array;
  signature: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * The Ed25519Program instruction verifying the entry packet. Layout
 * `header 16 ‖ pubkey 32 ‖ signature 64 ‖ message`, every offset pointing
 * into this instruction's own data (0xffff = "this instruction"), which is
 * the fixed shape `entry_packet.rs` looks for through the instructions
 * sysvar. Hand-built rather than taken from web3.js's helper so it matches
 * `app/src/entry/register-tx.ts` byte for byte.
 */
export function buildEd25519Instruction(packet: IssuedPacket): TransactionInstruction {
  if (packet.publicKey.length !== 32) throw new Error('packet publicKey must be 32 bytes');
  if (packet.signature.length !== 64) throw new Error('packet signature must be 64 bytes');
  const msgLen = packet.message.length;
  const data = Buffer.alloc(16 + 32 + 64 + msgLen);
  data[0] = 1; // one signature
  data[1] = 0; // padding
  const u16s = [16 + 32, 0xffff, 16, 0xffff, 16 + 32 + 64, msgLen, 0xffff];
  u16s.forEach((v, i) => data.writeUInt16LE(v, 2 + i * 2));
  data.set(packet.publicKey, 16);
  data.set(packet.signature, 16 + 32);
  data.set(packet.message, 16 + 32 + 64);
  return new TransactionInstruction({ programId: ED25519_PROGRAM, keys: [], data });
}

/** `register` — account order mirroring `register.rs`'s #[derive(Accounts)]. */
export function buildRegisterInstruction(args: {
  poolId: bigint; player: PublicKey; passAsset: PublicKey;
  battlesHash: Uint8Array; pdas: Pdas;
}): TransactionInstruction {
  if (args.battlesHash.length !== 32) throw new Error('battlesHash must be 32 bytes');
  const data = Buffer.concat([discriminator('register'), u64le(args.poolId), Buffer.from(args.battlesHash)]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.player, isSigner: true, isWritable: true },
      { pubkey: args.pdas.config, isSigner: false, isWritable: true },
      { pubkey: args.pdas.pool, isSigner: false, isWritable: true },
      { pubkey: args.pdas.vault, isSigner: false, isWritable: false },
      { pubkey: args.pdas.platform, isSigner: false, isWritable: true },
      { pubkey: args.pdas.entry, isSigner: false, isWritable: true },
      { pubkey: args.pdas.passCollection, isSigner: false, isWritable: true },
      { pubkey: args.passAsset, isSigner: true, isWritable: true },
      { pubkey: MPL_CORE, isSigner: false, isWritable: false },
      { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: SLOT_HASHES_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// --- the three service calls -------------------------------------------------

/**
 * The age/terms clickwrap, as a signature (D-B4).
 *
 * The manual never mentions this step because in the app it is the two-tile
 * clickwrap on the play page. The packet service will not issue a packet to a
 * wallet with no stored attestation at the CURRENT terms version, so a
 * headless entrant must make the same attestation the founder makes by
 * clicking — the same canonical message, signed by the same key that will pay.
 * It is idempotent: re-attesting replaces the record.
 */
async function attest(api: string, player: Keypair, terms: TermsEdition): Promise<void> {
  const message = attestationMessage(player.publicKey.toBase58(), terms);
  const signature = nacl.sign.detached(message, player.secretKey);
  const res = await fetch(`${api}/attestation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      wallet: player.publicKey.toBase58(),
      termsVersion: terms.version,
      signature: Buffer.from(signature).toString('base64'),
    }),
  });
  // 204 on success; the route's only other answer is a generic 403.
  if (res.status !== 204) {
    throw new Error(`attestation refused: ${res.status} ${await res.text()}`);
  }
}

// --- the other service calls -------------------------------------------------

async function putCiphertext(
  api: string, pool: string, player: Keypair, ciphertext: Uint8Array
): Promise<void> {
  // The store will not accept an allocation it cannot attribute: the wallet
  // signs a message binding the pool, itself and a digest of these exact
  // bytes (audit B-02). Without it anyone could overwrite a paid seat.
  const message = ciphertextMessage(pool, player.publicKey.toBase58(), ciphertext);
  const signature = nacl.sign.detached(message, player.secretKey);
  const res = await fetch(`${api}/ciphertexts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pool,
      player: player.publicKey.toBase58(),
      ciphertext: b64(ciphertext),
      signature: b64(signature),
    }),
  });
  if (!res.ok) throw new Error(`ciphertext store: ${res.status} ${await res.text()}`);
}

async function requestPacket(api: string, pool: string, player: string): Promise<IssuedPacket> {
  const res = await fetch(`${api}/packet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: player, pool }),
  });
  if (!res.ok) {
    // The service's one generic refusal. The STATUS carries the only signal:
    // 403 means it decided, 5xx means it fell over. A geo gate running a
    // vendor rather than the stub refuses here, which is the most likely
    // cause of a mass headless failure.
    throw new Error(`packet service: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { ok: boolean; message?: string; signature?: string; publicKey?: string };
  if (!body.ok || !body.message || !body.signature || !body.publicKey) {
    throw new Error('packet service returned a 200 with no packet (a refusal in the body)');
  }
  // The service answers in base64, as `app/src/entry/services.ts` decodes it.
  return {
    message: fromB64(body.message),
    signature: fromB64(body.signature),
    publicKey: fromB64(body.publicKey),
  };
}

/**
 * Is this pool missing either follow-up transaction? Returns a human reason, or
 * null when the pool is ready to take entries.
 *
 * `open_pool` is the first of THREE transactions: `commit_vrf_seed` replaces a
 * 32-byte zero sentinel with the randomness seed, and `create_pass_collection`
 * creates the collection every pass is minted into. Until both land `register`
 * reverts with VrfSeedNotCommitted (6004) or fails inside the mint CPI.
 *
 * VRF_SEED_OFFSET is computed from the `Pool` field order in `state.rs`:
 * discriminator 8 + id 8 + tier 1 + entry_lamports 8 + pot_lamports 8 +
 * entrants 2 + opened_at 8 + fill_deadline 8 + state 1 + sealing_pubkey 32 +
 * sealing_secret_hash 32 = 116. The arithmetic is checked by the three offsets
 * `state.rs` pins for external readers — entrants 33, fill_deadline 43,
 * state 51 — which this same walk reproduces exactly.
 */
const VRF_SEED_OFFSET = 116;

async function poolNotReady(connection: Connection, pool: PoolView): Promise<string | null> {
  const poolKey = new PublicKey(pool.pool);
  const [collection] = PublicKey.findProgramAddressSync(
    [Buffer.from('pass_collection'), poolKey.toBuffer()],
    PROGRAM_ID
  );
  const [poolInfo, collInfo] = await connection.getMultipleAccountsInfo(
    [poolKey, collection],
    'confirmed'
  );
  if (!poolInfo) return 'the pool account could not be read';
  if (poolInfo.data.length < VRF_SEED_OFFSET + 32) {
    return `the pool account is ${poolInfo.data.length} bytes, too short to hold a vrf seed — it may predate a migration`;
  }
  if (!collInfo) return 'its pass collection does not exist yet (create_pass_collection has not landed)';

  const seed = poolInfo.data.subarray(VRF_SEED_OFFSET, VRF_SEED_OFFSET + 32);
  if (seed.equals(Buffer.alloc(32))) {
    return 'its vrf seed is still the uncommitted sentinel (commit_vrf_seed has not landed)';
  }
  return null;
}

// --- one seat ----------------------------------------------------------------

export interface SeatResult {
  wallet: string;
  address: string;
  ok: boolean;
  signature?: string;
  slot?: number;
  battlesHashHex?: string;
  error?: string;
  at: string;
  /**
   * True once this wallet's ciphertext is STORED. A seat that sealed and then
   * failed is not a retryable seat: the store refuses a second, different
   * allocation for the same wallet and pool, a replay always differs because
   * the salt is fresh, and no delete path exists anywhere (DRIFT.md §H6). That
   * wallet can never enter this pool again, so the runner stops rather than
   * doing it to the rest of the field.
   */
  sealed?: boolean;
}

/** The device marker for this wallet in this pool — per wallet, per pool. */
function deviceMarker(master: Buffer, walletId: string, pool: string): Uint8Array {
  return createHash('sha256')
    .update(`${DERIVATION_DOMAIN}device/${walletId}/${pool}/`)
    .update(master)
    .digest();
}

async function enterOne(args: {
  connection: Connection; master: Buffer; walletId: string; index: number;
  entrant: GeneratedEntrant; pool: PoolView; packetApi: string; dryRun: boolean;
  terms: TermsEdition; simulate: boolean;
}): Promise<SeatResult> {
  const { connection, master, walletId, index, entrant, pool, packetApi, dryRun, terms, simulate } = args;
  const player = deriveKeypair(master, walletLabel(index));
  const at = new Date().toISOString();
  const base: SeatResult = { wallet: walletId, address: player.publicKey.toBase58(), ok: false, at };
  let sealed = false;

  try {
    const salt = Uint8Array.from(randomBytes(32));
    const payload = {
      battles: entrant.battles as never,
      salt,
      timingsMs: entrant.timingsMs,
      deviceHash: deviceMarker(master, walletId, pool.pool),
    };
    // Throws unless five non-negative integers sum to exactly 100 per battle.
    const payloadBytes = encodePayload(payload);
    const ciphertext = sealBox(payloadBytes, unhex(pool.sealing_pubkey));
    const battlesHash = payloadBattlesHash(payload);
    const battlesHashHex = Buffer.from(battlesHash).toString('hex');

    if (dryRun) {
      const passAsset = Keypair.generate();
      const pdas = derivePdas(BigInt(pool.id), player.publicKey);
      const ix = buildRegisterInstruction({
        poolId: BigInt(pool.id), player: player.publicKey,
        passAsset: passAsset.publicKey, battlesHash, pdas,
      });
      console.log(
        `  ${walletId} DRY payload=${payloadBytes.length}B ciphertext=${ciphertext.length}B ` +
        `hash=${battlesHashHex.slice(0, 16)}… register.data=${ix.data.length}B accounts=${ix.keys.length}`
      );
      return { ...base, ok: true, battlesHashHex };
    }

    // The clickwrap first: without a stored attestation at the current terms
    // version the packet service refuses, and its refusal is generic.
    await attest(packetApi, player, terms);

    // Ciphertext BEFORE money. This ORDER is the app's (submit.ts:99-100) and
    // is mirrored deliberately — the test must exercise the real path, not a
    // safer one. What the runner adds is the stop: see `sealed` above.
    //
    // EXCEPT under --simulate, which must not seal (2026-09-16). This module
    // claimed a simulation "writes no state" while storing a ciphertext, and a
    // stored ciphertext cannot be replaced or deleted (DRIFT.md §H6) — so the
    // SAFE mode permanently barred the wallet it was run on. It did exactly
    // that to W62 on pool 15. `register` needs the battles hash and the
    // packet, never the stored ciphertext, which is read only at reveal; so
    // skipping the write here costs the simulation nothing and makes the
    // claim true.
    if (!simulate) {
      await putCiphertext(packetApi, pool.pool, player, ciphertext);
      sealed = true;
    }
    const packet = await requestPacket(packetApi, pool.pool, player.publicKey.toBase58());

    const passAsset = Keypair.generate();
    const pdas = derivePdas(BigInt(pool.id), player.publicKey);
    const tx = new Transaction()
      .add(buildEd25519Instruction(packet))       // must precede register
      .add(buildRegisterInstruction({
        poolId: BigInt(pool.id), player: player.publicKey,
        passAsset: passAsset.publicKey, battlesHash, pdas,
      }));
    tx.feePayer = player.publicKey;

    if (simulate) {
      // Ask the deployed program, commit nothing.
      //
      // The signers are passed DELIBERATELY. web3.js sets `sigVerify` only when
      // they are (lib/index.cjs.js:8080), so simulating without them checks the
      // program's logic and the Ed25519 packet instruction but NOT this
      // transaction's own signatures — which is less than "the transaction
      // would be accepted", and was claimed as more until 2026-09-16.
      tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
      const sim = await connection.simulateTransaction(tx, [player, passAsset]);
      const err = sim.value.err;
      if (err) {
        const logs = (sim.value.logs ?? []).filter((l) => /Error|failed|Program log/.test(l)).slice(-6);
        throw new Error(`simulation rejected: ${JSON.stringify(err)}\n      ${logs.join('\n      ')}`);
      }
      console.log(
        `  ${walletId} SIMULATED OK  units=${sim.value.unitsConsumed ?? '?'}  ` +
        `hash=${battlesHashHex.slice(0, 16)}…`
      );
      return { ...base, ok: true, battlesHashHex };
    }

    // A 'confirmed' blockhash can be newer than the node that runs preflight,
    // which answers "Blockhash not found" and fails the send. On this runner
    // that is not a retryable annoyance: the ciphertext is already stored, so
    // every such failure BURNS the wallet for this pool (DRIFT.md §H6). It
    // cost W22, W42 and W43 on pool 16 before this was fixed.
    //
    // The fix is to SKIP PREFLIGHT, not to age the blockhash. Preflight's only
    // job is to catch a malformed transaction, and this one's shape is proven
    // by `--simulate` and by every seat that has landed; a transaction that
    // fails on chain burns the wallet either way, so preflight buys nothing
    // here and costs seats.
    //
    // A 'finalized' blockhash was tried first and was WORSE: it is ~32 slots
    // old, so it spends most of its validity window before the send and
    // expired mid-confirmation — "block height exceeded", which burnt W55.
    // 'confirmed' gives the full window, and skipping preflight means no node
    // has to have seen it before the send.
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    const signature = await sendAndConfirmTransaction(connection, tx, [player, passAsset], {
      commitment: 'confirmed',
      maxRetries: 5,
      skipPreflight: true,
    });
    const parsed = await connection.getTransaction(signature, {
      commitment: 'confirmed', maxSupportedTransactionVersion: 0,
    });
    console.log(`  ${walletId} OK  ${signature}  slot ${parsed?.slot ?? '?'}`);
    return { ...base, ok: true, signature, slot: parsed?.slot, battlesHashHex };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`  ${walletId} FAILED  ${error}`);
    if (sealed) {
      console.error(
        `  ${walletId} SEALED THEN FAILED — this wallet can never enter pool ${pool.id} again. ` +
        `Its ciphertext is stored and cannot be replaced or deleted (DRIFT.md §H6).`
      );
    }
    return { ...base, sealed, error };
  }
}

// --- entry point -------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const test = flags.test ?? 'ad-hoc';
  const poolId = flags.pool;
  if (!poolId) throw new Error('--pool <id> is required');
  // The plan is the source of truth for who enters and with what. Reading it
  // here is what makes a run reproducible from the committed prediction.
  interface PlanSeat { wallet: string; route?: string; generator?: string; seed?: number; battles?: number[][] }
  let planSeats: PlanSeat[] | null = null;
  if (flags.plan) {
    const doc = JSON.parse(readFileSync(resolve(process.cwd(), flags.plan), 'utf8')) as { seats: PlanSeat[] };
    planSeats = doc.seats.filter((x) => (x.route ?? 'direct') === 'direct');
  }
  // Mutable: --substitute swaps a burnt seat for its spare in place, below.
  const walletIds: string[] = planSeats
    ? planSeats.map((x) => x.wallet)
    : parseWallets(flags.wallets ?? 'W00-W09');
  const dryRun = flags['dry-run'] === 'true';
  const simulate = flags.simulate === 'true';
  const concurrency = Math.max(1, Math.min(16, Number(flags.concurrency ?? 4)));
  const indexer = flags.indexer ?? process.env.BLOTTO_INDEXER_URL ?? DEFAULT_INDEXER;
  const packetApi = flags.packet ?? process.env.BLOTTO_PACKET_URL ?? DEFAULT_PACKET;
  const rpc = flags.rpc ?? process.env.BLOTTO_RPC_URL ?? process.env.RPC_URL;
  if (!rpc) throw new Error('BLOTTO_RPC_URL is not set and --rpc was not given');

  const terms = JSON.parse(
    require('fs').readFileSync(resolve(__dirname, '..', '..', 'config', 'terms.json'), 'utf8')
  ) as TermsEdition;
  const master = masterFromEnv();
  const connection = new Connection(rpc, { commitment: 'confirmed' });
  const pool = await readPool(indexer, poolId);

  console.log(
    `pool ${pool.id} (${pool.pool}) tier ${pool.tier} — ${pool.state}, ${pool.entrants} seated, ` +
    `min_seats ${pool.min_seats}, entry ${Number(pool.entry_lamports) / 1e9} SOL`
  );
  console.log(`if the deadline passed now: ${pool.outcome_if_deadline_now}`);
  if (pool.state !== 'Open' && !dryRun) {
    throw new Error(`pool ${pool.id} is ${pool.state}, not Open — refusing to enter`);
  }

  // A freshly opened pool is not enterable for a few seconds. `open_pool` is
  // the first of THREE transactions: `commit_vrf_seed` fills the randomness
  // sentinel and `create_pass_collection` creates the collection every pass is
  // minted into, both separately and permissionlessly. Until both land,
  // `register` reverts with VrfSeedNotCommitted (6004) or fails inside the mint
  // CPI. Checking here turns a bare program error at the rollover into an
  // instruction to wait one more tick.
  if (!dryRun) {
    const notReady = await poolNotReady(connection, pool);
    if (notReady) {
      throw new Error(
        `pool ${pool.id} is Open but not yet enterable — ${notReady}. ` +
        'The daemon lands these within a tick or two of opening; re-run shortly.'
      );
    }
  }
  const mode = dryRun
    ? 'DRY RUN — '
    : simulate
      ? 'SIMULATE (nothing sent, nothing sealed) — '
      : '';
  console.log(`${mode}entering ${walletIds.length} seats: ${walletIds.join(', ')}\n`);

  // Where the plan names a generator and a seed per seat, those decide the
  // battles; otherwise fall back to the four-strategy mix indexed by seat.
  const population = poolPopulation(Number(flags.seed ?? pool.id));
  const fromPlan = new Map<string, GeneratedEntrant>();
  for (const seat of planSeats ?? []) {
    if (seat.battles) {
      fromPlan.set(seat.wallet, {
        strategy: seat.generator ?? 'plan',
        battles: seat.battles,
        timingsMs: Array.from({ length: 7 }, (_, k) => 900 + ((seat.seed ?? 0) + k * 137) % 2600),
      });
    } else if (seat.seed !== undefined) {
      // Deterministic from the frozen seed: the same plan always produces the
      // same seven battle sets for this wallet, on any machine.
      fromPlan.set(seat.wallet, generateEntrant('random', seat.seed));
    }
  }

  // A burnt seat (sealed, never registered) can never enter this pool again, so
  // it must be replaced by a spare. The replacement plays the BURNT SEAT'S OWN
  // planned allocation, not a fresh one: a rank falls out of the allocations,
  // never the wallet holding them, so substituting this way leaves every
  // predicted rank and payout in the frozen plan exactly as frozen. Only the
  // results root moves, and that was always conditional on seat order.
  for (const pair of (flags.substitute ?? '').split(',').filter(Boolean)) {
    const [burnt, spare] = pair.split('=').map((x) => x.trim());
    const seat = fromPlan.get(burnt);
    if (!seat) throw new Error(`--substitute ${pair}: ${burnt} is not in the plan`);
    if (fromPlan.has(spare)) throw new Error(`--substitute ${pair}: ${spare} is already a plan seat`);
    fromPlan.set(spare, seat);
    // The seat list comes from the PLAN when --plan is given, so the spare has
    // to be swapped into it too or it is never attempted. The burnt id comes
    // out: it cannot enter this pool again, and leaving it in only produces a
    // noisy 409 per run.
    const at = walletIds.indexOf(burnt);
    if (at >= 0) walletIds.splice(at, 1, spare);
    else walletIds.push(spare);
    console.log(`  substitute: ${spare} plays ${burnt}'s frozen allocation`);
  }

  const results: SeatResult[] = [];
  for (let i = 0; i < walletIds.length; i += concurrency) {
    const slice = walletIds.slice(i, i + concurrency);
    const batch = await Promise.all(
      slice.map((id) => {
        const index = Number(id.replace(/^W/i, ''));
        const entrant = fromPlan.get(id) ?? population[index] ?? generateEntrant('random', index);
        return enterOne({ connection, master, walletId: id, index, entrant, pool, packetApi, dryRun, terms, simulate });
      })
    );
    results.push(...batch);

    // THE STOP (DRIFT.md §H6). A seat that sealed and then failed is burnt:
    // that wallet is barred from this pool for good. If the cause is the entry
    // gate rather than this one wallet, marching into the next batch burns the
    // rest of the field the same way — which is precisely how one outage would
    // cost sixty wallets instead of one. Stop, name the casualties, and let a
    // human decide.
    const burnt = batch.filter((r) => r.sealed && !r.ok);
    if (burnt.length > 0) {
      console.error(
        `\nSTOPPING after ${results.length} of ${walletIds.length} seats. ` +
        `${burnt.length} sealed and then failed: ${burnt.map((r) => r.wallet).join(', ')}.\n` +
        `Those wallets are barred from pool ${pool.id} permanently and must be replaced from the ` +
        `spare roster, not retried. Diagnose the gate before running again — if it is down, every ` +
        `remaining seat would be burnt the same way.`
      );
      break;
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const burntAll = results.filter((r) => r.sealed && !r.ok);
  console.log(`\n${ok}/${results.length} landed`);
  if (burntAll.length > 0) {
    console.log(`${burntAll.length} BURNT (sealed, never registered): ${burntAll.map((r) => r.wallet).join(', ')}`);
  }

  if (!dryRun && !simulate) {
    const dir = resolve(__dirname, '..', 'evidence', `${test}-pool-${pool.id}`);
    mkdirSync(dir, { recursive: true });
    const logPath = resolve(dir, 'headless-register.log');
    for (const r of results) appendFileSync(logPath, JSON.stringify(r) + '\n');
    writeFileSync(resolve(dir, 'pool.json'), JSON.stringify(pool, null, 2) + '\n');
    console.log(`log → ${logPath}`);
  }
  if (ok !== results.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
