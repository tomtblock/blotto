/**
 * `Web3Chain` — the 827-line settlement client, executed (audit 2026-09-11,
 * G-02 / G-11 / G-06 / D-40).
 *
 * WHAT WAS TRUE BEFORE THIS FILE. Nothing ran a single line of this module.
 * Its own header claimed "the LiteSVM suite ... those tests are what pin this
 * file's correctness", and that is not so: the LiteSVM suite drives the
 * compiled program through its OWN byte-level client, so it proves the
 * program right and says nothing whatever about this one. Every crank and
 * daemon spec drives `FakeChain`, which never constructs an account meta or
 * an instruction byte. `account-metas.spec.ts` and `entry-layout.spec.ts`
 * read this file as TEXT. `D-40`: one constant of it was under test.
 *
 * Three things it decides, each of which is a wrong number paid to a real
 * person when it is wrong, and none of which throws when it is:
 *
 *   1. THE POOL ACCOUNT'S BYTE OFFSETS. ~45 of them, hard-coded in
 *      `getPool`. A wrong one reads a neighbouring field — `paidMask` from
 *      the middle of a payout, `entrants` from a tier byte — and the crank
 *      acts on it. Here the account bytes are built from a layout DERIVED
 *      FROM `state.rs` (the running sum of the declared field widths, the
 *      discipline `entry-layout.spec.ts` established), every field given a
 *      distinct recognisable value, and the production decoder is required
 *      to read each one back.
 *   2. THE INSTRUCTION WIRE FORMAT. The discriminator, the Borsh argument
 *      encoding, and the account list in the program's declared order. The
 *      discriminator is recomputed here from the instruction's name rather
 *      than copied from the client, and each argument is decoded back out of
 *      the bytes the client produced.
 *   3. WHICH KEY SIGNS. An admin instruction sent with the settlement signer
 *      can never land (B-47); `account-metas.spec.ts` checks that by regex,
 *      this checks the signer array actually handed to the RPC.
 *
 * HOW IT RUNS OFFLINE. `sendAndConfirmTransaction` is a thin wrapper that
 * calls `connection.sendTransaction(...)` and then `connection.confirmTransaction(...)`,
 * so a fake `Connection` captures the whole `Transaction` — instructions,
 * account metas, data and signers — without any patching of module exports
 * and without a cluster.
 *
 * WHAT IT STILL DOES NOT PROVE. That the program ACCEPTS these bytes. Only a
 * runtime can say that, and the answer to it is the LiteSVM lane — which
 * drives its own client and therefore still cannot see a defect in this one.
 * The two halves meet at the program's declared wire contract, and this file
 * pins this side of it.
 */
import { expect } from 'chai';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  ENTRY_LAYOUT,
  ENTRY_SPACE,
  POOL_SPACE,
  POOL_SPACE_V2,
  POOL_SPACE_V3,
  POOL_TYPE_DISCRIMINATOR,
  POOL_TYPE_SPACE,
  Web3Chain,
  poolTypeRemainingAccounts,
} from '../src/chain-web3';
import {
  POOL_TYPE_OFFSETS,
  compareAddressBytes,
  poolTypeSeeds,
} from '../../_shared/src/pool-type-account';
import { CONFIG_OFFSETS, CONFIG_SPACE } from '../../_shared/src/config-account';
import { base58Encode } from '../../_shared/src/blotto-events';
import { TIER_ENTRY_LAMPORTS, ladderTable, minFieldFor, prizePoolFor } from '../../scoring/src';

const STATE_RS = join(__dirname, '../../../programs/blotto_cup/src/state.rs');
const CONSTANTS_RS = join(__dirname, '../../../programs/blotto_cup/src/constants.rs');
const rust = readFileSync(STATE_RS, 'utf8');

// ---------------------------------------------------------------------------
// The Pool layout, derived from the Rust rather than restated
// ---------------------------------------------------------------------------

/** A `constants.rs` integer constant, read from the source. */
function rustConst(name: string): number {
  const m = new RegExp(`pub const ${name}: \\w+ = (\\d+);`).exec(readFileSync(CONSTANTS_RS, 'utf8'));
  expect(m, `constants.rs no longer declares ${name}`).to.not.equal(null);
  return Number(m![1]);
}

/** `constants.rs::CAPACITY` — the largest pool (64), which sizes the fixed
 * `payouts` array and `paid_mask` whatever a pool's own capacity is. */
const capacity = (): number => rustConst('CAPACITY');

/** Borsh widths for the types `Pool` and `PoolType` declare. Fixed width, no padding. */
function widths(): Record<string, number> {
  return {
    u64: 8,
    i64: 8,
    u16: 2,
    u8: 1,
    bool: 1,
    PoolState: 1, // a fieldless enum — one byte of discriminant
    '[u8; 32]': 32,
    '[u16; 5]': 10,
    // `Payout { entry_index: u16, amount: u64 }` × CAPACITY.
    '[Payout; CAPACITY as usize]': 10 * capacity(),
    // The Ladder's prize table (D-E19): whole multiples, zero-padded.
    '[u8; MAX_PAID_PLACES]': rustConst('MAX_PAID_PLACES'),
  };
}

/** One struct's fields in declaration order, parsed from `state.rs`. */
function fieldsOf(structName: string): Array<{ name: string; type: string }> {
  const start = rust.indexOf(`pub struct ${structName} {`);
  expect(start, `state.rs no longer declares \`pub struct ${structName}\``).to.not.equal(-1);
  const body = rust.slice(start, rust.indexOf('\n}', start));
  return [...body.matchAll(/^\s*pub (\w+): ([^,]+),/gm)].map((m) => ({
    name: m[1],
    type: m[2].trim(),
  }));
}

/** Byte offset of every field of `structName`, the 8-byte discriminator included. */
function structOffsets(structName: string): { offsets: Record<string, number>; space: number } {
  const W = widths();
  let offset = 8;
  const offsets: Record<string, number> = {};
  for (const f of fieldsOf(structName)) {
    const width = W[f.type];
    expect(width, `no Borsh width for ${structName}.${f.name}: ${f.type}`).to.not.equal(undefined);
    offsets[f.name] = offset;
    offset += width;
  }
  return { offsets, space: offset };
}

/** Byte offset of every `Pool` field, the 8-byte discriminator included. */
const poolOffsets = () => structOffsets('Pool');

/** The value `state.rs`'s own layout test pins for a named constant. */
function pinned(expr: string): number {
  const marker = `assert_eq!(${expr},`;
  const at = rust.indexOf(marker);
  expect(at, `state.rs no longer pins ${expr}`).to.not.equal(-1);
  // The assertion ends at whichever comes first: a comma before its message
  // argument, or the closing paren when it has none.
  const rest = rust.slice(at + marker.length);
  const end = Math.min(
    ...[rest.indexOf(','), rest.indexOf(')')].filter((i) => i !== -1)
  );
  return Number(rest.slice(0, end).trim());
}

// ---------------------------------------------------------------------------
// Fixture values — each one recognisable, so a wrong offset is a wrong answer
// rather than a coincidence.
// ---------------------------------------------------------------------------

const POOL_ID = 41n;
const FIXTURE = {
  id: POOL_ID,
  tier: 3,
  entry_lamports: 700_000_000n,
  pot_lamports: 4_000_000_000n,
  entrants: 57,
  opened_at: 1_757_600_000n,
  fill_deadline: 1_757_643_200n,
  state: 2, // 'Scored' — index into STATE_NAMES
  sealing_pubkey: Buffer.alloc(32, 0xa1),
  sealing_secret_hash: Buffer.alloc(32, 0xb2),
  vrf_seed: Buffer.alloc(32, 0xc3),
  secret_revealed: 1,
  results_root: Buffer.alloc(32, 0xd4),
  results_committed: 1,
  payouts: [
    { entry_index: 9, amount: 3_000_000_000n },
    { entry_index: 12, amount: 1_000_000_000n },
  ],
  paid_mask: (1n << 9n) | (1n << 12n),
  refunded_count: 0,
  timer_seconds: 15,
  // R7-b / Phase B / the Ladder (D-E19): a 16-player pool's terms, distinct
  // from the 64-player defaults a pre-Ladder reconstruction would give.
  min_seats: minFieldFor(16),
  mode: 0,
  capacity: 16,
  paid_places: ladderTable(16).length,
  prize_table: [...ladderTable(16)],
};

