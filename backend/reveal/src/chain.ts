/**
 * The crank's on-chain seam. `SettlementChain` is everything 2.4 needs from
 * the cluster; `FakeChain` mirrors the program's state machine for offline
 * tests; `Web3Chain` (chain-web3.ts) is the real client the devnet
 * rehearsal drives.
 */

import {
  DEFAULT_COOLDOWN_SECS,
  DEFAULT_FILL_DEADLINE_SECS,
  LIVENESS_FALLBACK_SECS,
  MIN_SEATS,
  TIER_ENTRY_LAMPORTS,
  TIER_POT_LAMPORTS,
  leafBytes,
  verifyProof,
  type ProofStep,
} from '../../scoring/src';
import { base58Decode } from '../../_shared/src/blotto-events';

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
  /** The moment entries close: open time + `Config.fill_deadline_seconds`
   * (12 h at launch), set ONCE and never rewritten (option A, founder ruling
   * 2026-09-07 — the go-timer that shortened it is gone). Past it, a pool
   * with ≥ 52 entrants seals and plays; one below 52 refunds. */
  fillDeadline: bigint;
  /** `Pool.vrf_seed` non-zero — `register` requires it (the daemon completes it). */
  vrfCommitted: boolean;
  secretRevealed: boolean;
  resultsCommitted: boolean;
  /** `Pool.results_root` as hex once committed, else null. The next-place
   * driver proves against it, and checks its recomputed ranking reproduces
   * it before building a single proof (`ranking.ts`). */
  resultsRootHex: string | null;
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
  /** The key `open_pool` requires before the liveness fallback (prompt v2
   * §A; base58). The settlement signer on devnet until E6 splits them. */
  keeper: string;
  /** `Config.fill_deadline_seconds` — copied onto each pool at open. */
  fillDeadlineSeconds: bigint;
  /** `Config.cooldown_seconds` — stamped into `tierNextOpenAt` when a tier's
   * slot frees. */
  cooldownSeconds: bigint;
  /** Per tier: the earliest unix second its next pool may open; 0n = the
   * tier never settled a pool. */
  tierNextOpenAt: bigint[];
}

export interface ChainEntryView {
  /** Base58 wallet. */
  player: string;
  index: number;
  /** Hex — what `register` committed. */
  battlesHash: string;
  flagged: boolean;
  refunded: boolean;
  /** `pay_prizes` (or a next-place payout) closed this seat. */
  settled: boolean;
  /** Review upheld the flag: the held share can only go to the next
   * eligible place (2026-09-07). */
  forfeited: boolean;
  /** `Entry.escrow`: lamports still held in the pool vault for this seat
   * (0 once released, or never escrowed). A settled, flagged, not-forfeited
   * entry with a positive escrow is a share UNDER REVIEW. */
  escrowLamports: bigint;
  /** `Entry.escrowed_at`: the on-chain unix second the share was escrowed
   * at `pay_prizes` — the clock both the program's seven-day safeguard and
   * the daemon's twelve-hour release (Phase 2 Stage D) run from. 0 when
   * never escrowed. */
  escrowedAt: bigint;
}

/**
 * What the in-memory chain STORES per entry: the on-chain fields the fake
 * keeps on the entry itself. Escrow lamports and the escrow timestamp live
 * in the fake's own maps (as they always have) and are joined in at
 * `getEntries`, so a test that pushes entries directly writes only these.
 */
export type FakeEntry = Omit<ChainEntryView, 'escrowLamports' | 'escrowedAt'>;

/** One Merkle proof step in the program's argument shape (mirrors
 * `merkle.rs::ProofStep`; the scoring engine's `ProofStep` is the same
 * data under camelCase — `toChainProof` converts). */
