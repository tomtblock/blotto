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
import { ENTRY_LAYOUT, ENTRY_SPACE, POOL_SPACE, POOL_SPACE_V2, Web3Chain } from '../src/chain-web3';

const STATE_RS = join(__dirname, '../../../programs/blotto_cup/src/state.rs');
const CONSTANTS_RS = join(__dirname, '../../../programs/blotto_cup/src/constants.rs');
const rust = readFileSync(STATE_RS, 'utf8');

// ---------------------------------------------------------------------------
// The Pool layout, derived from the Rust rather than restated
// ---------------------------------------------------------------------------

/** `constants.rs::CAPACITY`, read from the source. */
function capacity(): number {
  const m = /pub const CAPACITY: u16 = (\d+);/.exec(readFileSync(CONSTANTS_RS, 'utf8'));
  expect(m, 'constants.rs no longer declares CAPACITY').to.not.equal(null);
  return Number(m![1]);
}

/** Borsh widths for the types `Pool` declares. Fixed width, no padding. */
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

/** Byte offset of every `Pool` field, the 8-byte discriminator included. */
function poolOffsets(): { offsets: Record<string, number>; space: number } {
  const W = widths();
  let offset = 8;
  const offsets: Record<string, number> = {};
  for (const f of fieldsOf('Pool')) {
    const width = W[f.type];
    expect(width, `no Borsh width for Pool.${f.name}: ${f.type}`).to.not.equal(undefined);
    offsets[f.name] = offset;
    offset += width;
  }
  return { offsets, space: offset };
}

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
  return { data: d, offsets };
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
    expect(message).to.match(/847 bytes; Pool::SPACE is 850/);
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
  it('open_pool: keeper-signed, and its arguments survive the encoding', async () => {
    const { connection, sent } = fakeCluster();
    const sealingPubkey = new Uint8Array(32).fill(0x7a);
    const secretHash = new Uint8Array(32).fill(0x7b);
    await chain(connection, { keeperSigner }).openPool(POOL_ID, 3, sealingPubkey, secretHash, 1);

    const ix = onlyIx(sent);
    expect(metas(ix)).to.deep.equal([
      meta(keeperSigner.publicKey, true, true),
      meta(CONFIG_PDA, false, true),
      meta(POOL_PDA, false, true),
      meta(VAULT_PDA, false, true),
      meta(PLATFORM_PDA, false, true),
      meta(SystemProgram.programId, false, false),
    ]);
    expect(sent[0].signers.map((s) => s.publicKey.toBase58()), 'the keeper pays the rent').to.deep.equal([
      keeperSigner.publicKey.toBase58(),
    ]);

    const data = ix.data;
    expect(data.subarray(0, 8).equals(discriminator('open_pool'))).to.equal(true);
    expect(data.readBigUInt64LE(8), 'pool_id').to.equal(POOL_ID);
    expect(data[16], 'tier').to.equal(3);
    expect(data.subarray(17, 49).equals(Buffer.from(sealingPubkey))).to.equal(true);
    expect(data.subarray(49, 81).equals(Buffer.from(secretHash))).to.equal(true);
    // Phase B: `mode` is the appended argument — the last byte.
    expect(data[81], 'mode').to.equal(1);
    expect(data.length, 'no trailing bytes').to.equal(82);
  });

  it('open_pool defaults the keeper to the settlement signer when no keeper key is held', async () => {
    const { connection, sent } = fakeCluster();
    await chain(connection).openPool(POOL_ID, 0, new Uint8Array(32), new Uint8Array(32), 0);
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
    const { connection, sent } = fakeCluster();
    await chain(connection).refund(POOL_ID, player.toBase58());
    const ix = onlyIx(sent);
    expect(metas(ix)).to.deep.equal([
      meta(settlementSigner.publicKey, true, false),
      meta(CONFIG_PDA, false, true),
      meta(POOL_PDA, false, true),
      meta(PLATFORM_PDA, false, true),
      meta(entryPda(player), false, true),
      meta(player, false, true),
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

    const refundTrigger = fakeCluster();
    await chain(refundTrigger.connection).triggerRefund(POOL_ID);
    expect(metas(onlyIx(refundTrigger.sent))).to.deep.equal([
      meta(settlementSigner.publicKey, true, false),
      meta(CONFIG_PDA, false, true),
      meta(POOL_PDA, false, true),
      meta(VAULT_PDA, false, true),
      meta(PLATFORM_PDA, false, true),
      meta(SystemProgram.programId, false, false),
    ]);
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