/** A `Pool` account's bytes, written at the offsets the RUST declares. */
function poolAccount(
  over: Partial<Record<string, unknown>> = {}
): { data: Buffer; offsets: Record<string, number> } {
  const { offsets, space } = poolOffsets();
  const v = { ...FIXTURE, ...over } as typeof FIXTURE;
  const d = Buffer.alloc(space);
  d.write('POOLDISC', 0, 'ascii'); // the 8-byte Anchor discriminator, unread here
  d.writeBigUInt64LE(v.id, offsets.id);
  d.writeUInt8(v.tier, offsets.tier);
  d.writeBigUInt64LE(v.entry_lamports, offsets.entry_lamports);
  d.writeBigUInt64LE(v.pot_lamports, offsets.pot_lamports);
  d.writeUInt16LE(v.entrants, offsets.entrants);
  d.writeBigInt64LE(v.opened_at, offsets.opened_at);
  d.writeBigInt64LE(v.fill_deadline, offsets.fill_deadline);
  d.writeUInt8(v.state, offsets.state);
  v.sealing_pubkey.copy(d, offsets.sealing_pubkey);
  v.sealing_secret_hash.copy(d, offsets.sealing_secret_hash);
  v.vrf_seed.copy(d, offsets.vrf_seed);
  // class_counters: five u16, each distinct — cosmetic, read by nothing here,
  // written so a decoder that strayed into them returns a recognisable value.
  for (let i = 0; i < 5; i++) d.writeUInt16LE(60 + i, offsets.class_counters + i * 2);
  d.writeUInt8(v.secret_revealed, offsets.secret_revealed);
  v.results_root.copy(d, offsets.results_root);
  d.writeUInt8(v.results_committed, offsets.results_committed);
  d.writeUInt16LE(v.payouts.length, offsets.payouts_len);
  v.payouts.forEach((p, i) => {
    d.writeUInt16LE(p.entry_index, offsets.payouts + i * 10);
    d.writeBigUInt64LE(p.amount, offsets.payouts + i * 10 + 2);
  });
  d.writeBigUInt64LE(v.paid_mask, offsets.paid_mask);
  d.writeUInt16LE(v.refunded_count, offsets.refunded_count);
  d.writeUInt8(v.timer_seconds, offsets.timer_seconds);
  d.writeUInt16LE(v.min_seats, offsets.min_seats);
  d.writeUInt8(v.mode, offsets.mode);
  d.writeUInt16LE(v.capacity, offsets.capacity);
  d.writeUInt8(v.paid_places, offsets.paid_places);
  v.prize_table.forEach((m, i) => d.writeUInt8(m, offsets.prize_table + i));
  return { data: d, offsets };
}

/** A `PoolType` account's bytes (57), at the shared layout's offsets. */
function poolTypeAccount(t: {
  mode: number;
  tier: number;
  capacity: number;
  enabled?: boolean;
  activePool?: bigint;
  nextOpenAt?: bigint;
  discriminator?: Buffer;
}): Buffer {
  const O = POOL_TYPE_OFFSETS;
  const d = Buffer.alloc(POOL_TYPE_SPACE);
  (t.discriminator ?? POOL_TYPE_DISCRIMINATOR).copy(d, 0);
  const table = ladderTable(t.capacity);
  d.writeUInt8(t.mode, O.mode);
  d.writeUInt8(t.tier, O.tier);
  d.writeUInt16LE(t.capacity, O.capacity);
  d.writeUInt16LE(minFieldFor(t.capacity), O.minSeats);
  d.writeUInt8(table.length, O.paidPlaces);
  table.forEach((m, i) => d.writeUInt8(m, O.prizeTable + i));
  d.writeBigUInt64LE(prizePoolFor(table, TIER_ENTRY_LAMPORTS[t.tier]), O.potLamports);
  d.writeUInt8(t.enabled === false ? 0 : 1, O.enabled);
  d.writeBigUInt64LE(t.activePool ?? 0n, O.activePool);
  d.writeBigInt64LE(t.nextOpenAt ?? 0n, O.nextOpenAt);
  d.writeUInt8(254, O.bump);
  return d;
}

/** A 605-byte Config whose only meaningful field here is the enabled count. */
function configAccount(enabledPoolTypes: number): Buffer {
  const d = Buffer.alloc(CONFIG_SPACE);
  d.writeUInt16LE(enabledPoolTypes, CONFIG_OFFSETS.enabledPoolTypes);
  return d;
}

/** An `Entry` account's bytes, written at the offsets `ENTRY_LAYOUT` names. */
function entryAccount(over: {
  player: PublicKey;
  index: number;
  flagged?: boolean;
  settled?: boolean;
  refunded?: boolean;
  forfeited?: boolean;
  escrowLamports?: bigint;
  escrowedAt?: bigint;
  sanctionsHold?: boolean;
  nextPlaceLamports?: bigint;
  splitTotal?: bigint;
  splitPaidMask?: bigint;
  splitGroupSize?: number;
  splitRemainderPaid?: boolean;
  battlesHash?: Buffer;
}): Buffer {
  const d = Buffer.alloc(ENTRY_SPACE);
  over.player.toBuffer().copy(d, ENTRY_LAYOUT.player);
  d.writeUInt16LE(over.index, ENTRY_LAYOUT.index);
  (over.battlesHash ?? Buffer.alloc(32, 0xee)).copy(d, ENTRY_LAYOUT.battles_hash);
  d.writeUInt8(over.flagged ? 1 : 0, ENTRY_LAYOUT.flagged);
  d.writeUInt8(over.settled ? 1 : 0, ENTRY_LAYOUT.settled);
  d.writeUInt8(over.refunded ? 1 : 0, ENTRY_LAYOUT.refunded);
  d.writeBigUInt64LE(over.escrowLamports ?? 0n, ENTRY_LAYOUT.escrow_lamports);
  d.writeBigInt64LE(over.escrowedAt ?? 0n, ENTRY_LAYOUT.escrowed_at);
  d.writeUInt8(over.forfeited ? 1 : 0, ENTRY_LAYOUT.forfeited);
  d.writeBigUInt64LE(over.nextPlaceLamports ?? 0n, ENTRY_LAYOUT.next_place_lamports);
  d.writeBigUInt64LE(over.splitTotal ?? 0n, ENTRY_LAYOUT.split_total);
  d.writeBigUInt64LE(over.splitPaidMask ?? 0n, ENTRY_LAYOUT.split_paid_mask);
  d.writeUInt16LE(over.splitGroupSize ?? 0, ENTRY_LAYOUT.split_group_size);
  d.writeUInt8(over.splitRemainderPaid ? 1 : 0, ENTRY_LAYOUT.split_remainder_paid);
  d.writeUInt8(over.sanctionsHold ? 1 : 0, ENTRY_LAYOUT.sanctions_hold);
  return d;
}

// ---------------------------------------------------------------------------
// The offline cluster
// ---------------------------------------------------------------------------

/** A fixture program id. The client derives every PDA from whatever id it
 * is configured with, so the deployed address is not what is under test
 * here — the derivation and the account order are. */
const PROGRAM_ID = Keypair.fromSeed(new Uint8Array(32).fill(200)).publicKey;