export type ChainProofStep = ProofStep;

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
  /** Escrowed share → the player: the reviewed path (settlement-signed; KYC
   * packet per R3 when the switch applies). Anyone may land the same call
   * seven days after escrow (`ESCROW_AUTO_RELEASE_SECS`) — the on-chain
   * auto-release; implementations sign with whatever key they hold. */
  releaseEscrow(poolId: bigint, player: string): Promise<void>;
  /** Review upheld the flag — ADMIN-signed since 2026-09-07 (founder ruling
   * 4): the share stays in the pool's vault, marked forfeited, and NO
   * lamport moves. An implementation without the admin key must throw. */
  forfeitEscrow(poolId: bigint, player: string): Promise<void>;
  /**
   * `pay_next_place` (ruling 4 (ii), addendum ruling 3): ONE member's
   * portion of a forfeited share — `to` at committed `rank` with committed
   * `amount` (the leaf as published; a next-rank leaf carries 0), proven by
   * `proof` against `Pool.results_root`; the share is divided equally
   * among `groupSize` eligible members, the indivisible remainder to the
   * member with `takesRemainder` (the lowest entry number). `peers` are the
   * base58 wallets of every OTHER committed (first-place) seat — all but
   * `from` and `to` — in ascending seat order (escrow.rs `committed_peers`);
   * at first place the program recomputes the group from them and refuses
   * arguments that disagree, at the next rank they must all be forfeited.
   */
  payNextPlace(
    poolId: bigint,
    from: string,
    to: string,
    rank: number,
    amount: bigint,
    proof: readonly ChainProofStep[],
    groupSize: number,
    takesRemainder: boolean,
    peers: readonly string[]
  ): Promise<void>;
  /** `seal_at_deadline` (D-E4): an Open pool past its deadline with 52..63
   * entrants seals and plays. Permissionless on-chain — the settlement
   * signer merely pays the fee; the seal is a function of state and time. */
  sealAtDeadline(poolId: bigint): Promise<void>;
  /** `trigger_refund` (R7 as amended by D-E4): an Open pool past its
   * deadline with FEWER than 52 entrants refunds. */
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
  /** `open_pool`: KEEPER-signed (prompt v2 §A — `Config.keeper`, or any
   * signer once the tier's liveness fallback holds); `poolId` must equal
   * `nextPoolId`; refused while the tier cools down. */
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
    keeper: string;
    vaultCeilingLamports: bigint[];
    treasuryMinPlatformLamports: bigint;
  }): Promise<void>;
  /** The platform treasury PDA's lamport balance (the keeper's policy input). */
  getPlatformBalance(): Promise<bigint>;
}

/**
 * `escrow.rs::review_pending`, mirrored: a flag review not yet resolved.
 *
 * EXPORTED because the next-place driver (`next-place.ts`) must classify
 * recipients by exactly the rule the program applies. Two copies of this
 * predicate would be two chances to offer the program a split it refuses —
 * or worse, one it accepts and we did not intend.
 */
export function reviewPending(
  e: Pick<ChainEntryView, 'flagged' | 'forfeited' | 'settled'>,
  escrow: bigint
): boolean {
  return e.flagged && !e.forfeited && (!e.settled || escrow > 0n);
}

/** `escrow.rs::eligible`, mirrored. See `reviewPending` for why it is exported. */
export function eligibleFor(
  e: Pick<ChainEntryView, 'flagged' | 'forfeited' | 'settled' | 'refunded'>,
  escrow: bigint
): boolean {
  return !e.refunded && !e.forfeited && !reviewPending(e, escrow);
}

/** The forfeiter-side split book-keeping (`Entry.split_*`). */
interface SplitState {
  total: bigint;
  paidMask: bigint;
  groupSize: number;
  remainderPaid: boolean;
}

/**
 * In-memory chain mirroring the program's checks — enough of the state
 * machine that a crank bug (double commit, pay before commit, a malformed
 * payout list, a seat outside the committed set) fails the same way it
 * would on-chain.
 */
export class FakeChain implements KeeperChain {
  pools = new Map<string, ChainPoolView>();
  entries = new Map<string, FakeEntry[]>();
  /** Lamports paid per player (base58) — asserted by tests. */
  paid = new Map<string, bigint>();
  /** Lamports escrowed per player at payout (flagged entries). */
  escrowed = new Map<string, bigint>();
  /** The clock reading at escrow, per player — `Entry.escrowed_at`. */
  escrowedAt = new Map<string, bigint>();
  revealed = new Map<string, Uint8Array>();
  committedRoots = new Map<string, Uint8Array>();
  /** Published sealing keys per pool, captured at openPool — asserted by tests. */
  openedWith = new Map<string, { publicKey: Uint8Array; secretHash: Uint8Array }>();
  /** Pools whose pass-collection asset exists (write-once, like the PDA). */
  passCollections = new Set<string>();
  /** `Config`, or null until initConfig — mirrors the uninitialized PDA. */
  config: ChainConfigView | null = null;
  /** The key `openPool` "signs" with — the keeper at init (the settlement
   * signer, the devnet posture). Tests set another string to exercise the
   * keeper gate and the liveness fallback. */
  opener = 'settle';
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

  /** `set_pool_timing` (admin): future pools' deadline and the cooldown. */
  setPoolTiming(fillDeadlineSeconds: bigint, cooldownSeconds: bigint): void {
    if (!this.config) throw new Error('config account not found');
    if (fillDeadlineSeconds <= 0n || cooldownSeconds <= 0n) throw new Error('InvalidTiming');
    this.config.fillDeadlineSeconds = fillDeadlineSeconds;
    this.config.cooldownSeconds = cooldownSeconds;
  }

