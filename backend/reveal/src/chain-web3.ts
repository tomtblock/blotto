/**
 * `Web3Chain` — the production `SettlementChain` over `@solana/web3.js`.
 *
 * Instruction bytes are hand-encoded against the program's wire contract
 * (Anchor global discriminators + Borsh args + the exact account orders in
 * `programs/blotto_cup/src/instructions/`), the same encoding the LiteSVM
 * suite drives the artifact with — those tests are what pin this file's
 * correctness. Account layouts are read by the byte offsets asserted in
 * `state.rs` size tests.
 *
 * Exercised for real on devnet in the Phase 5 rehearsal (the offline crank
 * suite runs on `FakeChain`).
 */

import { createHash } from 'crypto';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import type {
  ChainConfigView,
  ChainEntryView,
  ChainPoolTypeView,
  ChainPoolView,
  ChainProofStep,
  CommittedPayout,
  KeeperChain,
} from './chain';
// The `Config` layout is shared source, not a copy: the indexer's treasury
// report has to read the same account, and a second set of byte offsets for
// it is how the rent cushion came to be missing from two mirrors of one sum
// (2026-09-12). `_shared` has no web3.js dependency, so it decodes bytes and
// this file keeps the RPC.
import {
  N_TIERS,
  decodeConfigAccount,
} from '../../_shared/src/config-account';
import { decodePoolHead } from '../../_shared/src/pool-account';
// The PoolType account (D-E19): layout, seeds and the address order the
// program requires of its remaining accounts — shared, like Config's.
import {
  POOL_TYPE_SPACE,
  compareAddressBytes,
  decodePoolTypeAccount,
  poolTypeSeeds,
} from '../../_shared/src/pool-type-account';
import { base58Encode } from '../../_shared/src/blotto-events';


/** Metaplex Core, pinned by address in the program (`pass.rs::MPL_CORE_ID`). */
const MPL_CORE_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');

/**
 * `Entry::SPACE` — the byte length of an Entry account, used as the
 * `getProgramAccounts` size filter.
 *
 * IT MUST EQUAL THE PROGRAM'S. It did not: this read 208 while the program
 * had been 227 since the split fields landed on 2026-09-07, so the filter
 * matched nothing and `getEntries` returned an empty array against any real
 * cluster — the crank would have seen a pool with no entrants on the first
 * live settlement. Nothing caught it because every test drives `FakeChain`
 * and devnet has not settled a pool yet. `test/entry-layout.spec.ts` now
 * pins it to `state.rs`, which is the durable half of this fix.
 */
export const ENTRY_SPACE = 228;

/**
 * `Pool::SPACE` and the pre-Phase-B `Pool::SPACE_V2`, re-exported from the
 * shared layout (`backend/_shared/src/pool-account.ts`, R23) so the daemon and
 * the watcher read the same bytes. Used as a LENGTH GUARD (audit 2026-09-11,
 * G-06): an account that is not a Pool must be refused by name, up front,
 * not decoded into plausible numbers.
 */
export { POOL_SPACE, POOL_SPACE_V2, POOL_SPACE_V3 } from '../../_shared/src/pool-account';

/** `PoolType::SPACE` (57), re-exported for the `getProgramAccounts` size
 * filter and the layout test. */
export { POOL_TYPE_SPACE } from '../../_shared/src/pool-type-account';

/**
 * Anchor's account discriminator for `PoolType`: `sha256("account:PoolType")`
 * truncated to 8 bytes (23bee6af4b720965). The size filter alone would admit
 * any 57-byte account the program owns; this is what makes a match a
 * PoolType, and it is checked on every account returned whether or not the
 * RPC honoured the memcmp filter.
 */
export const POOL_TYPE_DISCRIMINATOR: Buffer = createHash('sha256')
  .update('account:PoolType')
  .digest()
  .subarray(0, 8);

/**
 * `open_pool`'s remaining accounts (open_pool.rs, treasury.rs
 * `idle_pool_type_reserve`): every OTHER enabled pool type, strictly
 * ascending by the 32 raw address bytes, as many as
 * `Config.enabled_pool_types - 1`. The program refuses a list that is short,
 * long, unsorted or that includes the type being opened
 * (`PoolTypeListIncomplete`), so this refuses the same lists BEFORE a
 * transaction is spent on them — a lagging `getProgramAccounts` that missed a
 * newly enabled type is the realistic cause, and waiting a tick fixes it.
 *
 * `opening` is the address of the type being opened, or null for
 * `withdraw_platform`'s list (every enabled type, none excluded). Pure.
 */