interface Sent {
  transaction: Transaction;
  signers: Keypair[];
}

/**
 * A `Connection` that answers from a table and records what it was asked to
 * send. `sendAndConfirmTransaction` calls `sendTransaction` then
 * `confirmTransaction` on whatever object it is handed, so nothing here needs
 * to patch a module or reach a cluster.
 */
function fakeCluster(accounts: Record<string, Buffer | null> = {}): {
  connection: Connection;
  sent: Sent[];
  programAccounts: Array<{ pubkey: PublicKey; account: { data: Buffer } }>;
  filters: unknown[];
} {
  const sent: Sent[] = [];
  const programAccounts: Array<{ pubkey: PublicKey; account: { data: Buffer } }> = [];
  const filters: unknown[] = [];
  const connection = {
    async getAccountInfo(address: PublicKey) {
      const data = accounts[address.toBase58()];
      return data ? { data, lamports: 1_000_000, owner: PROGRAM_ID } : null;
    },
    async getProgramAccounts(_programId: PublicKey, config: { filters?: unknown[] }) {
      filters.push(config.filters);
      return programAccounts;
    },
    async getMinimumBalanceForRentExemption(space: number) {
      return space === 0 ? 890_880 : 1_000_000;
    },
    async sendTransaction(transaction: Transaction, signers: Keypair[]) {
      sent.push({ transaction, signers });
      return 'SIGNATURE'.padEnd(64, '1');
    },
    async confirmTransaction() {
      return { value: { err: null } };
    },
  } as unknown as Connection;
  return { connection, sent, programAccounts, filters };
}

const settlementSigner = Keypair.fromSeed(new Uint8Array(32).fill(1));
const keeperSigner = Keypair.fromSeed(new Uint8Array(32).fill(2));
const adminSigner = Keypair.fromSeed(new Uint8Array(32).fill(3));

function pda(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds as Buffer[], PROGRAM_ID)[0];
}
const le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const POOL_PDA = pda([Buffer.from('pool'), le(POOL_ID)]);
const VAULT_PDA = pda([Buffer.from('vault'), le(POOL_ID)]);
const CONFIG_PDA = pda([Buffer.from('config')]);
const PLATFORM_PDA = pda([Buffer.from('platform')]);
const entryPda = (player: PublicKey) =>
  pda([Buffer.from('entry'), POOL_PDA.toBuffer(), player.toBuffer()]);
/** The pool-type PDA, from the shared seeds (D-E19). */
const poolTypePda = (mode: number, tier: number, capacity: number) =>
  pda(poolTypeSeeds(mode, tier, capacity));
/** The fixture pool's OWN type: what pay / refund name. */
const FIXTURE_TYPE_PDA = poolTypePda(FIXTURE.mode, FIXTURE.tier, FIXTURE.capacity);

/** Anchor's global instruction discriminator — recomputed, never copied. */
function discriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

/** The only instruction of the one transaction that was sent. */
function onlyIx(sent: Sent[], at = 0) {
  expect(sent.length, 'exactly one transaction').to.equal(1);
  // ComputeBudget instructions lead; the program's instruction follows.
  const program = sent[0].transaction.instructions.filter((i) =>
    i.programId.equals(PROGRAM_ID)
  );
  expect(program.length, 'program instructions in the transaction').to.be.greaterThan(at);
  return program[at];
}

/** Account metas as `pubkey/signer/writable` triples, in order. */
function metas(ix: { keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }> }) {
  return ix.keys.map((k) => `${k.pubkey.toBase58()}|${k.isSigner ? 'S' : '-'}|${k.isWritable ? 'W' : '-'}`);
}
const meta = (key: PublicKey, signer: boolean, writable: boolean) =>
  `${key.toBase58()}|${signer ? 'S' : '-'}|${writable ? 'W' : '-'}`;

function chain(
  connection: Connection,
  extra: { adminSigner?: Keypair; keeperSigner?: Keypair } = {}
): Web3Chain {
  return new Web3Chain({
    connection,
    programId: PROGRAM_ID,
    settlementSigner,
    ...extra,
  });
}

// ---------------------------------------------------------------------------

