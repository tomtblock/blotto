/**
 * The crank's on-chain seam. `SettlementChain` is everything 2.4 needs from
 * the cluster; `FakeChain` mirrors the program's state machine for offline
 * tests; `Web3Chain` (chain-web3.ts) is the real client the devnet
 * rehearsal drives.
 */

import { TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '../../scoring/src';

export type PoolStateName = 'Open' | 'Sealed' | 'Scored' | 'Paid' | 'Refunding' | 'Closed';

/** One row of the committed payout list (D3-B): seat → lamports. */
export interface CommittedPayout {
  entryIndex: number;
  amountLamports: bigint;
}

export interface ChainPoolView {
  poolId: bigint;
  /** Tier index into the entry-price table. */
  tier: number;
  state: PoolStateName;
  entryLamports: bigint;
  /** The FIXED pot (D-A1 revised), copied from Config at open and funded
   * into the prize vault before any pass is sold. Settlement reads THIS —
   * never the launch table, which the founder can change between pools. */
  potLamports: bigint;
  fillDeadline: bigint;
  /** `Pool.vrf_seed` non-zero — `register` requires it (the daemon completes it). */
  vrfCommitted: boolean;
  secretRevealed: boolean;
  resultsCommitted: boolean;
  /** One bit per SEAT (u64 on-chain) — bigint, seats run 0..63. */
  paidMask: bigint;
  /** Seat-sorted committed payout list; empty until committed. */
  payouts: CommittedPayout[];
  entrants: number;
}

/** What the daemon reads from `Config` each tick. */
export interface ChainConfigView {
  paused: boolean;
  /** R6/D1 switchboard: which tiers may open pools. */
  openTiers: boolean[];
  /** The tier's LIVE pool id; 0n = none. SEQUENTIAL since D-A1 revised:
   * the slot clears only when the pool reaches Paid or Closed. */
  activePoolByTier: bigint[];
  /** The id `open_pool` must be called with next (gapless, monotonic). */
  nextPoolId: bigint;
  /** Per-tier entry price / FIXED pot (D-A1 revised; founder-changeable via
   * set_tier_economics, never touching an open pool). */
  tierPriceLamports: bigint[];
  tierPotLamports: bigint[];
  /** Treasury policy: reserve_pots further pots per idle enabled tier plus
   * a minimum balance, held back from withdrawals and required at open. */
  treasuryReservePots: number;
  treasuryMinPlatformLamports: bigint;
  /** Pots currently locked in live pools' prize vaults. */
  platformReserved: bigint;
  /** Entry payments of pools that can still refund — program-held (R7). */
  platformRefundable: bigint;
}

export interface ChainEntryView {
  /** Base58 wallet. */
  player: string;
  index: number;
  /** Hex — what `register` committed. */
  battlesHash: string;
  flagged: boolean;
  refunded: boolean;
}

export interface SettlementChain {
  getPool(poolId: bigint): Promise<ChainPoolView>;
  getEntries(poolId: bigint): Promise<ChainEntryView[]>;
  revealPoolSecret(poolId: bigint, secret: Uint8Array): Promise<void>;
  /** Commit the root and the settled payout list (seat-sorted, sums to pot). */
  commitResults(poolId: bigint, root: Uint8Array, payouts: CommittedPayout[]): Promise<void>;
  /** Settle a batch of committed SEATS; accounts resolved by the implementation. */
  payPrizes(poolId: bigint, seats: number[]): Promise<void>;
  /** Detection's lever (R11) — must land BEFORE the seat is paid. */
  flagEntry(poolId: bigint, player: string): Promise<void>;
  /** Review's reversal of a flag on a not-yet-settled entry (R11/4.4). */
  clearFlag(poolId: bigint, player: string): Promise<void>;
  /** Escrowed share → the player (review cleared it; KYC path per R3). */
  releaseEscrow(poolId: bigint, player: string): Promise<void>;
  /** Escrowed share → the platform wallet (review upheld the flag). */
  forfeitEscrow(poolId: bigint, player: string): Promise<void>;
  triggerRefund(poolId: bigint): Promise<void>;
  refund(poolId: bigint, player: string): Promise<void>;
}

/** Everything the daemon (C8) needs beyond settlement: reading `Config` and
 * driving the pool-launch instructions. The program's own guards (gapless
 * ids, one Open pool per tier, write-once VRF seed, write-once collection)
 * are what make a concurrent second daemon safe — implementations surface
 * those rejections as thrown errors, never by silently succeeding. */
export interface KeeperChain extends SettlementChain {
  getConfig(): Promise<ChainConfigView>;
  /** `open_pool`: settlement-signed; `poolId` must equal `nextPoolId`. */
  openPool(
    poolId: bigint,
    tier: number,
    sealingPubkey: Uint8Array,
    sealingSecretHash: Uint8Array
  ): Promise<void>;
  /** `commit_vrf_seed`: permissionless, write-once, Open pools only.
   * `randomnessAccount` is the Switchboard Randomness account (base58); the
   * web3 implementation must land it in the same transaction as the
   * Switchboard reveal (see chain-web3.ts). */
  commitVrfSeed(poolId: bigint, randomnessAccount: string): Promise<void>;
  /** `create_pass_collection`: permissionless, write-once, Open pools only. */
  createPassCollection(poolId: bigint): Promise<void>;
  /** Whether the pool's pass-collection asset exists (its PDA is initialized). */
  hasPassCollection(poolId: bigint): Promise<boolean>;
  /** `init_config`: one-time global setup, admin-signed. */
  initConfig(args: {
    entrySigner: string;
    settlementSigner: string;
    vaultCeilingLamports: bigint[];
    treasuryMinPlatformLamports: bigint;
  }): Promise<void>;
  /** The platform treasury PDA's lamport balance (the keeper's policy input). */
  getPlatformBalance(): Promise<bigint>;
}

/**
 * In-memory chain mirroring the program's checks — enough of the state
 * machine that a crank bug (double commit, pay before commit, a malformed
 * payout list, a seat outside the committed set) fails the same way it
 * would on-chain.
 */
export class FakeChain implements KeeperChain {
  pools = new Map<string, ChainPoolView>();
  entries = new Map<string, ChainEntryView[]>();
  /** Lamports paid per player (base58) — asserted by tests. */
  paid = new Map<string, bigint>();
  /** Lamports escrowed per player at payout (flagged entries). */
  escrowed = new Map<string, bigint>();
  revealed = new Map<string, Uint8Array>();
  committedRoots = new Map<string, Uint8Array>();
  /** Published sealing keys per pool, captured at openPool — asserted by tests. */
  openedWith = new Map<string, { publicKey: Uint8Array; secretHash: Uint8Array }>();
  /** Pools whose pass-collection asset exists (write-once, like the PDA). */
  passCollections = new Set<string>();
  /** `Config`, or null until initConfig — mirrors the uninitialized PDA. */
  config: ChainConfigView | null = null;
  /** R7 deadline offset applied by openPool, seconds. Tests may shrink it. */
  fillDeadlineSecs = 72n * 3600n;
  /** The platform treasury PDA's balance (D-A1 revised). Deposits via
   * `fundPlatform`; `openPool` moves pots out; refunds pay from here. */
  platform = 0n;
  /** Per-pool refundable entry payments (Σ = Config.platform_refundable).
   * Only entries landed through `registerEntry` move money — tests that
   * push into `entries` directly leave the treasury untouched, exactly as
   * they always have. */
  private refundableByPool = new Map<string, bigint>();
  /** `now` injects the clock (mirrors `Clock::get`), defaulting to 0. */
  constructor(readonly now: () => bigint = () => 0n) {}

  /** `fund_platform_wallet` — permissionless deposit. */
  fundPlatform(amount: bigint): void {
    if (amount <= 0n) throw new Error('ZeroAmount');
    this.platform += amount;
  }

  /** The v2 register money model: 100% of the price into the treasury,
   * tracked refundable until seal. Pushes the entry and, at 64, seals. */
  registerEntry(poolId: bigint, entry: ChainEntryView): void {
    const p = this.pools.get(poolId.toString());
    if (!p) throw new Error(`no pool ${poolId}`);
    if (p.state !== 'Open') throw new Error('PoolNotOpen');
    const key = poolId.toString();
    const list = this.entries.get(key) ?? [];
    list.push(entry);
    this.entries.set(key, list);
    p.entrants = list.length;
    this.platform += p.entryLamports;
    this.refundableByPool.set(key, (this.refundableByPool.get(key) ?? 0n) + p.entryLamports);
    if (p.entrants === 64) this.sealPool(poolId);
  }

  async getPool(poolId: bigint): Promise<ChainPoolView> {
    const p = this.pools.get(poolId.toString());
    if (!p) throw new Error(`no pool ${poolId}`);
    return { ...p, payouts: p.payouts.map((x) => ({ ...x })) };
  }

  async getEntries(poolId: bigint): Promise<ChainEntryView[]> {
    return (this.entries.get(poolId.toString()) ?? []).map((e) => ({ ...e }));
  }

  async revealPoolSecret(poolId: bigint, secret: Uint8Array): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    if (p.secretRevealed) throw new Error('SecretAlreadyRevealed');
    if (p.state === 'Open') throw new Error('PoolNotSealed');
    p.secretRevealed = true;
    this.revealed.set(poolId.toString(), secret.slice());
  }

  async commitResults(poolId: bigint, root: Uint8Array, payouts: CommittedPayout[]): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    if (p.state !== 'Sealed') throw new Error('PoolNotSealed');
    if (!p.secretRevealed) throw new Error('SecretNotRevealed');
    if (p.resultsCommitted) throw new Error('ResultsAlreadyCommitted');
    // The program's four checks (reveal_commit.rs), mirrored.
    if (payouts.length === 0 || payouts.length > 64) throw new Error('PayoutListMalformed');
    let total = 0n;
    payouts.forEach((x, i) => {
      if (x.entryIndex >= p.entrants) throw new Error('PayoutListMalformed');
      if (i > 0 && x.entryIndex <= payouts[i - 1].entryIndex) {
        throw new Error('PayoutListMalformed');
      }
      total += x.amountLamports;
    });
    if (total !== p.potLamports) throw new Error('PayoutSumMismatch');
    p.resultsCommitted = true;
    p.payouts = payouts.map((x) => ({ ...x }));
    p.state = 'Scored';
    this.committedRoots.set(poolId.toString(), root.slice());
  }

  async payPrizes(poolId: bigint, seats: number[]): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    if (p.state !== 'Scored') throw new Error('ResultsNotCommitted');
    const entries = this.entries.get(poolId.toString()) ?? [];
    for (const seat of seats) {
      const committed = p.payouts.find((x) => x.entryIndex === seat);
      if (!committed) throw new Error('SeatNotInPayouts');
      const bit = 1n << BigInt(seat);
      if (p.paidMask & bit) throw new Error('RankAlreadySettled');
      const entry = entries.find((e) => e.index === seat);
      if (!entry) throw new Error('EntryMismatch');
      if (entry.flagged) {
        // Escrowed: the lamports stay put (mirrors the program).
        this.escrowed.set(
          entry.player,
          (this.escrowed.get(entry.player) ?? 0n) + committed.amountLamports
        );
      } else {
        this.paid.set(
          entry.player,
          (this.paid.get(entry.player) ?? 0n) + committed.amountLamports
        );
      }
      p.paidMask |= bit;
    }
    if (p.payouts.every((x) => p.paidMask & (1n << BigInt(x.entryIndex)))) {
      p.state = 'Paid';
      // Sequential pools (D-A1 revised): Paid frees the tier's slot and
      // releases the pot from the treasury's book-keeping.
      this.reserved -= p.potLamports;
      this.clearActiveSlot(poolId, p.tier);
    }
  }

  async flagEntry(poolId: bigint, player: string): Promise<void> {
    const e = (this.entries.get(poolId.toString()) ?? []).find((x) => x.player === player);
    if (!e) throw new Error('EntryMismatch');
    e.flagged = true;
  }

  async clearFlag(poolId: bigint, player: string): Promise<void> {
    const e = (this.entries.get(poolId.toString()) ?? []).find((x) => x.player === player);
    if (!e) throw new Error('EntryMismatch');
    e.flagged = false;
  }

  async releaseEscrow(poolId: bigint, player: string): Promise<void> {
    const amount = this.escrowed.get(player) ?? 0n;
    if (amount === 0n) throw new Error('NoEscrow');
    this.escrowed.delete(player);
    this.paid.set(player, (this.paid.get(player) ?? 0n) + amount);
    void poolId;
  }

  /** Forfeited lamports per player — asserted by tests (platform-bound). */
  forfeited = new Map<string, bigint>();

  async forfeitEscrow(poolId: bigint, player: string): Promise<void> {
    const amount = this.escrowed.get(player) ?? 0n;
    if (amount === 0n) throw new Error('NoEscrow');
    this.escrowed.delete(player);
    this.forfeited.set(player, (this.forfeited.get(player) ?? 0n) + amount);
    // D-A1 revised: the forfeit destination is the platform treasury PDA.
    this.platform += amount;
    void poolId;
  }

  async triggerRefund(poolId: bigint): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    if (p.state !== 'Open') throw new Error('PoolNotOpen');
    p.state = p.entrants === 0 ? 'Closed' : 'Refunding';
    // The untouched pot returns to the treasury (refund.rs).
    this.platform += p.potLamports;
    this.reserved -= p.potLamports;
    // Sequential pools: the slot frees only when the pool CLOSES.
    if (p.state === 'Closed') this.clearActiveSlot(poolId, p.tier);
  }

  async refund(poolId: bigint, player: string): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    if (p.state !== 'Refunding') throw new Error('PoolNotRefunding');
    const e = (this.entries.get(poolId.toString()) ?? []).find((x) => x.player === player);
    if (!e) throw new Error('EntryMismatch');
    if (e.refunded) throw new Error('AlreadyRefunded');
    e.refunded = true;
    this.paid.set(player, (this.paid.get(player) ?? 0n) + p.entryLamports);
    // The full price back from the treasury (refund.rs).
    this.platform -= p.entryLamports;
    const key = poolId.toString();
    const contribution = this.refundableByPool.get(key) ?? 0n;
    if (contribution > 0n) this.refundableByPool.set(key, contribution - p.entryLamports);
    if ((this.entries.get(key) ?? []).every((x) => x.refunded)) {
      p.state = 'Closed';
      this.clearActiveSlot(poolId, p.tier);
    }
  }

  // ---- KeeperChain (C8) — the launch instructions, guards mirrored --------

  async getConfig(): Promise<ChainConfigView> {
    if (!this.config) throw new Error('config account not found');
    return {
      ...this.config,
      openTiers: [...this.config.openTiers],
      activePoolByTier: [...this.config.activePoolByTier],
      tierPriceLamports: [...this.config.tierPriceLamports],
      tierPotLamports: [...this.config.tierPotLamports],
      platformReserved: this.reserved,
      platformRefundable: this.refundable,
    };
  }

  async getPlatformBalance(): Promise<bigint> {
    return this.platform;
  }

  /** Σ per-pool refundable contributions (= Config.platform_refundable). */
  get refundable(): bigint {
    let total = 0n;
    for (const v of this.refundableByPool.values()) total += v;
    return total;
  }

  /** Pots locked in live pools (= Config.platform_reserved). */
  reserved = 0n;

  async initConfig(args: {
    entrySigner: string;
    settlementSigner: string;
    vaultCeilingLamports: bigint[];
    treasuryMinPlatformLamports: bigint;
  }): Promise<void> {
    if (this.config) throw new Error('already in use'); // Anchor `init` on an existing PDA
    // Launch policy baked into the handler: only tier 0 open, ids from 1,
    // prices and pots from the launch tables, reserve_pots = 1.
    this.config = {
      paused: false,
      openTiers: [true, false, false, false, false, false, false],
      activePoolByTier: [0n, 0n, 0n, 0n, 0n, 0n, 0n],
      nextPoolId: 1n,
      tierPriceLamports: [...TIER_ENTRY_LAMPORTS],
      tierPotLamports: [...TIER_POT_LAMPORTS],
      treasuryReservePots: 1,
      treasuryMinPlatformLamports: args.treasuryMinPlatformLamports,
      platformReserved: 0n,
      platformRefundable: 0n,
    };
  }

  async openPool(
    poolId: bigint,
    tier: number,
    sealingPubkey: Uint8Array,
    sealingSecretHash: Uint8Array
  ): Promise<void> {
    const cfg = this.config;
    if (!cfg) throw new Error('config account not found');
    if (poolId !== cfg.nextPoolId) throw new Error('WrongPoolId');
    if (tier < 0 || tier >= cfg.openTiers.length) throw new Error('UnknownTier');
    if (!cfg.openTiers[tier]) throw new Error('TierNotOpen');
    if (cfg.activePoolByTier[tier] !== 0n) throw new Error('TierAlreadyHasOpenPool');
    // The treasury policy gate (open_pool.rs): available = balance minus
    // refundable entries; after funding this pot the remainder must cover
    // the minimum plus one further pot of every OTHER enabled idle tier.
    const pot = cfg.tierPotLamports[tier];
    const available = this.platform - this.refundable;
    let idleReserve = 0n;
    for (let t = 0; t < cfg.openTiers.length; t++) {
      if (t === tier) continue;
      if (cfg.openTiers[t] && cfg.activePoolByTier[t] === 0n) {
        idleReserve += cfg.tierPotLamports[t] * BigInt(cfg.treasuryReservePots);
      }
    }
    const needed = pot + cfg.treasuryMinPlatformLamports + idleReserve;
    if (available < needed) throw new Error('TreasuryShortfall');
    // Fund the pot: treasury → the pool's prize vault, before any entry.
    this.platform -= pot;
    this.reserved += pot;
    const now = this.now();
    this.pools.set(poolId.toString(), {
      poolId,
      tier,
      state: 'Open',
      entryLamports: cfg.tierPriceLamports[tier],
      potLamports: pot,
      fillDeadline: now + this.fillDeadlineSecs,
      vrfCommitted: false,
      secretRevealed: false,
      resultsCommitted: false,
      paidMask: 0n,
      payouts: [],
      entrants: 0,
    });
    this.entries.set(poolId.toString(), []);
    this.openedWith.set(poolId.toString(), {
      publicKey: sealingPubkey.slice(),
      secretHash: sealingSecretHash.slice(),
    });
    cfg.nextPoolId += 1n;
    cfg.activePoolByTier[tier] = poolId;
  }

  async commitVrfSeed(poolId: bigint, _randomnessAccount: string): Promise<void> {
    const p = this.pools.get(poolId.toString());
    if (!p) throw new Error(`no pool ${poolId}`);
    if (p.state !== 'Open') throw new Error('PoolNotOpen');
    if (p.vrfCommitted) throw new Error('VrfSeedAlreadyCommitted'); // write-once
    p.vrfCommitted = true;
  }

  async createPassCollection(poolId: bigint): Promise<void> {
    const p = this.pools.get(poolId.toString());
    if (!p) throw new Error(`no pool ${poolId}`);
    if (p.state !== 'Open') throw new Error('PoolNotOpen');
    if (this.passCollections.has(poolId.toString())) {
      throw new Error('already in use'); // the mpl-core init on an existing PDA
    }
    this.passCollections.add(poolId.toString());
  }

  async hasPassCollection(poolId: bigint): Promise<boolean> {
    return this.passCollections.has(poolId.toString());
  }

  /** Test helper mirroring the 64th `register`: the pool seals and its
   * entries become revenue. The tier slot is NOT freed here — SEQUENTIAL
   * pools (D-A1 revised): only Paid or Closed clears it. */
  sealPool(poolId: bigint): void {
    const p = this.pools.get(poolId.toString())!;
    p.state = 'Sealed';
    p.entrants = this.entries.get(poolId.toString())?.length ?? p.entrants;
    this.refundableByPool.delete(poolId.toString());
  }

  private clearActiveSlot(poolId: bigint, tier: number): void {
    if (this.config && this.config.activePoolByTier[tier] === poolId) {
      this.config.activePoolByTier[tier] = 0n;
    }
  }
}