export function poolTypeRemainingAccounts(
  enabledPoolTypes: number,
  poolTypes: readonly Pick<ChainPoolTypeView, 'address' | 'enabled'>[],
  opening: string | null
): PublicKey[] {
  const enabled = poolTypes.filter((t) => t.enabled);
  if (enabled.length !== enabledPoolTypes) {
    throw new Error(
      `read ${enabled.length} enabled pool type(s) but Config.enabled_pool_types is ` +
        `${enabledPoolTypes} — the program would refuse the list (PoolTypeListIncomplete); ` +
        `not sending`
    );
  }
  if (opening !== null && !enabled.some((t) => t.address === opening)) {
    throw new Error(`pool type ${opening} is not enabled — open_pool would refuse it (PoolTypeDisabled)`);
  }
  return enabled
    .filter((t) => t.address !== opening)
    .map((t) => new PublicKey(t.address))
    .sort((a, b) => compareAddressBytes(a.toBytes(), b.toBytes()));
}

/**
 * Where `getEntries` reads each Entry field: BYTE OFFSETS from the start of
 * the account (the 8-byte discriminator included), keyed by the field's
 * name in `state.rs`. Borsh lays the struct out in declaration order with
 * no padding, so every offset is the running sum of the sizes before it —
 * which is exactly what `test/entry-layout.spec.ts` recomputes from the
 * Rust source and compares against this table. A wrong offset here does
 * not throw: it reads a neighbouring field as if it were the one asked for
 * (the same silent failure mode as the size filter above), and the split
 * frame in particular decides which `pay_next_place` arguments the driver
 * sends. Add a field here when the program appends one; never renumber.
 *
 * disc 8 | pool 32 | player 32 | index 2 | battles_hash 32 | class 1 |
 * pass_asset 32 | entered_at 8 | slot_hash 32 | flagged 1 | settled 1 |
 * refunded 1 | escrow_lamports 8 | bump 1 | — the 2026-09-07 tail:
 * escrowed_at 8 | forfeited 1 | next_place_lamports 8 | split_total 8 |
 * split_paid_mask 8 | split_group_size 2 | split_remainder_paid 1 | —
 * Stage F: sanctions_hold 1 — 228 in all (`Entry::SPACE`).
 */
export const ENTRY_LAYOUT = {
  player: 40,
  index: 72,
  battles_hash: 74,
  flagged: 179,
  settled: 180,
  refunded: 181,
  escrow_lamports: 182,
  escrowed_at: 191,
  forfeited: 199,
  next_place_lamports: 200,
  split_total: 208,
  split_paid_mask: 216,
  split_group_size: 224,
  split_remainder_paid: 226,
  sanctions_hold: 227,
} as const;

/**
 * The Clock sysvar's `unix_timestamp`, decoded from the account's data.
 * The runtime serialises `Clock` with bincode, fixed-width little-endian,
 * in field order: slot u64 @0 | epoch_start_timestamp i64 @8 | epoch u64
 * @16 | leader_schedule_epoch u64 @24 | unix_timestamp i64 @32 — 40 bytes.
 * Kept apart from the RPC read so the offset is pinned by an offline test
 * (`test/entry-layout.spec.ts`) rather than trusted.
 */
export function clockUnixTimestamp(data: Buffer): bigint {
  if (data.length < 40) {
    throw new Error(`Clock sysvar data is ${data.length} bytes; the layout is 40`);
  }
  return data.readBigInt64LE(32);
}

const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');

