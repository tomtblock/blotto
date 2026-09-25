/**
 * The crank's on-chain seam. `SettlementChain` is everything 2.4 needs from
 * the cluster; `FakeChain` mirrors the program's state machine for offline
 * tests; `Web3Chain` (chain-web3.ts) is the real client the devnet
 * rehearsal drives.
 */

import {
  DEFAULT_COOLDOWN_SECS,
  DEFAULT_FILL_DEADLINE_SECS,
  MIN_SEATS,
  TIER_ENTRY_LAMPORTS,
  TIER_POT_LAMPORTS,
  leafBytes,
  verifyProof,
  type ProofStep,
} from '../../scoring/src';
import { base58Decode } from '../../_shared/src/blotto-events';
// Imported, not re-implemented: the fake's open gate and the keeper's
// decision must be the same arithmetic or the parity suite proves nothing.
// Type-only in the other direction, so this is not a runtime cycle.
import { idleTierReserve } from './treasury';

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
  /** `Pool.mode` (Phase B, 2026-09-24): 0 easy, 1 hard — the placing rule
   * the pool was opened under. The program records it and reads it for
   * nothing; the engine that settles the pool is what it is for. A pool
   * from before the field (a pre-Phase-B account) reads 0. */
  mode: number;
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
  /** The only key `open_pool` accepts (prompt v2
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
  /**
   * Phase B (2026-09-24): the HARD ladder — its own enablement switch
   * (`set_hard_open_tiers`), live slot and cooldown clock per tier, sharing
   * the tier's price, pot and ceiling with the easy ladder above. False /
   * zero everywhere on a pre-Phase-B account (`hardLadderPresent` false),
   * which is exact: a program with no hard ladder has no open hard tier.
   */
  hardLadderPresent: boolean;
  hardOpenTiers: boolean[];
  hardActivePoolByTier: bigint[];
  hardTierNextOpenAt: bigint[];
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
  /** `Entry.sanctions_hold` (Phase 2 Stage F): the winner matched a
   * published sanctions list at resolving. BOTH paths of `release_escrow`
   * refuse while it is set, and the entry can receive no next-place portion.
   * It is NOT an integrity flag and shares nothing with one. */
  sanctionsHold: boolean;
  /** `Entry.escrowed_at`: the on-chain unix second the share was escrowed
   * at `pay_prizes` — the clock both the program's seven-day safeguard and
   * the daemon's twelve-hour release (Phase 2 Stage D) run from. 0 when
   * never escrowed. */
  escrowedAt: bigint;
  /** `Entry.next_place_lamports`: what this seat has RECEIVED by
   * `pay_next_place` from forfeited shares, on top of any committed payout.
   * 0 until a portion lands. */
  nextPlaceLamports: bigint;
  // ---- THE SPLIT FRAME (`Entry.split_*`, state.rs; escrow.rs
  // `handle_pay_next_place`). Kept on the FORFEITER's entry and FIXED by the
  // first portion paid from its share: every later portion must agree with
  // it or the program refuses (`NextPlaceSplitMismatch`), and a seat whose
  // bit is already set is refused (`RankAlreadySettled`). The next-place
  // driver reads these to RESUME a split that stopped part-way (audit
  // D-11): it plans only the seats not yet in the mask, with the group size
  // and dividend the frame fixed, so the program accepts each remaining
  // portion and the last one empties the share exactly.
  /** `Entry.split_total`: the share as it stood when the first portion went
   * out — the dividend every portion is computed from. 0 until then. */
  splitTotal: bigint;
  /** `Entry.split_paid_mask`: one bit per SEAT already paid from this
   * forfeited share (u64 on-chain; seats run 0..63). */
  splitPaidMask: bigint;
  /** `Entry.split_group_size`: how many eligible members the share is
   * divided among, fixed by the first portion. 0 = no portion paid yet —
   * the frame is not fixed and the driver plans from the live group. */
  splitGroupSize: number;
  /** `Entry.split_remainder_paid`: the indivisible remainder has been paid
   * (to the lowest entry number of the group). */
  splitRemainderPaid: boolean;
}

/**
 * What the in-memory chain STORES per entry: the on-chain fields the fake
 * keeps on the entry itself. Escrow lamports, the escrow timestamp, the
 * sanctions hold, the next-place receipts and the split frame live in the
 * fake's own maps (as escrow always has) and are joined in at `getEntries`,
 * so a test that pushes entries directly writes only these.
 */
export type FakeEntry = Omit<
  ChainEntryView,
  | 'escrowLamports'
  | 'escrowedAt'
  | 'sanctionsHold'
  | 'nextPlaceLamports'
  | 'splitTotal'
  | 'splitPaidMask'
  | 'splitGroupSize'
  | 'splitRemainderPaid'