  /** `set_keeper` (admin). */
  setKeeper(keeper: string): void {
    if (!this.config) throw new Error('config account not found');
    this.config.keeper = keeper;
  }

  /** The v2 register money model: 100% of the price into the treasury,
   * tracked refundable until seal. Pushes the entry, then applies the
   * program's post-entry transition (the seal at 64). */
  registerEntry(poolId: bigint, entry: FakeEntry): void {
    const p = this.pools.get(poolId.toString());
    if (!p) throw new Error(`no pool ${poolId}`);
    if (p.state !== 'Open') throw new Error('PoolNotOpen');
    if (this.now() > p.fillDeadline) throw new Error('DeadlinePassed');
    const key = poolId.toString();
    const list = this.entries.get(key) ?? [];
    list.push(entry);
    this.entries.set(key, list);
    p.entrants = list.length;
    this.platform += p.entryLamports;
    this.refundableByPool.set(key, (this.refundableByPool.get(key) ?? 0n) + p.entryLamports);
    this.applyEntryTransitions(poolId);
  }

  /** `register`'s post-entry transition, mirrored: at 64 the pool seals.
   * Nothing happens at 52 (option A — the deadline, set once at open,
   * decides; the go-timer is gone). Public so test helpers that push
   * entries directly can apply the same transition the program would. */
  applyEntryTransitions(poolId: bigint): void {
    const p = this.pools.get(poolId.toString());
    if (!p) throw new Error(`no pool ${poolId}`);
    if (p.state !== 'Open') return;
    p.entrants = this.entries.get(poolId.toString())?.length ?? p.entrants;
    if (p.entrants === 64) this.sealPool(poolId);
  }

  async getPool(poolId: bigint): Promise<ChainPoolView> {
    const p = this.pools.get(poolId.toString());
    if (!p) throw new Error(`no pool ${poolId}`);
    const root = this.committedRoots.get(poolId.toString());
    return {
      ...p,
      payouts: p.payouts.map((x) => ({ ...x })),
      resultsRootHex: root ? Buffer.from(root).toString('hex') : null,
    };
  }

  async getEntries(poolId: bigint): Promise<ChainEntryView[]> {
    return (this.entries.get(poolId.toString()) ?? []).map((e) => ({
      ...e,
      escrowLamports: this.escrowed.get(e.player) ?? 0n,
      escrowedAt: this.escrowedAt.get(e.player) ?? 0n,
    }));
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
      if (entry.settled) throw new Error('EntryAlreadySettled');
      if (entry.flagged) {
        // Escrowed: the lamports stay put (mirrors the program), stamped
        // with the clock — `Entry.escrowed_at`.
        this.escrowed.set(
          entry.player,
          (this.escrowed.get(entry.player) ?? 0n) + committed.amountLamports
        );
        this.escrowedAt.set(entry.player, this.now());
      } else {
        this.paid.set(
          entry.player,
          (this.paid.get(entry.player) ?? 0n) + committed.amountLamports
        );
      }
      entry.settled = true;
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
    if (e.settled) throw new Error('EntryAlreadySettled');
    e.flagged = true;
  }

  async clearFlag(poolId: bigint, player: string): Promise<void> {
    const e = (this.entries.get(poolId.toString()) ?? []).find((x) => x.player === player);
    if (!e) throw new Error('EntryMismatch');
    if (e.settled) throw new Error('EntryAlreadySettled');
    e.flagged = false;
  }

  async releaseEscrow(poolId: bigint, player: string): Promise<void> {
    const amount = this.escrowed.get(player) ?? 0n;
    if (amount === 0n) throw new Error('NoEscrow');
    const e = (this.entries.get(poolId.toString()) ?? []).find((x) => x.player === player);
    // An upheld flag closes this door for good (escrow.rs).
    if (e?.forfeited) throw new Error('EscrowForfeitedAlready');
    this.escrowed.delete(player);
    this.paid.set(player, (this.paid.get(player) ?? 0n) + amount);
  }

  /** Forfeited (held, awaiting the next-place payout) lamports per player —
   * asserted by tests. Since 2026-09-07 NOTHING moves at forfeit: the share
   * stays in `escrowed` AND is recorded here; `payNextPlace` draws both
   * down, portion by portion. */
  forfeited = new Map<string, bigint>();
  /** Per forfeiter: the split's book-keeping (`Entry.split_*`). */
  splits = new Map<string, SplitState>();