describe('the Pool account layout the settlement client decodes (G-06)', () => {
  it('the derived layout still reaches the length the program pins', () => {
    // If this fails the fixture below is being written at the wrong offsets
    // and nothing under it means anything, so it is asserted first.
    const { space } = poolOffsets();
    expect(space, 'the Pool field tally reaches Pool::SPACE').to.equal(pinned('Pool::SPACE'));
    expect(space).to.equal(8 + pinned('Pool::LEN'));
    // …and the client's own length guard is that same number (G-06).
    expect(POOL_SPACE, 'POOL_SPACE has drifted from the program').to.equal(space);
  });

  it('reads every field back from bytes laid out the way the program writes them', async () => {
    const { data } = poolAccount();
    const { connection } = fakeCluster({ [POOL_PDA.toBase58()]: data });
    const view = await chain(connection).getPool(POOL_ID);

    expect(view.poolId).to.equal(POOL_ID);
    expect(view.tier, 'tier').to.equal(FIXTURE.tier);
    expect(view.entryLamports, 'entry_lamports').to.equal(FIXTURE.entry_lamports);
    expect(view.potLamports, 'pot_lamports').to.equal(FIXTURE.pot_lamports);
    expect(view.entrants, 'entrants').to.equal(FIXTURE.entrants);
    expect(view.fillDeadline, 'fill_deadline').to.equal(FIXTURE.fill_deadline);
    expect(view.state, 'state').to.equal('Scored');
    expect(view.mode, 'mode (the fixture leaves the byte zero: easy)').to.equal(0);
    expect(view.secretRevealed, 'secret_revealed').to.equal(true);
    expect(view.vrfCommitted, 'a non-zero vrf_seed is committed').to.equal(true);
    expect(view.resultsCommitted, 'results_committed').to.equal(true);
    expect(view.resultsRootHex, 'results_root').to.equal('d4'.repeat(32));
    expect(view.paidMask, 'paid_mask').to.equal(FIXTURE.paid_mask);
    expect(view.payouts, 'the committed payout list').to.deep.equal([
      { entryIndex: 9, amountLamports: 3_000_000_000n },
      { entryIndex: 12, amountLamports: 1_000_000_000n },
    ]);
    // The Ladder tail (D-E19), read where the program writes it.
    expect(view.capacity, 'capacity').to.equal(FIXTURE.capacity);
    expect(view.minSeats, 'min_seats').to.equal(FIXTURE.min_seats);
    expect(view.paidPlaces, 'paid_places').to.equal(FIXTURE.paid_places);
    expect(view.prizeTable, 'prize_table, zero-padded to 16').to.deep.equal([
      ...FIXTURE.prize_table,
      ...new Array(16 - FIXTURE.prize_table.length).fill(0),
    ]);
  });

  it('the fields before 842 did not move: payouts and paid_mask sit where they always did', () => {
    // The Ladder APPENDED its tail (capacity @850, paid_places @852,
    // prize_table @853); the full decode's hard-coded offsets — payouts at
    // 194, paid_mask at 834 — must still be the program's.
    const { offsets } = poolOffsets();
    expect(offsets.payouts_len).to.equal(192);
    expect(offsets.payouts).to.equal(194);
    expect(offsets.paid_mask).to.equal(834);
    expect([offsets.min_seats, offsets.mode, offsets.capacity, offsets.paid_places, offsets.prize_table]).to.deep.equal([
      847, 849, 850, 852, 853,
    ]);
  });

  it('an all-zero vrf_seed is the uncommitted sentinel, and the last byte of it counts', async () => {
    const zero = poolAccount({ vrf_seed: Buffer.alloc(32) });
    const { connection } = fakeCluster({ [POOL_PDA.toBase58()]: zero.data });
    expect((await chain(connection).getPool(POOL_ID)).vrfCommitted).to.equal(false);

    // One bit set in the FINAL byte: a decoder reading 31 bytes instead of 32
    // would call this uncommitted and the keeper would re-seed a seeded pool.
    const lastByte = Buffer.alloc(32);
    lastByte[31] = 1;
    const edge = poolAccount({ vrf_seed: lastByte });
    const c2 = fakeCluster({ [POOL_PDA.toBase58()]: edge.data });
    expect((await chain(c2.connection).getPool(POOL_ID)).vrfCommitted).to.equal(true);
  });

  it('reads `mode` from the last byte, and a pre-Phase-B account (849) as easy', async () => {
    // Phase B appended `mode` (2026-09-24). A hard pool carries 1 there.
    const hard = poolAccount();
    hard.data.writeUInt8(1, hard.offsets.mode);
    const c1 = fakeCluster({ [POOL_PDA.toBase58()]: hard.data });
    expect((await chain(c1.connection).getPool(POOL_ID)).mode).to.equal(1);

    // Every pool devnet opened before the upgrade is one byte shorter
    // until `migrate_pool` grows it, and the settlement client keeps
    // reading it meanwhile — as an easy pool, which it is.
    const old = poolAccount().data.subarray(0, POOL_SPACE_V2);
    expect(old.length).to.equal(849);
    const c2 = fakeCluster({ [POOL_PDA.toBase58()]: Buffer.from(old) });
    const view = await chain(c2.connection).getPool(POOL_ID);
    expect(view.mode).to.equal(0);
    expect(view.state).to.equal('Scored');
    expect(view.paidMask).to.equal(FIXTURE.paid_mask);

    // The pre-R7-b 847 is still refused: a size this reader never met.
    const older = poolAccount().data.subarray(0, 847);
    const c3 = fakeCluster({ [POOL_PDA.toBase58()]: Buffer.from(older) });
    let message = '';
    await chain(c3.connection)
      .getPool(POOL_ID)
      .catch((e: Error) => (message = e.message));
    expect(message).to.match(/847 bytes; Pool::SPACE is 869/);
  });

  it('a pre-Ladder account (850) still decodes — as 64 players and one place worth the prize pool', async () => {
    // Every devnet pool until `migrate_pool` runs after the Ladder upgrade:
    // read as what its players entered under (`preLadderTable`), never as
    // the zero bytes a short account would hand a fixed-offset read.
    expect(POOL_SPACE_V3).to.equal(pinned('Pool::SPACE_V3'));
    const entry = TIER_ENTRY_LAMPORTS[0];
    const pot = prizePoolFor(ladderTable(64), entry);
    const full = poolAccount({ entry_lamports: entry, pot_lamports: pot, min_seats: minFieldFor(64), mode: 1 });
    const pre = Buffer.from(full.data.subarray(0, POOL_SPACE_V3));
    const { connection } = fakeCluster({ [POOL_PDA.toBase58()]: pre });
    const view = await chain(connection).getPool(POOL_ID);
    expect(view.capacity).to.equal(64);
    expect(view.paidPlaces).to.equal(1);
    expect(view.prizeTable).to.deep.equal([Number(pot / entry), ...new Array(15).fill(0)]);
    expect(view.minSeats).to.equal(minFieldFor(64));
    expect(view.mode).to.equal(1);
    expect(view.paidMask).to.equal(FIXTURE.paid_mask);
    expect(view.payouts.length).to.equal(2);
  });

  it('an uncommitted pool reports no root and no payouts, whatever the bytes hold', async () => {
    // `results_root` and the payout array still carry their fixture values;
    // `results_committed` is what decides, and the client must read THAT byte.
    const { data } = poolAccount({ results_committed: 0 });
    const { connection } = fakeCluster({ [POOL_PDA.toBase58()]: data });
    const view = await chain(connection).getPool(POOL_ID);
    expect(view.resultsCommitted).to.equal(false);
    expect(view.resultsRootHex).to.equal(null);
    expect(view.payouts).to.deep.equal([]);
  });

  it('decodes every PoolState name at its own discriminant', async () => {
    const names = ['Open', 'Sealed', 'Scored', 'Paid', 'Refunding', 'Closed'];
    for (const [i, name] of names.entries()) {
      const { data } = poolAccount({ state: i });
      const { connection } = fakeCluster({ [POOL_PDA.toBase58()]: data });
      expect((await chain(connection).getPool(POOL_ID)).state, `discriminant ${i}`).to.equal(name);
    }
    // The Rust enum declares exactly these, in this order.
    const enumStart = rust.indexOf('pub enum PoolState {');
    expect(enumStart, 'state.rs no longer declares PoolState').to.not.equal(-1);
    const body = rust.slice(enumStart, rust.indexOf('\n}', enumStart));
    const variants = [...body.matchAll(/^\s{4}(\w+),/gm)].map((m) => m[1]);
    expect(variants).to.deep.equal(names);
  });

  it('refuses an account that is not a Pool rather than returning a number from it', async () => {
    // The failure mode G-06 names: no length guard. An Entry account (228
    // bytes) handed to this decoder must not produce a pool view.
    const short = entryAccount({ player: settlementSigner.publicKey, index: 0 });
    const { connection } = fakeCluster({ [POOL_PDA.toBase58()]: short });
    let threw: Error | null = null;
    try {
      await chain(connection).getPool(POOL_ID);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw, 'a 228-byte account must not decode as a Pool').to.not.equal(null);
    expect(threw!.message, 'and must say what it found').to.match(/228/);
  });

  it('a missing pool account is an error, not an empty view', async () => {
    const { connection } = fakeCluster({});
    let threw: Error | null = null;
    try {
      await chain(connection).getPool(POOL_ID);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw?.message ?? '').to.match(/not found/);
  });
});

describe('the Entry accounts the settlement client reads (getEntries)', () => {
  it('filters on the program`s Entry size and the pool, and sorts by seat', async () => {
    const players = [0, 1, 2].map((i) => Keypair.fromSeed(new Uint8Array(32).fill(10 + i)).publicKey);
    const { connection, programAccounts, filters } = fakeCluster();
    // Deliberately out of seat order: the client must sort.
    programAccounts.push(
      { pubkey: entryPda(players[2]), account: { data: entryAccount({ player: players[2], index: 2, flagged: true }) } },
      { pubkey: entryPda(players[0]), account: { data: entryAccount({ player: players[0], index: 0, escrowLamports: 4_000_000_000n, escrowedAt: 1_757_600_000n }) } },
      { pubkey: entryPda(players[1]), account: { data: entryAccount({ player: players[1], index: 1, settled: true, splitTotal: 2_000_000_000n, splitPaidMask: 5n, splitGroupSize: 3, splitRemainderPaid: true, sanctionsHold: true }) } }
    );

    const entries = await chain(connection).getEntries(POOL_ID);
    expect(filters[0], 'the size filter and the pool memcmp').to.deep.equal([
      { dataSize: ENTRY_SPACE },
      { memcmp: { offset: 8, bytes: POOL_PDA.toBase58() } },
    ]);
    expect(entries.map((e) => e.index), 'seat-ascending').to.deep.equal([0, 1, 2]);
    expect(entries.map((e) => e.player)).to.deep.equal(players.map((p) => p.toBase58()));

    expect(entries[0].escrowLamports).to.equal(4_000_000_000n);
    expect(entries[0].escrowedAt).to.equal(1_757_600_000n);
    expect(entries[0].flagged).to.equal(false);
    expect(entries[1].settled).to.equal(true);
    expect(entries[1].sanctionsHold).to.equal(true);
    // The split frame the next-place driver resumes from (audit D-11).
    expect(entries[1].splitTotal).to.equal(2_000_000_000n);
    expect(entries[1].splitPaidMask).to.equal(5n);
    expect(entries[1].splitGroupSize).to.equal(3);
    expect(entries[1].splitRemainderPaid).to.equal(true);
    expect(entries[2].flagged).to.equal(true);
    expect(entries[2].battlesHash).to.equal('ee'.repeat(32));
  });
});