function disc(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

export interface Web3ChainConfig {
  connection: Connection;
  programId: PublicKey;
  /** Signs reveal / commit / pay — the settlement signer (Turnkey-backed in prod). */
  settlementSigner: Keypair;
  /** Signs `open_pool` — `Config.keeper` (prompt v2 §A). Defaults to the
   * settlement signer: devnet's `migrate_config` names that key as keeper,
   * so splitting the two later (E6) is an env change (`KEEPER_KEYPAIR`). */
  keeperSigner?: Keypair;
  /** Signs the ADMIN instructions this client can build — `init_config`,
   * `migrate_config`, `forfeit_escrow` (admin-signed since 2026-09-07).
   * Absent in the long-running daemon and the review server — the admin is
   * the Squads vault; those are CLI / proposal steps, not service steps. */
  adminSigner?: Keypair;
  /**
   * Switchboard On-Demand seam: given the Randomness account, return the
   * SDK-built `reveal` instruction to bundle IN THE SAME transaction as
   * `commit_vrf_seed` (the program reads the revealed value only in its
   * exact reveal slot — vrf.rs). Absent = the reveal already landed this
   * slot by other means (the e2e bench's injected fixtures do exactly that).
   * The production adapter is C11 vendor work.
   */
  makeVrfRevealIx?: (randomnessAccount: PublicKey) => Promise<TransactionInstruction | null>;
  /**
   * The priority fee to bid on every send, in micro-lamports per compute
   * unit (audit 2026-09-11, C-34). Until 2026-09-12 no settlement
   * transaction carried one while the browser's entries did, so under
   * congestion the payout was the transaction that did not land. The daemon
   * supplies the shared percentile choice through a cached sampler
   * (priority-fee.ts); absent = no price instruction, as before.
   */
  priorityFeeMicroLamports?: () => Promise<bigint>;
}

export class Web3Chain implements KeeperChain {
  constructor(private readonly cfg: Web3ChainConfig) {}

  private pda(seeds: (Buffer | Uint8Array)[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds as Buffer[], this.cfg.programId)[0];
  }
  private poolPda(id: bigint): PublicKey {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(id);
    return this.pda([Buffer.from('pool'), le]);
  }
  private vaultPda(id: bigint): PublicKey {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(id);
    return this.pda([Buffer.from('vault'), le]);
  }
  private configPda(): PublicKey {
    return this.pda([Buffer.from('config')]);
  }
  private platformPda(): PublicKey {
    return this.pda([Buffer.from('platform')]);
  }
  private entryPda(pool: PublicKey, player: PublicKey): PublicKey {
    return this.pda([Buffer.from('entry'), pool.toBuffer(), player.toBuffer()]);
  }
  /** `[b"ptype", [mode], [tier], capacity u16 LE]` (D-E19) — the shared
   * seeds, which refuse a coordinate the program would refuse by name. */
  private poolTypePda(mode: number, tier: number, capacity: number): PublicKey {
    return this.pda(poolTypeSeeds(mode, tier, capacity));
  }
  /** The pool type a pool's settlement instructions name: derived from the
   * POOL's own recorded mode, tier and capacity (a pre-Ladder account reads
   * as 64 seats — `decodePoolHead`), exactly as the program's seeds are. */
  private poolTypeOf(pool: Pick<ChainPoolView, 'mode' | 'tier' | 'capacity'>): PublicKey {
    return this.poolTypePda(pool.mode, pool.tier, pool.capacity);
  }

  private async send(
    ixs: TransactionInstruction[],
    signers: Keypair[] = [this.cfg.settlementSigner]
  ): Promise<void> {
    const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })];
    if (this.cfg.priorityFeeMicroLamports) {
      const microLamports = await this.cfg.priorityFeeMicroLamports();
      budget.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
    }
    const tx = new Transaction().add(...budget, ...ixs);
    await sendAndConfirmTransaction(this.cfg.connection, tx, signers, {
      commitment: 'confirmed',
    });
  }

  private keeper(): Keypair {
    return this.cfg.keeperSigner ?? this.cfg.settlementSigner;
  }

  private admin(what: string): Keypair {
    const admin = this.cfg.adminSigner;
    if (!admin) {
      throw new Error(
        `${what} is admin-signed: this client holds no admin key ` +
          `(use scripts/admin.ts — --emit-proposal for the Squads vault)`
      );
    }
    return admin;
  }

  async getPool(poolId: bigint): Promise<ChainPoolView> {
    const info = await this.cfg.connection.getAccountInfo(this.poolPda(poolId), 'confirmed');
    if (!info) throw new Error(`pool ${poolId} account not found`);
    const d = info.data;
    // The head — and the length guard that refuses an account of the wrong
    // type before any fixed-offset read (audit 2026-09-11, G-06) — is the
    // shared layout's (`_shared/src/pool-account.ts`, R23), so the daemon and
    // the watcher cannot drift apart on the same bytes.
    const head = decodePoolHead(d, `pool ${poolId}`);
    // The tail, read only here. Offsets mirror state.rs since D-A1 v2
    // (asserted by its serialize-LEN tests and the LiteSVM readers): … |
    // state 1 (51) | sealing 32 | hash 32 | vrf 32 | counters 10 |
    // secret_revealed 1 | root 32 | committed 1 | payouts_len 2 |
    // payouts 64×(seat 2 + amount 8) | paid_mask 8 (834) | ... — every one
    // of them before 842, so neither Phase B's `mode` nor the Ladder's tail
    // (capacity, paid_places, prize_table — read by `decodePoolHead`) moved
    // them; `test/chain-web3.spec.ts` derives them from `state.rs`.
    const committed = d[191] !== 0;
    const payouts: CommittedPayout[] = [];
    if (committed) {
      const len = d.readUInt16LE(192);
      for (let i = 0; i < len; i++) {
        const off = 194 + i * 10;
        payouts.push({
          entryIndex: d.readUInt16LE(off),
          amountLamports: d.readBigUInt64LE(off + 2),
        });
      }
    }
    return {
      poolId,
      tier: head.tier,
      state: head.state,
      entryLamports: head.entryLamports,
      potLamports: head.potLamports,
      fillDeadline: head.fillDeadline,
      // vrf_seed occupies bytes 116..148; all-zero is the uncommitted sentinel.
      vrfCommitted: d.subarray(116, 148).some((b) => b !== 0),
      secretRevealed: d[158] !== 0,
      resultsCommitted: committed,
      // root occupies bytes 159..191, between secret_revealed and committed.
      resultsRootHex: committed ? d.subarray(159, 191).toString('hex') : null,
      paidMask: d.readBigUInt64LE(834),
      payouts,
      entrants: head.entrants,
      mode: head.mode,
      // D-E19, from the shared head (reconstructed for a pre-Ladder account).
      capacity: head.capacity,
      minSeats: head.minSeats,
      paidPlaces: head.paidPlaces,
      prizeTable: head.prizeTable,
    };
  }

  /**
   * `Config`, decoded by the SHARED layout module — the byte offsets and the
   * two size guards live in `_shared/src/config-account.ts` so the indexer's
   * treasury report reads the same account through the same code. This
   * method is now the RPC half only: fetch, decode, widen to the daemon's
   * view. `ChainConfigView` stays the crank's own type (`FakeChain`
   * implements it without ever touching a byte).
   */
  async getConfig(): Promise<ChainConfigView> {
    const info = await this.cfg.connection.getAccountInfo(this.configPda(), 'confirmed');
    if (!info) throw new Error('config account not found');
    return decodeConfigAccount(info.data);
  }

  /**
   * Every `PoolType` account (D-E19): `getProgramAccounts` filtered on the
   * account's size (57) and its discriminator, each decoded by the shared
   * layout (`_shared/src/pool-type-account.ts`). The discriminator is checked
   * again on what comes back — an RPC that ignored the memcmp must not turn
   * another 57-byte account into a pool type. Ordered by (mode, tier,
   * capacity) for a stable log; `open_pool` sorts its own list by address.
   */
  async getPoolTypes(): Promise<ChainPoolTypeView[]> {
    const accounts = await this.cfg.connection.getProgramAccounts(this.cfg.programId, {
      commitment: 'confirmed',
      filters: [
        { dataSize: POOL_TYPE_SPACE },
        { memcmp: { offset: 0, bytes: base58Encode(POOL_TYPE_DISCRIMINATOR) } },
      ],
    });
    return accounts
      .filter(({ account }) => Buffer.from(account.data.subarray(0, 8)).equals(POOL_TYPE_DISCRIMINATOR))
      .map(({ pubkey, account }) => {
        const address = pubkey.toBase58();
        const { bump: _bump, ...view } = decodePoolTypeAccount(account.data, `pool type ${address}`);
        return { address, ...view };
      })
      .sort((a, b) => a.mode - b.mode || a.tier - b.tier || a.capacity - b.capacity);
  }

  async getPlatformBalance(): Promise<bigint> {
    const info = await this.cfg.connection.getAccountInfo(this.platformPda(), 'confirmed');
    return BigInt(info?.lamports ?? 0);
  }

  /**
   * `vault::rent_floor()` from the cluster, not from a constant: the
   * rent-exempt minimum for a zero-data account. Cached for the process —
   * a cluster's rent parameters are a genesis-level setting, and a keeper
   * that re-asked every tick would spend a round trip on an answer that
   * never moves.
   */
  private cushion: bigint | null = null;

  async vaultCushion(): Promise<bigint> {
    if (this.cushion === null) {
      this.cushion = BigInt(await this.cfg.connection.getMinimumBalanceForRentExemption(0));
    }
    return this.cushion;
  }

  /** `KeeperChain.poolAddress`: the pool PDA this client derives for every
   * instruction, as base58. Pure — no RPC. */
  poolAddress(poolId: bigint): string {
    return this.poolPda(poolId).toBase58();
  }

  /** `KeeperChain.chainNow`: the Clock sysvar's `unix_timestamp` at
   * `confirmed` — `SysvarC1ock11111111111111111111111111111111`, the
   * account the program reads through `Clock::get()`. Decoded by
   * `clockUnixTimestamp` (offset 32; layout there). */
  async chainNow(): Promise<bigint> {
    const info = await this.cfg.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed');
    if (!info) throw new Error('Clock sysvar account not found');
    return clockUnixTimestamp(info.data);
  }

  /**
   * `open_pool` (D-E19): opens one pool TYPE. The instruction carries the
   * type's own account (writable — its slot is set) and, as remaining
   * accounts, every OTHER enabled pool type in ascending address order, so
   * the program can compute the treasury reserve over all of them
   * (`poolTypeRemainingAccounts`). Both are read fresh here: the list is
   * what the program checks against `Config.enabled_pool_types`, and a stale
   * one is refused whole.
   *
   * PHASE-D-E19-REVIEW: a legacy transaction carries the remaining list as
   * plain keys. With the fixed accounts, the program, the compute-budget
   * program and the 84-byte data, roughly twenty enabled pool types fit in
   * the 1,232-byte limit; past that `open_pool` needs a v0 transaction with
   * an address lookup table. The launch enables eight.
   */
  async openPool(
    poolId: bigint,
    tier: number,
    sealingPubkey: Uint8Array,
    sealingSecretHash: Uint8Array,
    mode: number,
    capacity: number
  ): Promise<void> {
    if (mode !== 0 && mode !== 1) throw new Error(`unknown board mode ${mode}`);
    // Refuses a capacity that is not 8, 16, 32 or 64 before any read.
    const poolType = this.poolTypePda(mode, tier, capacity);
    const [config, types] = await Promise.all([this.getConfig(), this.getPoolTypes()]);
    const others = poolTypeRemainingAccounts(config.enabledPoolTypes, types, poolType.toBase58());
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    const cap = Buffer.alloc(2);
    cap.writeUInt16LE(capacity);
    const keeper = this.keeper();
    await this.send(
      [
        new TransactionInstruction({
          programId: this.cfg.programId,
          keys: [
            // Keeper-signed since 2026-09-07 (prompt v2 §A): `Config.keeper`
            // pays the Pool's rent, and no other signer may open a pool.
            { pubkey: keeper.publicKey, isSigner: true, isWritable: true },
            { pubkey: this.configPda(), isSigner: false, isWritable: true },
            { pubkey: this.poolPda(poolId), isSigner: false, isWritable: true },
            { pubkey: this.vaultPda(poolId), isSigner: false, isWritable: true },
            { pubkey: this.platformPda(), isSigner: false, isWritable: true },
            // D-E19: the type being opened — its slot, cooldown, table,
            // floor and prize pool.
            { pubkey: poolType, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            // Remaining: every OTHER enabled pool type, ascending, read-only.
            ...others.map((other) => ({ pubkey: other, isSigner: false, isWritable: false })),
          ],
          data: Buffer.concat([
            disc('open_pool'),
            le,
            Buffer.from([tier]),
            Buffer.from(sealingPubkey),
            Buffer.from(sealingSecretHash),
            // Phase B: the appended `mode` argument (0 easy, 1 hard).
            Buffer.from([mode]),
            // D-E19: the appended `capacity` argument, u16 LE.
            cap,
          ]),
        }),
      ],
      [keeper]
    );
  }

  async commitVrfSeed(poolId: bigint, randomnessAccount: string): Promise<void> {
    const randomness = new PublicKey(randomnessAccount);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    const commitIx = new TransactionInstruction({
      programId: this.cfg.programId,
      keys: [
        { pubkey: this.poolPda(poolId), isSigner: false, isWritable: true },
        { pubkey: randomness, isSigner: false, isWritable: false },
        { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([disc('commit_vrf_seed'), le]),
    });
    // The Switchboard reveal must land in the SAME transaction (vrf.rs:
    // the value is readable only in its exact reveal slot).
    const revealIx = (await this.cfg.makeVrfRevealIx?.(randomness)) ?? null;
    await this.send(revealIx ? [revealIx, commitIx] : [commitIx]);
  }

  private passCollectionPda(poolId: bigint): PublicKey {
    return this.pda([Buffer.from('pass_collection'), this.poolPda(poolId).toBuffer()]);
  }

  async createPassCollection(poolId: bigint): Promise<void> {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: true },
          { pubkey: this.poolPda(poolId), isSigner: false, isWritable: false },
          { pubkey: this.passCollectionPda(poolId), isSigner: false, isWritable: true },
          { pubkey: MPL_CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('create_pass_collection'), le]),
      }),
    ]);
  }

  async hasPassCollection(poolId: bigint): Promise<boolean> {
    const info = await this.cfg.connection.getAccountInfo(
      this.passCollectionPda(poolId),
      'confirmed'
    );
    return info !== null;
  }

  async initConfig(args: {
    entrySigner: string;
    settlementSigner: string;
    keeper: string;
    vaultCeilingLamports: bigint[];
    treasuryMinPlatformLamports: bigint;
  }): Promise<void> {
    const admin = this.admin('init_config');
    if (args.vaultCeilingLamports.length !== N_TIERS) {
      throw new Error(`vault ceilings must list exactly ${N_TIERS} tiers`);
    }
    const ceilings = Buffer.alloc(8 * N_TIERS);
    args.vaultCeilingLamports.forEach((v, i) => ceilings.writeBigUInt64LE(v, 8 * i));
    const minBuf = Buffer.alloc(8);
    minBuf.writeBigUInt64LE(args.treasuryMinPlatformLamports);
    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
          { pubkey: this.configPda(), isSigner: false, isWritable: true },
          { pubkey: this.platformPda(), isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([
          disc('init_config'),
          new PublicKey(args.entrySigner).toBuffer(),
          new PublicKey(args.settlementSigner).toBuffer(),
          new PublicKey(args.keeper).toBuffer(),
          ceilings,
          minBuf,
        ]),
      })
    );
    await sendAndConfirmTransaction(this.cfg.connection, tx, [admin], {
      commitment: 'confirmed',
    });
  }

  /** `migrate_config(keeper)` — the one-shot 2026-09-07 layout migration,
   * admin-signed (a CLI step, runbook 3b; never a service step). */
  async migrateConfig(keeper: string): Promise<void> {
    const admin = this.admin('migrate_config');
    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
          { pubkey: this.configPda(), isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('migrate_config'), new PublicKey(keeper).toBuffer()]),
      })
    );
    await sendAndConfirmTransaction(this.cfg.connection, tx, [admin], {
      commitment: 'confirmed',
    });
  }

  /** `fund_platform_wallet` — permissionless deposit (rehearsal bootstrap). */
  async fundPlatformWallet(amountLamports: bigint): Promise<void> {
    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(amountLamports);
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: true },
          { pubkey: this.configPda(), isSigner: false, isWritable: false },
          { pubkey: this.platformPda(), isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('fund_platform_wallet'), amount]),
      }),
    ]);
  }

  async getEntries(poolId: bigint): Promise<ChainEntryView[]> {
    const pool = this.poolPda(poolId);
    // Entry layout: disc 8 | pool 32 | player 32 | index 2 | battles_hash 32
    // | class 1 | pass_asset 32 | entered_at 8 | slot_hash 32 | flagged 1
    // (179) | settled 1 (180) | refunded 1 (181) | escrow 8 (182) | bump 1
    // (190) | — the 2026-09-07 tail: escrowed_at 8 (191) | forfeited 1 (199)
    // | next_place_lamports 8 (200) | split_total 8 (208) | split_paid_mask
    // 8 (216) | split_group_size 2 (224) | split_remainder_paid 1 (226)
    // | — Stage F: sanctions_hold 1 (227) — 228 in all (`Entry::SPACE`).
    const accounts = await this.cfg.connection.getProgramAccounts(this.cfg.programId, {
      commitment: 'confirmed',
      filters: [{ dataSize: ENTRY_SPACE }, { memcmp: { offset: 8, bytes: pool.toBase58() } }],
    });
    const L = ENTRY_LAYOUT;
    return accounts
      .map(({ account }) => {
        const d = account.data;
        return {
          player: new PublicKey(d.subarray(L.player, L.player + 32)).toBase58(),
          index: d.readUInt16LE(L.index),
          battlesHash: d.subarray(L.battles_hash, L.battles_hash + 32).toString('hex'),
          flagged: d[L.flagged] !== 0,
          refunded: d[L.refunded] !== 0,
          settled: d[L.settled] !== 0,
          forfeited: d[L.forfeited] !== 0,
          escrowLamports: d.readBigUInt64LE(L.escrow_lamports),
          escrowedAt: d.readBigInt64LE(L.escrowed_at),
          sanctionsHold: d[L.sanctions_hold] !== 0,
          nextPlaceLamports: d.readBigUInt64LE(L.next_place_lamports),
          // The split frame (`Entry.split_*`): what the next-place driver
          // resumes a part-paid split from. All zero until the first portion.
          splitTotal: d.readBigUInt64LE(L.split_total),
          splitPaidMask: d.readBigUInt64LE(L.split_paid_mask),
          splitGroupSize: d.readUInt16LE(L.split_group_size),
          splitRemainderPaid: d[L.split_remainder_paid] !== 0,
        };
      })
      .sort((a, b) => a.index - b.index);
  }

  async revealPoolSecret(poolId: bigint, secret: Uint8Array): Promise<void> {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: false },
          { pubkey: this.poolPda(poolId), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([disc('reveal_pool_secret'), le, Buffer.from(secret)]),
      }),
    ]);
  }

  async commitResults(poolId: bigint, root: Uint8Array, payouts: CommittedPayout[]): Promise<void> {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    // Borsh Vec<Payout { entry_index: u16, amount: u64 }>.
    const list = Buffer.alloc(4 + payouts.length * 10);
    list.writeUInt32LE(payouts.length);
    payouts.forEach((p, i) => {
      list.writeUInt16LE(p.entryIndex, 4 + i * 10);
      list.writeBigUInt64LE(p.amountLamports, 4 + i * 10 + 2);
    });
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: false },
          { pubkey: this.poolPda(poolId), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([disc('commit_results'), le, Buffer.from(root), list]),
      }),
    ]);
  }

  async payPrizes(poolId: bigint, seats: number[]): Promise<void> {
    const pool = await this.getPool(poolId);
    if (!pool.resultsCommitted) throw new Error('results not committed');
    // D-E19: the pool's own type, whose slot the final batch frees.
    const poolType = this.poolTypeOf(pool);
    // The Entry accounts are the on-chain seat→player map; resolve each
    // seat's wallet from them (the program re-checks the binding).
    const entries = await this.getEntries(poolId);
    const walletBySeat = new Map(entries.map((e) => [e.index, e.player]));
    const poolKey = this.poolPda(poolId);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    // Borsh Vec<u16>.
    const list = Buffer.alloc(4 + seats.length * 2);
    list.writeUInt32LE(seats.length);
    seats.forEach((s, i) => list.writeUInt16LE(s, 4 + i * 2));
    const data = Buffer.concat([disc('pay_prizes'), le, list]);
    const keys = [
      { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
      // WRITABLE: `PayPrizes` declares Config `mut` and the final batch
      // writes it (the pot leaves `platform_reserved`; since D-E19 the slot
      // that frees is the pool type's, below). Anchor checks that constraint
      // while assembling accounts,
      // before the handler runs, so a read-only Config reverted EVERY batch,
      // not just the last — no pool could be paid at all. Pinned across the
      // language boundary by test/account-metas.spec.ts (audit A-01).
      { pubkey: this.configPda(), isSigner: false, isWritable: true },
      { pubkey: poolKey, isSigner: false, isWritable: true },
      { pubkey: this.vaultPda(poolId), isSigner: false, isWritable: true },
      { pubkey: poolType, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];
    for (const seat of seats) {
      const player = walletBySeat.get(seat);
      if (!player) throw new Error(`no entry for seat ${seat} in pool ${poolId}`);
      const wallet = new PublicKey(player);
      keys.push({ pubkey: wallet, isSigner: false, isWritable: true });
      keys.push({ pubkey: this.entryPda(poolKey, wallet), isSigner: false, isWritable: true });
    }
    await this.send([
      new TransactionInstruction({ programId: this.cfg.programId, keys, data }),
    ]);
  }

  async flagEntry(poolId: bigint, player: string): Promise<void> {
    await this.sendFlagIx('flag_entry', poolId, player);
  }

  async clearFlag(poolId: bigint, player: string): Promise<void> {
    await this.sendFlagIx('clear_flag', poolId, player);
  }

  /** flag_entry and clear_flag share the FlagEntry accounts struct. */
  private async sendFlagIx(name: string, poolId: bigint, player: string): Promise<void> {
    const poolKey = this.poolPda(poolId);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: false },
          { pubkey: poolKey, isSigner: false, isWritable: false },
          { pubkey: this.entryPda(poolKey, new PublicKey(player)), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([disc(name), le]),
      }),
    ]);
  }

  async releaseEscrow(poolId: bigint, player: string): Promise<void> {
    const poolKey = this.poolPda(poolId);
    const playerKey = new PublicKey(player);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    // The settlement signer takes the REVIEWED path (escrow.rs). With the
    // KYC-at-claim switch ON and the share above the threshold, the program
    // additionally requires a kyc_tier ≥ 1 packet as an Ed25519 instruction
    // in this transaction (R3). The switch is OFF at launch (D-B4, D-E5);
    // the KYC-path variant lands with the switch's activation. (Any other
    // signer would take the seven-day auto-release path with the same
    // accounts — the program decides by comparing the signer.)
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: false },
          { pubkey: poolKey, isSigner: false, isWritable: false },
          { pubkey: this.vaultPda(poolId), isSigner: false, isWritable: true },
          { pubkey: this.entryPda(poolKey, playerKey), isSigner: false, isWritable: true },
          { pubkey: playerKey, isSigner: false, isWritable: true },
          { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('release_escrow'), le]),
      }),
    ]);
  }

  /** `place_sanctions_hold` — settlement-signed (Phase 2 Stage F). Shares
   * the `FlagEntry` account shape; nothing moves. */
  async placeSanctionsHold(poolId: bigint, player: string): Promise<void> {
    await this.sendFlagIx('place_sanctions_hold', poolId, player);
  }

  /** `lift_sanctions_hold` — ADMIN-signed, so this client throws unless it
   * holds the admin key (the same posture as `forfeitEscrow`). */
  async liftSanctionsHold(poolId: bigint, player: string): Promise<void> {
    const admin = this.admin('lift_sanctions_hold');
    const poolKey = this.poolPda(poolId);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: false },
          { pubkey: poolKey, isSigner: false, isWritable: false },
          {
            pubkey: this.entryPda(poolKey, new PublicKey(player)),
            isSigner: false,
            isWritable: true,
          },
        ],
        data: Buffer.concat([disc('lift_sanctions_hold'), le]),
      }),
      // The admin signs (B-47, audit 2026-09-11): this used to go out with
      // the settlement signer alone, so the instruction it built could never
      // be sent — the admin key was named as a signer and never signed.
    ], [admin]);
  }

  async forfeitEscrow(poolId: bigint, player: string): Promise<void> {
    // Admin-signed since 2026-09-07 (founder ruling 4 / prompt v2 §E.2):
    // taking a prize away is a multi-party act. Nothing moves — the vault is
    // listed read-only, the treasury not at all (standing-rules check (h)).
    const admin = this.admin('forfeit_escrow');
    const poolKey = this.poolPda(poolId);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    await this.send(
      [
        new TransactionInstruction({
          programId: this.cfg.programId,
          keys: [
            { pubkey: admin.publicKey, isSigner: true, isWritable: false },
            { pubkey: this.configPda(), isSigner: false, isWritable: false },
            { pubkey: poolKey, isSigner: false, isWritable: false },
            { pubkey: this.vaultPda(poolId), isSigner: false, isWritable: false },
            { pubkey: this.entryPda(poolKey, new PublicKey(player)), isSigner: false, isWritable: true },
          ],
          data: Buffer.concat([disc('forfeit_escrow'), le]),
        }),
      ],
      [admin]
    );
  }

  async payNextPlace(
    poolId: bigint,
    from: string,
    to: string,
    rank: number,
    amount: bigint,
    proof: readonly ChainProofStep[],
    groupSize: number,
    takesRemainder: boolean,
    peers: readonly string[]
  ): Promise<void> {
    const poolKey = this.poolPda(poolId);
    const toKey = new PublicKey(to);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    // Borsh: rank u8 | amount u64 | Vec<ProofStep { sibling [u8;32],
    // sibling_on_right bool }> (u32 length prefix) | group_size u16 |
    // takes_remainder bool.
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(amount);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(proof.length);
    const steps = proof.map((s) =>
      Buffer.concat([Buffer.from(s.sibling), Buffer.from([s.siblingOnRight ? 1 : 0])])
    );
    const groupBuf = Buffer.alloc(2);
    groupBuf.writeUInt16LE(groupSize);
    const tail = Buffer.concat([groupBuf, Buffer.from([takesRemainder ? 1 : 0])]);
    const keys = [
      { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
      { pubkey: this.configPda(), isSigner: false, isWritable: false },
      { pubkey: poolKey, isSigner: false, isWritable: false },
      { pubkey: this.vaultPda(poolId), isSigner: false, isWritable: true },
      { pubkey: this.entryPda(poolKey, new PublicKey(from)), isSigner: false, isWritable: true },
      { pubkey: this.entryPda(poolKey, toKey), isSigner: false, isWritable: true },
      { pubkey: toKey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // remaining accounts: every OTHER committed (first-place) Entry, in
      // ascending seat order (escrow.rs `committed_peers`).
      ...peers.map((w) => ({
        pubkey: this.entryPda(poolKey, new PublicKey(w)),
        isSigner: false,
        isWritable: false,
      })),
    ];
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys,
        data: Buffer.concat([
          disc('pay_next_place'),
          le,
          Buffer.from([rank]),
          amountBuf,
          len,
          ...steps,
          tail,
        ]),
      }),
    ]);
  }

  async sealAtDeadline(poolId: bigint): Promise<void> {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    // Permissionless on-chain (any signer); the settlement signer pays the
    // fee here because it is the key the daemon holds. No lamports move —
    // the seal only reclassifies the pool's entries as revenue.
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: true },
          { pubkey: this.poolPda(poolId), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([disc('seal_at_deadline'), le]),
      }),
    ]);
  }

  async triggerRefund(poolId: bigint): Promise<void> {
    // D-E19: the pool's own type, derived from what the POOL records — its
    // slot frees here when the pool closes empty.
    const poolType = this.poolTypeOf(await this.getPool(poolId));
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: true },
          { pubkey: this.poolPda(poolId), isSigner: false, isWritable: true },
          // The untouched pot returns vault → treasury at trigger.
          { pubkey: this.vaultPda(poolId), isSigner: false, isWritable: true },
          { pubkey: this.platformPda(), isSigner: false, isWritable: true },
          { pubkey: poolType, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('trigger_refund'), le]),
      }),
    ]);
  }

  async refund(poolId: bigint, player: string): Promise<void> {
    // D-E19: the pool's own type — the last refund closes the pool and frees it.
    const poolType = this.poolTypeOf(await this.getPool(poolId));
    const poolKey = this.poolPda(poolId);
    const playerKey = new PublicKey(player);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: true },
          { pubkey: poolKey, isSigner: false, isWritable: true },
          // D-A1 revised: the FULL price back from the platform treasury.
          { pubkey: this.platformPda(), isSigner: false, isWritable: true },
          { pubkey: this.entryPda(poolKey, playerKey), isSigner: false, isWritable: true },
          { pubkey: playerKey, isSigner: false, isWritable: true },
          { pubkey: poolType, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('refund'), le]),
      }),
    ]);
  }
}