  async forfeitEscrow(poolId: bigint, player: string): Promise<void> {
    const amount = this.escrowed.get(player) ?? 0n;
    if (amount === 0n) throw new Error('NoEscrow');
    const e = (this.entries.get(poolId.toString()) ?? []).find((x) => x.player === player);
    if (!e) throw new Error('EntryMismatch');
    if (!e.flagged) throw new Error('ForfeitRequiresFlag');
    if (e.forfeited) throw new Error('EscrowForfeitedAlready');
    e.forfeited = true;
    this.forfeited.set(player, amount);
    // No lamport moves: not to the treasury, not anywhere (ruling 4).
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
    const key = poolId.toString();
    const p = this.pools.get(key)!;
    const entries = this.entries.get(key) ?? [];
    const fromEntry = entries.find((x) => x.player === from);
    const toEntry = entries.find((x) => x.player === to);
    if (!fromEntry || !toEntry) throw new Error('EntryMismatch');
    if (from === to) throw new Error('NextPlaceIneligible');
    const escrowOf = (player: string): bigint => this.escrowed.get(player) ?? 0n;
    // The program's checks (escrow.rs `handle_pay_next_place`), in order.
    if (p.state !== 'Paid') throw new Error('ResultsNotCommitted');
    if (!fromEntry.forfeited) throw new Error('EscrowNotForfeited');
    const remaining = escrowOf(from);
    if (remaining === 0n) throw new Error('NoEscrow');
    if (toEntry.refunded || toEntry.forfeited) throw new Error('NextPlaceIneligible');
    if (reviewPending(toEntry, escrowOf(to))) throw new Error('NextPlaceReviewPending');
    const split: SplitState = this.splits.get(from) ?? {
      total: 0n,
      paidMask: 0n,
      groupSize: 0,
      remainderPaid: false,
    };
    const toBit = 1n << BigInt(toEntry.index);
    if (split.paidMask & toBit) throw new Error('RankAlreadySettled');
    if (groupSize < 1) throw new Error('NextPlaceSplitMismatch');
    const root = this.committedRoots.get(key);
    if (!root) throw new Error('ResultsNotCommitted');
    const leaf = leafBytes({ player: base58Decode(to), rank, amountLamports: amount });
    if (!verifyProof(leaf, proof, root)) throw new Error('InvalidMerkleProof');
    const committed = p.payouts.map((x) => x.entryIndex);
    const toInCommitted = committed.includes(toEntry.index);
    const toIsFirst = rank === 1;
    if (toIsFirst) {
      if (!toInCommitted) throw new Error('NextPlaceRankInvalid');
    } else if (toInCommitted || rank !== 1 + committed.length) {
      throw new Error('NextPlaceRankInvalid');
    }
    // Every other committed seat, classified.
    const expectedPeers = committed.filter((s) => s !== fromEntry.index && s !== toEntry.index);
    if (peers.length !== expectedPeers.length) throw new Error('NextPlaceIneligible');
    let eligibleCount = toIsFirst ? 1 : 0;
    let lowestEligible = toIsFirst ? toEntry.index : Number.MAX_SAFE_INTEGER;
    expectedPeers.forEach((seat, i) => {
      const peer = entries.find((x) => x.player === peers[i]);
      if (!peer || peer.index !== seat) throw new Error('EntryMismatch');
      if (reviewPending(peer, escrowOf(peer.player))) throw new Error('NextPlaceReviewPending');
      if (eligibleFor(peer, escrowOf(peer.player))) {
        eligibleCount += 1;
        lowestEligible = Math.min(lowestEligible, peer.index);
      } else if (!peer.forfeited) {
        throw new Error('NextPlaceIneligible');
      }
    });
    if (toIsFirst) {
      if (groupSize !== eligibleCount) throw new Error('NextPlaceSplitMismatch');
      if (takesRemainder !== (toEntry.index === lowestEligible)) {
        throw new Error('NextPlaceSplitMismatch');
      }
    } else if (eligibleCount !== 0) {
      throw new Error('NextPlaceIneligible');
    }
    if (split.groupSize !== 0 && split.groupSize !== groupSize) {
      throw new Error('NextPlaceSplitMismatch');
    }
    if (takesRemainder && split.remainderPaid) throw new Error('NextPlaceSplitMismatch');
    let paidSoFar = 0;
    for (let b = 0n; b < 64n; b++) if (split.paidMask & (1n << b)) paidSoFar++;
    if (paidSoFar >= groupSize) throw new Error('NextPlaceSplitMismatch');
    // The portion.
    const total = split.groupSize === 0 ? remaining : split.total;
    const n = BigInt(groupSize);
    const per = total / n;
    const rem = total % n;
    const portion = takesRemainder ? per + rem : per;
    if (portion <= 0n || portion > remaining) throw new Error('NextPlaceSplitMismatch');
    if (paidSoFar + 1 === groupSize && portion !== remaining) {
      throw new Error('NextPlaceSplitMismatch'); // the last payment empties the share
    }
    // Pay: vault → the member; the forfeiter's records move on.
    if (split.groupSize === 0) {
      split.groupSize = groupSize;
      split.total = total;
    }
    split.paidMask |= toBit;
    if (takesRemainder) split.remainderPaid = true;
    this.splits.set(from, split);
    const left = remaining - portion;
    if (left === 0n) {
      this.escrowed.delete(from);
      this.forfeited.delete(from);
    } else {
      this.escrowed.set(from, left);
      this.forfeited.set(from, left);
    }
    this.paid.set(to, (this.paid.get(to) ?? 0n) + portion);
    toEntry.settled = true;
  }