describe('the instruction wire format, decoded back out of the bytes sent', () => {
  /** A cluster holding Config and the eight launch pool types (D-E19). */
  function ladderCluster(over: { enabled?: number; disabled?: string[] } = {}) {
    const types = [0, 1].flatMap((mode) => [8, 16, 32, 64].map((capacity) => ({ mode, tier: 0, capacity })));
    const disabled = new Set(over.disabled ?? []);
    const enabledCount = over.enabled ?? types.filter((t) => !disabled.has(`${t.mode}:${t.capacity}`)).length;
    const cluster = fakeCluster({ [CONFIG_PDA.toBase58()]: configAccount(enabledCount) });
    for (const t of types) {
      cluster.programAccounts.push({
        pubkey: poolTypePda(t.mode, t.tier, t.capacity),
        account: {
          data: poolTypeAccount({ ...t, enabled: !disabled.has(`${t.mode}:${t.capacity}`) }),
        },
      });
    }
    return { ...cluster, types };
  }

  it('open_pool: keeper-signed, its pool type writable, every OTHER enabled type after it in address order', async () => {
    const { connection, sent, types } = ladderCluster();
    const sealingPubkey = new Uint8Array(32).fill(0x7a);
    const secretHash = new Uint8Array(32).fill(0x7b);
    await chain(connection, { keeperSigner }).openPool(POOL_ID, 0, sealingPubkey, secretHash, 1, 16);

    const ix = onlyIx(sent);
    const opening = poolTypePda(1, 0, 16);
    const others = types
      .map((t) => poolTypePda(t.mode, t.tier, t.capacity))
      .filter((k) => !k.equals(opening))
      .sort((a, b) => compareAddressBytes(a.toBytes(), b.toBytes()));
    expect(others.length, 'enabled_pool_types − 1').to.equal(7);
    expect(metas(ix)).to.deep.equal([
      meta(keeperSigner.publicKey, true, true),
      meta(CONFIG_PDA, false, true),
      meta(POOL_PDA, false, true),
      meta(VAULT_PDA, false, true),
      meta(PLATFORM_PDA, false, true),
      meta(opening, false, true), // D-E19: the type being opened
      meta(SystemProgram.programId, false, false),
      // Remaining: the other enabled types, read-only, strictly ascending
      // by raw address bytes (the program compares `Pubkey`s).
      ...others.map((k) => meta(k, false, false)),
    ]);
    expect(sent[0].signers.map((s) => s.publicKey.toBase58()), 'the keeper pays the rent').to.deep.equal([
      keeperSigner.publicKey.toBase58(),
    ]);

    const data = ix.data;
    expect(data.subarray(0, 8).equals(discriminator('open_pool'))).to.equal(true);
    expect(data.subarray(0, 8).toString('hex'), 'the contract`s discriminator').to.equal('60d76e3d01f6cde4');
    expect(data.readBigUInt64LE(8), 'pool_id').to.equal(POOL_ID);
    expect(data[16], 'tier').to.equal(0);
    expect(data.subarray(17, 49).equals(Buffer.from(sealingPubkey))).to.equal(true);
    expect(data.subarray(49, 81).equals(Buffer.from(secretHash))).to.equal(true);
    // Phase B: `mode`; D-E19: `capacity` u16 LE, appended after it.
    expect(data[81], 'mode').to.equal(1);
    expect(data.readUInt16LE(82), 'capacity').to.equal(16);
    expect(data.length, 'no trailing bytes').to.equal(84);
  });

  it('open_pool leaves disabled types out of the list, and refuses to open one', async () => {
    const { connection, sent } = ladderCluster({ disabled: ['0:32', '1:64'] });
    await chain(connection).openPool(POOL_ID, 0, new Uint8Array(32), new Uint8Array(32), 0, 8);
    const ix = onlyIx(sent);
    expect(ix.keys.length, '7 fixed + (6 enabled − 1)').to.equal(7 + 5);
    const listed = ix.keys.slice(7).map((k) => k.pubkey.toBase58());
    expect(listed).to.not.include(poolTypePda(0, 0, 32).toBase58());
    expect(listed).to.not.include(poolTypePda(1, 0, 64).toBase58());

    const again = ladderCluster({ disabled: ['0:32'] });
    let threw = '';
    await chain(again.connection)
      .openPool(POOL_ID, 0, new Uint8Array(32), new Uint8Array(32), 0, 32)
      .catch((e: Error) => (threw = e.message));
    expect(threw).to.match(/PoolTypeDisabled/);
    expect(again.sent.length, 'nothing is sent').to.equal(0);
  });

  it('open_pool refuses to send a list Config would not believe (a lagging read)', async () => {
    // Config counts nine enabled types; the RPC returned eight.
    const { connection, sent } = ladderCluster({ enabled: 9 });
    let threw = '';
    await chain(connection)
      .openPool(POOL_ID, 0, new Uint8Array(32), new Uint8Array(32), 0, 8)
      .catch((e: Error) => (threw = e.message));
    expect(threw).to.match(/PoolTypeListIncomplete/);
    expect(sent.length).to.equal(0);
  });

  it('open_pool refuses a capacity that is not a pool size before any read', async () => {
    const { connection, sent } = ladderCluster();
    let threw = '';
    await chain(connection)
      .openPool(POOL_ID, 0, new Uint8Array(32), new Uint8Array(32), 0, 12)
      .catch((e: Error) => (threw = e.message));
    expect(threw).to.match(/no pool of 12 players/);
    expect(sent.length).to.equal(0);
  });

  it('open_pool defaults the keeper to the settlement signer when no keeper key is held', async () => {
    const { connection, sent } = ladderCluster();
    await chain(connection).openPool(POOL_ID, 0, new Uint8Array(32), new Uint8Array(32), 0, 64);
    expect(sent[0].signers.map((s) => s.publicKey.toBase58())).to.deep.equal([
      settlementSigner.publicKey.toBase58(),
    ]);
  });

  it('reveal_pool_secret carries the 32-byte secret after the pool id', async () => {
    const { connection, sent } = fakeCluster();
    const secret = new Uint8Array(32).map((_, i) => i + 1);
    await chain(connection).revealPoolSecret(POOL_ID, secret);
    const ix = onlyIx(sent);
    expect(metas(ix)).to.deep.equal([
      meta(settlementSigner.publicKey, true, false),
      meta(CONFIG_PDA, false, false),
      meta(POOL_PDA, false, true),
    ]);
    expect(ix.data.subarray(0, 8).equals(discriminator('reveal_pool_secret'))).to.equal(true);
    expect(ix.data.readBigUInt64LE(8)).to.equal(POOL_ID);
    expect(ix.data.subarray(16, 48).equals(Buffer.from(secret))).to.equal(true);
    expect(ix.data.length).to.equal(48);
  });

  it('commit_results encodes a Borsh Vec<Payout> the program can walk', async () => {
    const { connection, sent } = fakeCluster();
    const root = new Uint8Array(32).fill(0x5c);
    const payouts = [
      { entryIndex: 9, amountLamports: 3_000_000_000n },
      { entryIndex: 12, amountLamports: 1_000_000_000n },
    ];
    await chain(connection).commitResults(POOL_ID, root, payouts);

    const data = onlyIx(sent).data;
    expect(data.subarray(0, 8).equals(discriminator('commit_results'))).to.equal(true);
    expect(data.readBigUInt64LE(8)).to.equal(POOL_ID);
    expect(data.subarray(16, 48).equals(Buffer.from(root))).to.equal(true);
    expect(data.readUInt32LE(48), 'Borsh Vec length prefix').to.equal(2);
    // Decoded back, element by element — the whole point of a Vec encoding.
    const decoded = [0, 1].map((i) => ({
      entryIndex: data.readUInt16LE(52 + i * 10),
      amountLamports: data.readBigUInt64LE(52 + i * 10 + 2),
    }));
    expect(decoded).to.deep.equal(payouts);
    expect(data.length, '8 + 8 + 32 + 4 + 2×10').to.equal(72);
  });

  it('pay_prizes sends Config WRITABLE and one (wallet, entry) pair per seat, in order (A-01)', async () => {
    // The defect that made every payment batch revert. `account-metas.spec.ts`
    // compares the source text against the program's `mut` set; this asserts
    // the metadata the RPC is actually handed.
    const players = [0, 1, 2].map((i) => Keypair.fromSeed(new Uint8Array(32).fill(20 + i)).publicKey);
    const { connection, sent, programAccounts } = fakeCluster({
      [POOL_PDA.toBase58()]: poolAccount().data,
    });
    players.forEach((p, i) =>
      programAccounts.push({ pubkey: entryPda(p), account: { data: entryAccount({ player: p, index: i }) } })
    );

    await chain(connection).payPrizes(POOL_ID, [2, 0]);
    const ix = onlyIx(sent);
    expect(metas(ix)).to.deep.equal([
      meta(settlementSigner.publicKey, true, false),
      meta(CONFIG_PDA, false, true), // WRITABLE — PayPrizes declares it mut
      meta(POOL_PDA, false, true),
      meta(VAULT_PDA, false, true),
      // D-E19: the pool's OWN type, from its recorded mode/tier/capacity.
      meta(FIXTURE_TYPE_PDA, false, true),
      meta(SystemProgram.programId, false, false),
      // The seats in the order they were asked for, each wallet followed by
      // its Entry PDA.
      meta(players[2], false, true),
      meta(entryPda(players[2]), false, true),
      meta(players[0], false, true),
      meta(entryPda(players[0]), false, true),
    ]);

    const data = ix.data;
    expect(data.subarray(0, 8).equals(discriminator('pay_prizes'))).to.equal(true);
    expect(data.readBigUInt64LE(8)).to.equal(POOL_ID);
    expect(data.readUInt32LE(16), 'Borsh Vec<u16> length').to.equal(2);
    expect([data.readUInt16LE(20), data.readUInt16LE(22)]).to.deep.equal([2, 0]);
    expect(data.length).to.equal(24);
  });

  it('pay_prizes refuses to send when a seat has no entry on chain', async () => {
    const { connection, sent, programAccounts } = fakeCluster({
      [POOL_PDA.toBase58()]: poolAccount().data,
    });
    const player = Keypair.fromSeed(new Uint8Array(32).fill(30)).publicKey;
    programAccounts.push({ pubkey: entryPda(player), account: { data: entryAccount({ player, index: 0 }) } });
    let threw: Error | null = null;
    try {
      await chain(connection).payPrizes(POOL_ID, [7]);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw?.message ?? '').to.match(/no entry for seat 7/);
    expect(sent.length, 'nothing may be sent').to.equal(0);
  });

  it('pay_prizes refuses a pool whose results are not committed', async () => {
    const { connection, sent } = fakeCluster({
      [POOL_PDA.toBase58()]: poolAccount({ results_committed: 0 }).data,
    });
    let threw: Error | null = null;
    try {
      await chain(connection).payPrizes(POOL_ID, [0]);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw?.message ?? '').to.match(/results not committed/);
    expect(sent.length).to.equal(0);
  });

  it('pay_next_place encodes rank, amount, the proof and the split tail, with the peers last', async () => {
    const from = Keypair.fromSeed(new Uint8Array(32).fill(40)).publicKey;
    const to = Keypair.fromSeed(new Uint8Array(32).fill(41)).publicKey;
    const peers = [42, 43].map((n) => Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey);
    const proof = [
      { sibling: new Uint8Array(32).fill(0xa0), siblingOnRight: true },
      { sibling: new Uint8Array(32).fill(0xa1), siblingOnRight: false },
    ];
    const { connection, sent } = fakeCluster();
    await chain(connection).payNextPlace(
      POOL_ID,
      from.toBase58(),
      to.toBase58(),
      2,
      1_500_000_000n,
      proof,
      3,
      true,
      peers.map((p) => p.toBase58())
    );

    const ix = onlyIx(sent);
    expect(metas(ix)).to.deep.equal([
      meta(settlementSigner.publicKey, true, false),
      meta(CONFIG_PDA, false, false),
      meta(POOL_PDA, false, false),
      meta(VAULT_PDA, false, true),
      meta(entryPda(from), false, true),
      meta(entryPda(to), false, true),
      meta(to, false, true),
      meta(SystemProgram.programId, false, false),
      // remaining accounts: the other committed entries, read-only.
      meta(entryPda(peers[0]), false, false),
      meta(entryPda(peers[1]), false, false),
    ]);

    const d = ix.data;
    expect(d.subarray(0, 8).equals(discriminator('pay_next_place'))).to.equal(true);
    expect(d.readBigUInt64LE(8)).to.equal(POOL_ID);
    expect(d[16], 'rank u8').to.equal(2);
    expect(d.readBigUInt64LE(17), 'amount u64').to.equal(1_500_000_000n);
    expect(d.readUInt32LE(25), 'Vec<ProofStep> length').to.equal(2);
    let at = 29;
    for (const step of proof) {
      expect(d.subarray(at, at + 32).equals(Buffer.from(step.sibling))).to.equal(true);
      expect(d[at + 32], 'sibling_on_right').to.equal(step.siblingOnRight ? 1 : 0);
      at += 33;
    }
    expect(d.readUInt16LE(at), 'group_size u16').to.equal(3);
    expect(d[at + 2], 'takes_remainder bool').to.equal(1);
    expect(d.length).to.equal(at + 3);
  });

  it('forfeit_escrow is admin-signed, moves nothing, and never names the treasury', async () => {
    const player = Keypair.fromSeed(new Uint8Array(32).fill(50)).publicKey;
    const { connection, sent } = fakeCluster();
    await chain(connection, { adminSigner }).forfeitEscrow(POOL_ID, player.toBase58());
    const ix = onlyIx(sent);
    expect(metas(ix)).to.deep.equal([
      meta(adminSigner.publicKey, true, false),
      meta(CONFIG_PDA, false, false),
      meta(POOL_PDA, false, false),
      // The vault is READ-ONLY here: an upheld flag leaves the share in the
      // pool's vault for `pay_next_place` to divide (CLAUDE.md, D-E6/D-E7).
      meta(VAULT_PDA, false, false),
      meta(entryPda(player), false, true),
    ]);
    expect(metas(ix).some((m) => m.startsWith(PLATFORM_PDA.toBase58())), 'the treasury is not an account of this instruction').to.equal(false);
    expect(sent[0].signers.map((s) => s.publicKey.toBase58())).to.deep.equal([
      adminSigner.publicKey.toBase58(),
    ]);
  });

  it('an admin instruction refuses to build at all when this client holds no admin key', async () => {
    const player = Keypair.fromSeed(new Uint8Array(32).fill(51)).publicKey;
    const { connection, sent } = fakeCluster();
    for (const call of [
      () => chain(connection).forfeitEscrow(POOL_ID, player.toBase58()),
      () => chain(connection).liftSanctionsHold(POOL_ID, player.toBase58()),
      () => chain(connection).migrateConfig(player.toBase58()),
    ]) {
      let threw: Error | null = null;
      try {
        await call();
      } catch (e) {
        threw = e as Error;
      }
      expect(threw?.message ?? '', 'the daemon holds no admin key').to.match(/admin-signed/);
    }
    expect(sent.length).to.equal(0);
  });

  it('lift_sanctions_hold is SENT with the admin key it names as a signer (B-47)', async () => {
    const player = Keypair.fromSeed(new Uint8Array(32).fill(52)).publicKey;
    const { connection, sent } = fakeCluster();
    await chain(connection, { adminSigner }).liftSanctionsHold(POOL_ID, player.toBase58());
    const ix = onlyIx(sent);
    expect(ix.keys[0].pubkey.toBase58()).to.equal(adminSigner.publicKey.toBase58());
    expect(ix.keys[0].isSigner).to.equal(true);
    expect(
      sent[0].signers.map((s) => s.publicKey.toBase58()),
      'named as a signer and actually signing'
    ).to.deep.equal([adminSigner.publicKey.toBase58()]);
  });

  it('place_sanctions_hold and the two flag instructions share one account shape and differ only by name', async () => {
    const player = Keypair.fromSeed(new Uint8Array(32).fill(53)).publicKey;
    const expected = [
      meta(settlementSigner.publicKey, true, false),
      meta(CONFIG_PDA, false, false),
      meta(POOL_PDA, false, false),
      meta(entryPda(player), false, true),
    ];
    for (const [name, call] of [
      ['flag_entry', (c: Web3Chain) => c.flagEntry(POOL_ID, player.toBase58())],
      ['clear_flag', (c: Web3Chain) => c.clearFlag(POOL_ID, player.toBase58())],
      ['place_sanctions_hold', (c: Web3Chain) => c.placeSanctionsHold(POOL_ID, player.toBase58())],
    ] as const) {
      const { connection, sent } = fakeCluster();
      await call(chain(connection));
      const ix = onlyIx(sent);
      expect(metas(ix), name).to.deep.equal(expected);
      expect(ix.data.subarray(0, 8).equals(discriminator(name)), name).to.equal(true);
      expect(ix.data.readBigUInt64LE(8), name).to.equal(POOL_ID);
      expect(ix.data.length, name).to.equal(16);
    }
  });

  it('refund returns the price from the platform treasury, not from the prize vault', async () => {
    const player = Keypair.fromSeed(new Uint8Array(32).fill(54)).publicKey;
    const { connection, sent } = fakeCluster({ [POOL_PDA.toBase58()]: poolAccount({ state: 4 }).data });
    await chain(connection).refund(POOL_ID, player.toBase58());
    const ix = onlyIx(sent);
    expect(metas(ix)).to.deep.equal([
      meta(settlementSigner.publicKey, true, false),
      meta(CONFIG_PDA, false, true),
      meta(POOL_PDA, false, true),
      meta(PLATFORM_PDA, false, true),
      meta(entryPda(player), false, true),
      meta(player, false, true),
      // D-E19: the pool's own type — the last refund frees its slot.
      meta(FIXTURE_TYPE_PDA, false, true),
      meta(SystemProgram.programId, false, false),
    ]);
    expect(metas(ix).some((m) => m.startsWith(VAULT_PDA.toBase58())), 'the prize vault is not touched by a refund').to.equal(false);
    expect(ix.data.subarray(0, 8).equals(discriminator('refund'))).to.equal(true);
  });

  it('release_escrow names the Instructions sysvar, so an Ed25519 packet can be read', async () => {
    const player = Keypair.fromSeed(new Uint8Array(32).fill(55)).publicKey;
    const { connection, sent } = fakeCluster();
    await chain(connection).releaseEscrow(POOL_ID, player.toBase58());
    const ix = onlyIx(sent);
    expect(metas(ix)).to.deep.equal([
      meta(settlementSigner.publicKey, true, false),
      meta(CONFIG_PDA, false, false),
      meta(POOL_PDA, false, false),
      meta(VAULT_PDA, false, true),
      meta(entryPda(player), false, true),
      meta(player, false, true),
      meta(new PublicKey('Sysvar1nstructions1111111111111111111111111'), false, false),
      meta(SystemProgram.programId, false, false),
    ]);
  });

  it('seal_at_deadline and trigger_refund send the accounts their handlers write', async () => {
    const seal = fakeCluster();
    await chain(seal.connection).sealAtDeadline(POOL_ID);
    expect(metas(onlyIx(seal.sent))).to.deep.equal([
      meta(settlementSigner.publicKey, true, false),
      meta(CONFIG_PDA, false, true),
      meta(POOL_PDA, false, true),
    ]);
    expect(onlyIx(seal.sent).data.subarray(0, 8).equals(discriminator('seal_at_deadline'))).to.equal(true);

    const refundTrigger = fakeCluster({ [POOL_PDA.toBase58()]: poolAccount({ state: 0 }).data });
    await chain(refundTrigger.connection).triggerRefund(POOL_ID);
    expect(metas(onlyIx(refundTrigger.sent))).to.deep.equal([
      meta(settlementSigner.publicKey, true, false),
      meta(CONFIG_PDA, false, true),
      meta(POOL_PDA, false, true),
      meta(VAULT_PDA, false, true),
      meta(PLATFORM_PDA, false, true),
      // D-E19: the pool's own type, derived from what the POOL records.
      meta(FIXTURE_TYPE_PDA, false, true),
      meta(SystemProgram.programId, false, false),
    ]);
  });

  it('a pre-Ladder pool`s settlement names the 64-player type of its own mode and tier', async () => {
    // An 850-byte (unmigrated) pool reads as 64 seats, so the PDA is that
    // type's — the one `migrate_pool` will leave it pointing at too.
    const pre = Buffer.from(poolAccount({ state: 0, mode: 1 }).data.subarray(0, POOL_SPACE_V3));
    const { connection, sent } = fakeCluster({ [POOL_PDA.toBase58()]: pre });
    await chain(connection).triggerRefund(POOL_ID);
    expect(metas(onlyIx(sent))[5]).to.equal(meta(poolTypePda(1, FIXTURE.tier, 64), false, true));
  });

  it('commit_vrf_seed bundles the Switchboard reveal into the SAME transaction', async () => {
    // `vrf.rs` reads the revealed value only in its exact reveal slot, so a
    // reveal in a separate transaction is a reveal the program cannot use.
    const randomness = Keypair.fromSeed(new Uint8Array(32).fill(60)).publicKey;
    const revealProgram = Keypair.fromSeed(new Uint8Array(32).fill(201)).publicKey;
    const { connection, sent } = fakeCluster();
    const c = new Web3Chain({
      connection,
      programId: PROGRAM_ID,
      settlementSigner,
      makeVrfRevealIx: async (account) => {
        expect(account.toBase58()).to.equal(randomness.toBase58());
        return {
          programId: revealProgram,
          keys: [],
          data: Buffer.from([1, 2, 3]),
        } as never;
      },
    });
    await c.commitVrfSeed(POOL_ID, randomness.toBase58());

    const ixs = sent[0].transaction.instructions;
    const revealAt = ixs.findIndex((i) => i.programId.equals(revealProgram));
    const commitAt = ixs.findIndex(
      (i) => i.programId.equals(PROGRAM_ID) && i.data.subarray(0, 8).equals(discriminator('commit_vrf_seed'))
    );
    expect(revealAt, 'the reveal is in the transaction').to.not.equal(-1);
    expect(commitAt, 'the commit is in the transaction').to.not.equal(-1);
    expect(revealAt, 'the reveal must precede the commit').to.be.lessThan(commitAt);
    expect(metas(ixs[commitAt])).to.deep.equal([
      meta(POOL_PDA, false, true),
      meta(randomness, false, false),
      meta(settlementSigner.publicKey, true, false),
    ]);
  });

  it('every send carries a compute-unit limit, and a price only when one is configured', async () => {
    const plain = fakeCluster();
    await chain(plain.connection).sealAtDeadline(POOL_ID);
    const budgetIxs = plain.sent[0].transaction.instructions.filter(
      (i) => !i.programId.equals(PROGRAM_ID)
    );
    expect(budgetIxs.length, 'a limit and no price').to.equal(1);

    const priced = fakeCluster();
    const c = new Web3Chain({
      connection: priced.connection,
      programId: PROGRAM_ID,
      settlementSigner,
      priorityFeeMicroLamports: async () => 12_345n,
    });
    await c.sealAtDeadline(POOL_ID);
    const withPrice = priced.sent[0].transaction.instructions.filter(
      (i) => !i.programId.equals(PROGRAM_ID)
    );
    expect(withPrice.length, 'a limit and a price (audit C-34)').to.equal(2);
    // SetComputeUnitPrice: discriminant 3, then the u64 price.
    const price = withPrice.find((i) => i.data[0] === 3);
    expect(price, 'a price instruction').to.not.equal(undefined);
    expect(price!.data.readBigUInt64LE(1)).to.equal(12_345n);
  });
});