>;

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
  /** Place a sanctions hold (Phase 2 Stage F, settlement-signed): both paths
   * of `release_escrow` then refuse and the entry can receive no next-place
   * portion. Nothing moves. Allowed AFTER settlement, unlike `flagEntry`. */
  placeSanctionsHold(poolId: bigint, player: string): Promise<void>;
  /** Lift a hold placed on a false positive — ADMIN-signed, so a client
   * without the admin key must throw (as `forfeitEscrow` does). */
  liftSanctionsHold(poolId: bigint, player: string): Promise<void>;
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
  /** `open_pool`: KEEPER-signed (prompt v2 §A — `Config.keeper` and nobody
   * else since 2026-09-07); `poolId` must equal `nextPoolId`; refused while
   * the tier cools down. `mode` (Phase B, the appended argument) picks the
   * ladder: 0 easy, 1 hard — each (mode, tier) has its own slot and clock. */
  openPool(
    poolId: bigint,
    tier: number,
    sealingPubkey: Uint8Array,
    sealingSecretHash: Uint8Array,
    mode: number
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
  /** The pool's PDA as base58 — `[b"pool", pool_id.to_le_bytes()]` on the
   * program (state.rs `POOL_SEED`). Pure: no RPC. The address is what the
   * browser, the indexer and the published bundle name a pool by; the
   * daemon addresses it by numeric id everywhere else. The fake returns
   * `pool:${poolId}` — a distinct string per pool, never a real key. */
  poolAddress(poolId: bigint): string;
  /** The CLUSTER's clock: the Clock sysvar's `unix_timestamp`, the same
   * value the program reads through `Clock::get()` for every deadline and
   * escrow guard. A wall clock on the daemon's host can run ahead of or
   * behind it; anything the daemon compares against an on-chain timestamp
   * (the fill deadline, `escrowedAt`) should use this. The fake returns its
   * injected `now()`. */
  chainNow(): Promise<bigint>;
  /**
   * The per-vault rent cushion the program applies, in lamports:
   * `Rent::minimum_balance(0)` for a zero-data account, exactly what
   * `vault::rent_floor()` reads from the sysvar (`vault.rs`). It is NOT a
   * constant — it follows the cluster's rent parameters, so it is 890,880
   * under the standard ones and 650,240 on devnet as of 2026-09-12.
   *
   * The keeper needs it because `open_pool` funds pot PLUS this and counts
   * it in `needed`, and `withdraw_platform`'s floor counts it once per
   * reserved pot. A mirror without it understates what the program will
   * demand and sends an open the program refuses (see `nextOpenable`).
   */
  vaultCushion(): Promise<bigint>;
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
  e: Pick<ChainEntryView, 'flagged' | 'forfeited' | 'settled' | 'refunded'> &
    Partial<Pick<ChainEntryView, 'sanctionsHold'>>,
  escrow: bigint
): boolean {
  // The sanctions clause mirrors `escrow.rs::eligible` (Stage F): a held
  // entry is not forfeited, so without it a held winner would still count as
  // an eligible member of the first-place group and the next-place split
  // would pay a listed wallet.
  return (
    !e.refunded && !e.forfeited && e.sanctionsHold !== true && !reviewPending(e, escrow)
  );
}

/**
 * The review clock's predicate: a share the clock may release once the
 * published window has passed. Mirrors what `release_escrow` will accept
 * (escrow.rs `handle_release_escrow`): escrow held (`NoEscrow` otherwise),
 * not forfeited (`EscrowForfeitedAlready`), and NO sanctions hold — that
 * check sits ABOVE the path split in the program, so the reviewed path and
 * the seven-day permissionless path both refuse while it is set
 * (`SanctionsHoldActive`). `settled && flagged` narrows it to the shares
 * `pay_prizes` escrowed under a flag: an unflagged escrow is a KYC hold
 * (R3), which no clock releases.
 *
 * EXPORTED for the daemon's review clock, for the same reason as
 * `reviewPending`: one predicate, shared, or two chances to send the program
 * a release it refuses — or, worse, to skip one it would accept.
 */