  async sealAtDeadline(poolId: bigint): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    // The program's four guards (seal.rs), mirrored in order.
    if (p.state !== 'Open') throw new Error('PoolNotOpen');
    if (!(this.now() > p.fillDeadline)) throw new Error('DeadlineNotPassed');
    if (BigInt(p.entrants) < MIN_SEATS) throw new Error('FieldBelowMinimum');
    if (p.entrants >= 64) throw new Error('PoolFull');
    this.sealPool(poolId);
  }

  async triggerRefund(poolId: bigint): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    // The program's three guards (refund.rs), mirrored in order — the
    // deadline is STRICTLY past, exactly as `Clock` is compared on-chain.
    if (p.state !== 'Open') throw new Error('PoolNotOpen');
    if (!(this.now() > p.fillDeadline)) throw new Error('DeadlineNotPassed');
    if (BigInt(p.entrants) >= MIN_SEATS) throw new Error('FieldReached');
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
      tierNextOpenAt: [...this.config.tierNextOpenAt],
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
    keeper: string;
    vaultCeilingLamports: bigint[];
    treasuryMinPlatformLamports: bigint;
  }): Promise<void> {
    if (this.config) throw new Error('already in use'); // Anchor `init` on an existing PDA
    // Launch policy baked into the handler: only tier 0 open, ids from 1,
    // prices and pots from the launch tables, reserve_pots = 1, the
    // 2026-09-07 timings at their defaults, no tier ever settled.
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
      keeper: args.keeper,
      fillDeadlineSeconds: DEFAULT_FILL_DEADLINE_SECS,
      cooldownSeconds: DEFAULT_COOLDOWN_SECS,
      tierNextOpenAt: [0n, 0n, 0n, 0n, 0n, 0n, 0n],
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
    // Prompt v2 §B.6 / §A: the cooldown, then the keeper gate with its
    // liveness fallback (open_pool.rs, in the program's order).
    const now = this.now();
    const nextOpenAt = cfg.tierNextOpenAt[tier];
    if (now < nextOpenAt) throw new Error('TierCoolingDown');
    if (this.opener !== cfg.keeper && now < nextOpenAt + LIVENESS_FALLBACK_SECS) {
      throw new Error('NotKeeper');
    }
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
    this.pools.set(poolId.toString(), {
      poolId,
      tier,
      state: 'Open',
      resultsRootHex: null,
      entryLamports: cfg.tierPriceLamports[tier],
      potLamports: pot,
      // Copied at open from Config (never moved by a later set_pool_timing).
      fillDeadline: now + cfg.fillDeadlineSeconds,
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

  /** The seal itself — the 64th `register`'s effect and `seal_at_deadline`'s
   * alike (the program's shared `seal_pool`): the pool seals and its entries
   * become revenue. The tier slot is NOT freed here — SEQUENTIAL pools
   * (D-A1 revised): only Paid or Closed clears it. */
  sealPool(poolId: bigint): void {
    const p = this.pools.get(poolId.toString())!;
    p.state = 'Sealed';
    p.entrants = this.entries.get(poolId.toString())?.length ?? p.entrants;
    this.refundableByPool.delete(poolId.toString());
  }

  /** `slot.rs::free_tier_slot`: clear the slot and stamp the cooldown. */
  private clearActiveSlot(poolId: bigint, tier: number): void {
    if (this.config && this.config.activePoolByTier[tier] === poolId) {
      this.config.activePoolByTier[tier] = 0n;
      this.config.tierNextOpenAt[tier] = this.now() + this.config.cooldownSeconds;
    }
  }
}