describe('the pure reads the daemon depends on', () => {
  it('poolAddress is the PDA every instruction in this file derives', () => {
    expect(chain(fakeCluster().connection).poolAddress(POOL_ID)).to.equal(POOL_PDA.toBase58());
  });

  it('chainNow reads the Clock sysvar the program reads', async () => {
    const clock = Buffer.alloc(40);
    clock.writeBigInt64LE(1_757_664_000n, 32);
    const { connection } = fakeCluster({ [SYSVAR_CLOCK_PUBKEY.toBase58()]: clock });
    expect(await chain(connection).chainNow()).to.equal(1_757_664_000n);
  });

  it('vaultCushion asks the cluster once and remembers the answer', async () => {
    let calls = 0;
    const { connection } = fakeCluster();
    const counting = {
      ...connection,
      async getMinimumBalanceForRentExemption(space: number) {
        calls++;
        expect(space, 'the rent floor is for a ZERO-data account').to.equal(0);
        return 890_880;
      },
    } as unknown as Connection;
    const c = chain(counting);
    expect(await c.vaultCushion()).to.equal(890_880n);
    expect(await c.vaultCushion()).to.equal(890_880n);
    expect(calls, 'a genesis-level setting is not re-asked every tick').to.equal(1);
  });

  it('hasPassCollection answers from the account`s existence', async () => {
    const collection = pda([Buffer.from('pass_collection'), POOL_PDA.toBuffer()]);
    const absent = fakeCluster({});
    expect(await chain(absent.connection).hasPassCollection(POOL_ID)).to.equal(false);
    const present = fakeCluster({ [collection.toBase58()]: Buffer.alloc(1) });
    expect(await chain(present.connection).hasPassCollection(POOL_ID)).to.equal(true);
  });

  it('getPlatformBalance reads the treasury PDA`s lamports', async () => {
    const { connection } = fakeCluster({ [PLATFORM_PDA.toBase58()]: Buffer.alloc(0) });
    expect(await chain(connection).getPlatformBalance()).to.equal(1_000_000n);
    expect(await chain(fakeCluster({}).connection).getPlatformBalance()).to.equal(0n);
  });
});

