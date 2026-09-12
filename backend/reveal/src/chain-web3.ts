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
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import type {
  ChainConfigView,
  ChainEntryView,
  ChainPoolView,
  ChainProofStep,
  CommittedPayout,
  KeeperChain,
  PoolStateName,
} from './chain';

const STATE_NAMES: PoolStateName[] = ['Open', 'Sealed', 'Scored', 'Paid', 'Refunding', 'Closed'];

/** Metaplex Core, pinned by address in the program (`pass.rs::MPL_CORE_ID`). */
const MPL_CORE_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');

const N_TIERS = 7;

/** `Config::SPACE` since the 2026-09-07 upgrade (state.rs). An account
 * still at the OLD size (380) is the pre-migration layout — every read
 * refuses it by name so the operator runs `admin.ts migrate-config`. */
const CONFIG_SPACE = 484;
const CONFIG_SPACE_V1 = 380;
/** `Entry::SPACE` since the same upgrade (state.rs). */
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

  private async send(
    ixs: TransactionInstruction[],
    signers: Keypair[] = [this.cfg.settlementSigner]
  ): Promise<void> {
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ...ixs
    );
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
    // Offsets mirror state.rs since D-A1 v2 (asserted by its serialize-LEN
    // tests and the LiteSVM readers): disc 8 | id 8 | tier 1 |
    // entry_lamports 8 | pot_lamports 8 | entrants 2 | opened_at 8 |
    // fill_deadline 8 | state 1 | sealing 32 | hash 32 | vrf 32 |
    // counters 10 | secret_revealed 1 | root 32 | committed 1 |
    // payouts_len 2 | payouts 64×(seat 2 + amount 8) | paid_mask 8 | ...
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
      tier: d[16],
      state: STATE_NAMES[d[51]],
      entryLamports: d.readBigUInt64LE(17),
      potLamports: d.readBigUInt64LE(25),
      fillDeadline: BigInt(d.readBigInt64LE(43)),
      // vrf_seed occupies bytes 116..148; all-zero is the uncommitted sentinel.
      vrfCommitted: d.subarray(116, 148).some((b) => b !== 0),
      secretRevealed: d[158] !== 0,
      resultsCommitted: committed,
      // root occupies bytes 159..191, between secret_revealed and committed.
      resultsRootHex: committed ? d.subarray(159, 191).toString('hex') : null,
      paidMask: d.readBigUInt64LE(834),
      payouts,
      entrants: d.readUInt16LE(33),
    };
  }

  async getConfig(): Promise<ChainConfigView> {
    const info = await this.cfg.connection.getAccountInfo(this.configPda(), 'confirmed');
    if (!info) throw new Error('config account not found');
    const d = info.data;
    // Config layout since D-A1 v2 (state.rs, LEN-asserted): disc 8 |
    // admin 32 | entry_signer 32 | settlement_signer 32 | paused 1 (104) |
    // open_tiers 7 (105) | ceilings 7×8 (112) | prices 7×8 (168) |
    // pots 7×8 (224) | reserve_pots 1 (280) | min_platform 8 (281) |
    // reserved 8 (289) | refundable 8 (297) | platform_bump 1 (305) |
    // kyc 8 (306) | detection 1 (314) | next_pool_id 8 (315) |
    // active_by_tier 7×8 (323) | bump 1 (379) | — the 2026-09-07 tail,
    // appended AFTER bump: keeper 32 (380) | fill_deadline_seconds 8 (412) |
    // cooldown_seconds 8 (420) | tier_next_open_at 7×8 (428) — 484 in all.
    if (d.length === CONFIG_SPACE_V1) {
      throw new Error(
        'Config is the pre-migration layout (380 bytes): run `admin.ts migrate-config` ' +
          'before anything else (runbook step 3b)'
      );
    }
    if (d.length !== CONFIG_SPACE) {
      throw new Error(`Config account is ${d.length} bytes; source says ${CONFIG_SPACE}`);
    }
    const openTiers: boolean[] = [];
    const activePoolByTier: bigint[] = [];
    const tierPriceLamports: bigint[] = [];
    const tierPotLamports: bigint[] = [];
    const tierNextOpenAt: bigint[] = [];
    for (let t = 0; t < N_TIERS; t++) {
      openTiers.push(d[105 + t] !== 0);
      activePoolByTier.push(d.readBigUInt64LE(323 + 8 * t));
      tierPriceLamports.push(d.readBigUInt64LE(168 + 8 * t));
      tierPotLamports.push(d.readBigUInt64LE(224 + 8 * t));
      tierNextOpenAt.push(d.readBigInt64LE(428 + 8 * t));
    }
    return {
      paused: d[104] !== 0,
      openTiers,
      activePoolByTier,
      nextPoolId: d.readBigUInt64LE(315),
      tierPriceLamports,
      tierPotLamports,
      treasuryReservePots: d[280],
      treasuryMinPlatformLamports: d.readBigUInt64LE(281),
      platformReserved: d.readBigUInt64LE(289),
      platformRefundable: d.readBigUInt64LE(297),
      keeper: new PublicKey(d.subarray(380, 412)).toBase58(),
      fillDeadlineSeconds: d.readBigInt64LE(412),
      cooldownSeconds: d.readBigInt64LE(420),
      tierNextOpenAt,
    };
  }

  async getPlatformBalance(): Promise<bigint> {
    const info = await this.cfg.connection.getAccountInfo(this.platformPda(), 'confirmed');
    return BigInt(info?.lamports ?? 0);
  }

  async openPool(
    poolId: bigint,
    tier: number,
    sealingPubkey: Uint8Array,
    sealingSecretHash: Uint8Array
  ): Promise<void> {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    const keeper = this.keeper();
    await this.send(
      [
        new TransactionInstruction({
          programId: this.cfg.programId,
          keys: [
            // Keeper-signed since 2026-09-07 (prompt v2 §A): `Config.keeper`
            // pays the Pool's rent; any signer only after the liveness
            // fallback (open_pool.rs).
            { pubkey: keeper.publicKey, isSigner: true, isWritable: true },
            { pubkey: this.configPda(), isSigner: false, isWritable: true },
            { pubkey: this.poolPda(poolId), isSigner: false, isWritable: true },
            { pubkey: this.vaultPda(poolId), isSigner: false, isWritable: true },
            { pubkey: this.platformPda(), isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([
            disc('open_pool'),
            le,
            Buffer.from([tier]),
            Buffer.from(sealingPubkey),
            Buffer.from(sealingSecretHash),
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
    return accounts
      .map(({ account }) => {
        const d = account.data;
        return {
          player: new PublicKey(d.subarray(40, 72)).toBase58(),
          index: d.readUInt16LE(72),
          battlesHash: d.subarray(74, 106).toString('hex'),
          flagged: d[179] !== 0,
          refunded: d[181] !== 0,
          settled: d[180] !== 0,
          forfeited: d[199] !== 0,
          escrowLamports: d.readBigUInt64LE(182),
          escrowedAt: d.readBigInt64LE(191),
          sanctionsHold: d[227] !== 0,
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
      // writes it (the pot leaves `platform_reserved` and the tier slot
      // frees). Anchor checks that constraint while assembling accounts,
      // before the handler runs, so a read-only Config reverted EVERY batch,
      // not just the last — no pool could be paid at all. Pinned across the
      // language boundary by test/account-metas.spec.ts (audit A-01).
      { pubkey: this.configPda(), isSigner: false, isWritable: true },
      { pubkey: poolKey, isSigner: false, isWritable: true },
      { pubkey: this.vaultPda(poolId), isSigner: false, isWritable: true },
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
    ]);
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
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('trigger_refund'), le]),
      }),
    ]);
  }

  async refund(poolId: bigint, player: string): Promise<void> {
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
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('refund'), le]),
      }),
    ]);
  }
}