export function releasableByClock(
  e: Pick<ChainEntryView, 'settled' | 'flagged' | 'forfeited' | 'sanctionsHold'>,
  escrow: bigint
): boolean {
  return e.settled && e.flagged && !e.forfeited && escrow > 0n && !e.sanctionsHold;
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
  /** Lamports escrowed per player at payout (flagged or sanctions-held). */
  escrowed = new Map<string, bigint>();
  /** The clock reading at escrow, per player — `Entry.escrowed_at`. */
  escrowedAt = new Map<string, bigint>();
  /** Players under a sanctions hold (Stage F) — `Entry.sanctions_hold`. */
  sanctionsHeld = new Set<string>();
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
   * keeper gate. */
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
    return (this.entries.get(poolId.toString()) ?? []).map((e) => {
      // The split frame as the program stores it on the forfeiter's Entry:
      // zero / false until the first portion of its share is paid.
      const split = this.splits.get(e.player);
      return {
        ...e,
        escrowLamports: this.escrowed.get(e.player) ?? 0n,
        escrowedAt: this.escrowedAt.get(e.player) ?? 0n,
        sanctionsHold: this.sanctionsHeld.has(e.player),
        nextPlaceLamports: this.nextPlacePaid.get(e.player) ?? 0n,
        splitTotal: split?.total ?? 0n,
        splitPaidMask: split?.paidMask ?? 0n,
        splitGroupSize: split?.groupSize ?? 0,
        splitRemainderPaid: split?.remainderPaid ?? false,
      };
    });
  }

  /** The pool PDA stands in as a distinct string per pool — the fake never
   * derives a real key (`KeeperChain.poolAddress`). */
  poolAddress(poolId: bigint): string {
    return `pool:${poolId}`;
  }

  /** The injected clock — the same reading every guard in this fake uses
   * (`KeeperChain.chainNow`). */
  async chainNow(): Promise<bigint> {
    return this.now();
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
      if (entry.flagged || this.sanctionsHeld.has(entry.player)) {
        // Escrowed: the lamports stay put (mirrors the program), stamped
        // with the clock — `Entry.escrowed_at`. A sanctions hold diverts the
        // share here for the same reason the program does it: the hold is
        // enforced on ESCROW, so a held seat paid straight out would slip
        // past every check downstream.
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
      this.clearActiveSlot(poolId, p.tier, p.mode);
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
    // A sanctions hold closes BOTH doors — checked above the path split in
    // the program, so the seven-day auto-release cannot pay a listed wallet.
    if (this.sanctionsHeld.has(player)) throw new Error('SanctionsHoldActive');
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
  /** Per recipient: lamports received by next-place payout
   * (`Entry.next_place_lamports`). `paid` carries the same lamports too —
   * it is the per-player total across every exit — so this is the record a
   * test reads when it needs the next-place portions apart. */
  nextPlacePaid = new Map<string, bigint>();

  async placeSanctionsHold(poolId: bigint, player: string): Promise<void> {
    const e = (this.entries.get(poolId.toString()) ?? []).find((x) => x.player === player);
    if (!e) throw new Error('EntryMismatch');
    if (this.sanctionsHeld.has(player)) throw new Error('SanctionsHoldActive');
    this.sanctionsHeld.add(player);
  }

  async liftSanctionsHold(poolId: bigint, player: string): Promise<void> {
    const e = (this.entries.get(poolId.toString()) ?? []).find((x) => x.player === player);
    if (!e) throw new Error('EntryMismatch');
    if (!this.sanctionsHeld.has(player)) throw new Error('NoSanctionsHold');
    this.sanctionsHeld.delete(player);
  }

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
    // The RECIPIENT's sanctions guard. The program checks `to` inline rather
    // than through `eligible()` — which classifies the PEERS — so the hold
    // has to be refused in both places or a held wallet is excluded from the
    // group and paid as the recipient anyway.
    if (this.sanctionsHeld.has(to)) throw new Error('SanctionsHoldActive');
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
    this.nextPlacePaid.set(to, (this.nextPlacePaid.get(to) ?? 0n) + portion);
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
    if (p.state === 'Closed') this.clearActiveSlot(poolId, p.tier, p.mode);
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
      this.clearActiveSlot(poolId, p.tier, p.mode);
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
      hardOpenTiers: [...this.config.hardOpenTiers],
      hardActivePoolByTier: [...this.config.hardActivePoolByTier],
      hardTierNextOpenAt: [...this.config.hardTierNextOpenAt],
      platformReserved: this.reserved,
      platformRefundable: this.refundable,
    };
  }

  /**
   * The cushion the fake reports. Defaults to the STANDARD rent parameters
   * (890,880) rather than devnet's, because a mirror that only works on one
   * cluster's numbers is the defect this exists to catch.
   */
  vaultCushionLamports = 890_880n;

  async vaultCushion(): Promise<bigint> {
    return this.vaultCushionLamports;
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
      // Phase B: the hard ladder starts fully disabled (admin.rs), like the
      // program's `init_config`.
      hardLadderPresent: true,
      hardOpenTiers: [false, false, false, false, false, false, false],
      hardActivePoolByTier: [0n, 0n, 0n, 0n, 0n, 0n, 0n],
      hardTierNextOpenAt: [0n, 0n, 0n, 0n, 0n, 0n, 0n],
    };
  }

  /** The admin's `set_hard_open_tiers` (Phase B): the hard ladder's switch,
   * with the same restamp-on-enable rule as `set_open_tiers`. */
  setHardOpenTiers(openTiers: boolean[]): void {
    const cfg = this.config;
    if (!cfg) throw new Error('config account not found');
    const now = this.now();
    openTiers.forEach((enabled, t) => {
      if (enabled && !cfg.hardOpenTiers[t]) {
        cfg.hardTierNextOpenAt[t] = cfg.hardTierNextOpenAt[t] > now ? cfg.hardTierNextOpenAt[t] : now;
      }
    });
    cfg.hardOpenTiers = [...openTiers];
  }

  async openPool(
    poolId: bigint,
    tier: number,
    sealingPubkey: Uint8Array,
    sealingSecretHash: Uint8Array,
    mode: number
  ): Promise<void> {
    const cfg = this.config;
    if (!cfg) throw new Error('config account not found');
    if (poolId !== cfg.nextPoolId) throw new Error('WrongPoolId');
    if (tier < 0 || tier >= cfg.openTiers.length) throw new Error('UnknownTier');
    // Phase B: the mode is checked before any per-mode read (open_pool.rs).
    if (mode !== 0 && mode !== 1) throw new Error('UnknownMode');
    const hard = mode === 1;
    const openTiers = hard ? cfg.hardOpenTiers : cfg.openTiers;
    const active = hard ? cfg.hardActivePoolByTier : cfg.activePoolByTier;
    const nextOpen = hard ? cfg.hardTierNextOpenAt : cfg.tierNextOpenAt;
    if (!openTiers[tier]) throw new Error('TierNotOpen');
    if (active[tier] !== 0n) throw new Error('TierAlreadyHasOpenPool');
    // Prompt v2 §B.6 / §A: the cooldown, then the keeper gate (open_pool.rs,
    // in the program's order). Keeper-only with no time-based exception since
    // the founder ruling of 2026-09-07 — audit O9b.
    const now = this.now();
    const nextOpenAt = nextOpen[tier];
    if (now < nextOpenAt) throw new Error('TierCoolingDown');
    if (this.opener !== cfg.keeper) throw new Error('NotKeeper');
    // The treasury policy gate (open_pool.rs): available = balance minus
    // refundable entries; after funding this pot the remainder must cover
    // the minimum plus one further pot of every OTHER enabled idle tier.
    //
    // The RENT CUSHION (2026-09-12): `open_pool` funds pot PLUS
    // `vault::rent_floor()` and counts both in `needed`, and every reserved
    // pot in the idle-tier term carries one too. This fake is what the
    // rehearsal and every daemon spec run against, so a gate here that
    // forgets the cushion makes an open look legal that the program
    // refuses — and the fake's own treasury would drift a cushion richer
    // than the real one with every pool. `idleTierReserve` is imported
    // rather than re-implemented for exactly that reason: three copies of
    // this arithmetic is how the cushion came to be missing from two of
    // them.
    const pot = cfg.tierPotLamports[tier];
    const cushion = this.vaultCushionLamports;
    const available = this.platform - this.refundable;
    const needed =
      pot +
      cushion +
      cfg.treasuryMinPlatformLamports +
      idleTierReserve(await this.getConfig(), { tier, mode }, cushion);
    if (available < needed) throw new Error('TreasuryShortfall');
    // Fund the pot AND the cushion: treasury → the pool's prize vault,
    // before any entry. Only the pot is `reserved` — the cushion is not
    // part of the prize and never returns to the treasury.
    this.platform -= pot + cushion;
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
      // Recorded at open, never rewritten (state.rs `Pool.mode`).
      mode,
    });
    this.entries.set(poolId.toString(), []);
    this.openedWith.set(poolId.toString(), {
      publicKey: sealingPubkey.slice(),
      secretHash: sealingSecretHash.slice(),
    });
    cfg.nextPoolId += 1n;
    active[tier] = poolId;
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

  /** `slot.rs::free_tier_slot`: clear the pool's OWN ladder's slot (its
   * recorded mode decides — an easy pool can never free the hard slot) and
   * stamp that ladder's cooldown. */
  private clearActiveSlot(poolId: bigint, tier: number, mode: number): void {
    if (!this.config) return;
    const active = mode === 1 ? this.config.hardActivePoolByTier : this.config.activePoolByTier;
    const nextOpen = mode === 1 ? this.config.hardTierNextOpenAt : this.config.tierNextOpenAt;
    if (active[tier] === poolId) {
      active[tier] = 0n;
      nextOpen[tier] = this.now() + this.config.cooldownSeconds;
    }
  }
}