describe('the PoolType accounts (D-E19)', () => {
  it('the shared layout is the running sum of state.rs`s PoolType fields, and the size it pins', () => {
    const { offsets, space } = structOffsets('PoolType');
    expect(space).to.equal(pinned('PoolType::SPACE'));
    expect(POOL_TYPE_SPACE).to.equal(space);
    expect({
      mode: offsets.mode,
      tier: offsets.tier,
      capacity: offsets.capacity,
      minSeats: offsets.min_seats,
      paidPlaces: offsets.paid_places,
      prizeTable: offsets.prize_table,
      potLamports: offsets.pot_lamports,
      enabled: offsets.enabled,
      activePool: offsets.active_pool,
      nextOpenAt: offsets.next_open_at,
      bump: offsets.bump,
    }).to.deep.equal({ ...POOL_TYPE_OFFSETS });
  });

  it('the discriminator is Anchor`s account hash, as the contract states', () => {
    expect(POOL_TYPE_DISCRIMINATOR.toString('hex')).to.equal('23bee6af4b720965');
  });

  it('getPoolTypes filters on size and discriminator, drops impostors, decodes and orders', async () => {
    const { connection, programAccounts, filters } = fakeCluster();
    const k = (mode: number, cap: number) => poolTypePda(mode, 0, cap);
    programAccounts.push(
      { pubkey: k(1, 8), account: { data: poolTypeAccount({ mode: 1, tier: 0, capacity: 8, activePool: 12n, nextOpenAt: 77n }) } },
      { pubkey: k(0, 64), account: { data: poolTypeAccount({ mode: 0, tier: 0, capacity: 64, enabled: false }) } },
      // A 57-byte account that is not a PoolType: an RPC that ignored the
      // memcmp must not turn it into one.
      {
        pubkey: Keypair.fromSeed(new Uint8Array(32).fill(90)).publicKey,
        account: { data: poolTypeAccount({ mode: 0, tier: 0, capacity: 8, discriminator: Buffer.alloc(8, 1) }) },
      },
      { pubkey: k(0, 8), account: { data: poolTypeAccount({ mode: 0, tier: 0, capacity: 8 }) } }
    );
    const types = await chain(connection).getPoolTypes();
    expect(filters[0]).to.deep.equal([
      { dataSize: POOL_TYPE_SPACE },
      { memcmp: { offset: 0, bytes: base58Encode(POOL_TYPE_DISCRIMINATOR) } },
    ]);
    expect(types.map((t) => [t.mode, t.tier, t.capacity])).to.deep.equal([
      [0, 0, 8],
      [0, 0, 64],
      [1, 0, 8],
    ]);
    expect(types[0].address).to.equal(k(0, 8).toBase58());
    expect(types[1].enabled).to.equal(false);
    expect(types[2].activePool).to.equal(12n);
    expect(types[2].nextOpenAt).to.equal(77n);
    expect(types[0].prizeTable.slice(0, 2)).to.deep.equal([...ladderTable(8)]);
    expect(types[0].potLamports).to.equal(prizePoolFor(ladderTable(8), TIER_ENTRY_LAMPORTS[0]));
    expect(types[0].minSeats).to.equal(minFieldFor(8));
    expect(types[0]).to.not.have.property('bump');
  });

  it('poolTypeRemainingAccounts: the enabled set, ascending by raw bytes, the count Config proves', () => {
    const keys = [8, 16, 32, 64].map((cap) => poolTypePda(0, 0, cap).toBase58());
    const listed = [
      { address: keys[0], enabled: true },
      { address: keys[1], enabled: false },
      { address: keys[2], enabled: true },
      { address: keys[3], enabled: true },
    ];
    // withdraw_platform's shape: every enabled type, none excluded.
    const all = poolTypeRemainingAccounts(3, listed, null).map((k) => k.toBase58());
    expect(all.length).to.equal(3);
    expect(all).to.not.include(keys[1]);
    const bytes = all.map((a) => new PublicKey(a).toBytes());
    for (let i = 1; i < bytes.length; i++) {
      expect(compareAddressBytes(bytes[i - 1], bytes[i]), 'strictly ascending').to.be.lessThan(0);
    }
    // open_pool's: the one being opened is left out.
    expect(poolTypeRemainingAccounts(3, listed, keys[2]).map((k) => k.toBase58())).to.not.include(keys[2]);
    expect(() => poolTypeRemainingAccounts(4, listed, null)).to.throw(/PoolTypeListIncomplete/);
    expect(() => poolTypeRemainingAccounts(3, listed, keys[1])).to.throw(/PoolTypeDisabled/);
  });
});
