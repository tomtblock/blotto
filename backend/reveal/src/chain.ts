/**
 * The crank's on-chain seam. `SettlementChain` is everything 2.4 needs from
 * the cluster; `FakeChain` mirrors the program's state machine for offline
 * tests; `Web3Chain` (chain-web3.ts) is the real client the devnet
 * rehearsal drives.
 */

import {
  DEFAULT_COOLDOWN_SECS,
  DEFAULT_FILL_DEADLINE_SECS,
  MAX_CAPACITY,
  MAX_PAID_PLACES,
  MIN_FIELD_BY_CAPACITY,
  POOL_CAPACITIES,
  TIER_ENTRY_LAMPORTS,
  ladderTable,
  leafBytes,
  prizePoolFor,
  verifyProof,
  type ProofStep,
} from '../../scoring/src';
import { base58Decode } from '../../_shared/src/blotto-events';
import type { PoolTypeView } from '../../_shared/src/pool-type-account';
// Imported, not re-implemented: the fake's open gate and the keeper's
// decision must be the same arithmetic or the parity suite proves nothing.
// Type-only in the other direction, so this is not a runtime cycle.
import { idlePoolTypeReserve, openTiersFor, poolTypeKey, tableValue } from './treasury';

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
  /** The FIXED prize pool (D-A1 revised; per pool type since D-E19), copied
   * from the pool's `PoolType` at open and funded into the prize vault
   * before any pass is sold. Settlement reads THIS — never a launch table,
   * which the founder can change between pools. */
  potLamports: bigint;
  /** The moment entries close: open time + `Config.fill_deadline_seconds`
   * (12 h at launch), set ONCE and never rewritten (option A, founder ruling
   * 2026-09-07 — the go-timer that shortened it is gone). Past it, a pool
   * holding at least its own `minSeats` seals and plays; one below refunds. */
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
  // ---- The Ladder (D-E19): copied from the pool's `PoolType` at open and
  // never rewritten. A pre-Ladder account (850/849 bytes, before
  // `migrate_pool`) reads as what its players entered under — 64 seats, one
  // place worth the whole prize pool (`decodePoolHead`, `preLadderTable`).
  /** 8, 16, 32 or 64. `register` seals at it; `seal_at_deadline` refuses at it. */
  capacity: number;
  /** The pool's OWN minimum field (R7-b, per pool since D-E19): at its
   * deadline a pool at or above it seals and plays, below it refunds. Never
   * a global — the daemon and both instructions read this. */
  minSeats: number;
  /** Places paid (`capacity / 4` for a Ladder pool; 1 for a pre-Ladder one).
   * Above 1, `pay_next_place` refuses (`NextPlaceUnsupported`). */
  paidPlaces: number;
  /** The raw on-chain `[u8; 16]` table: whole multiples of `entryLamports`,
   * rank 1 first, zero-padded. Read through `prizeTableFromChain`. */
  prizeTable: number[];
}

/**
 * One `PoolType` account (D-E19): a (mode, tier, capacity) combination with
 * its published economics and its one-pool-at-a-time slot. The decoded
 * account (`_shared/src/pool-type-account.ts`) plus its address — the address
 * is what `open_pool`'s remaining accounts are sorted by.
 */
export interface ChainPoolTypeView extends Omit<PoolTypeView, 'bump'> {
  /** Base58 PDA (Web3Chain) — `ptype:<mode>:<tier>:<capacity>` in FakeChain,
   * which never derives a real key. */
  address: string;
}

/** What the daemon reads from `Config` each tick. */
export interface ChainConfigView {
  paused: boolean;
  /** R6/D1 switchboard: which tiers may open EASY pools. Still read by
   * `open_pool` since D-E19 — a pool type opens only where its tier is open
   * for its mode AND the type is enabled. */
  openTiers: boolean[];
  /** The id `open_pool` must be called with next (gapless, monotonic). */
  nextPoolId: bigint;
  /** Per-tier entry price (founder-changeable via `set_tier_economics`,
   * never touching an open pool). A price change makes every pool type of
   * the tier STALE until its economics are restated (`PoolTypeEconomicsStale`). */
  tierPriceLamports: bigint[];
  /** Treasury policy: `reserve_pots` further prize pools per idle enabled
   * pool type on an open tier, plus a minimum balance, held back from
   * withdrawals and required at open. */
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
  /** `Config.cooldown_seconds` — stamped into the POOL TYPE's
   * `next_open_at` when its slot frees (D-E19). */
  cooldownSeconds: bigint;
  /**
   * Phase B (2026-09-24): the HARD ladder's tier switch
   * (`set_hard_open_tiers`). False everywhere on a pre-Phase-B account
   * (`hardLadderPresent` false), which is exact: a program with no hard
   * ladder has no open hard tier.
   *
   * Config's per-(mode, tier) slots, cooldown clocks and tier pots are NOT
   * in this view since D-E19: `open_pool` no longer reads them, and a view
   * that carried them would invite a reader to trust a slot nothing
   * maintains. Each `PoolType` carries its own (`getPoolTypes`).
   */
  hardLadderPresent: boolean;
  hardOpenTiers: boolean[];
  /** The Ladder (D-E19): true once `migrate_config` has grown the account
   * to 605 bytes. */
  ladderPresent: boolean;
  /** How many `PoolType` accounts are enabled — the count `open_pool`'s
   * remaining accounts must match (minus the type being opened). */
  enabledPoolTypes: number;
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
  /** `seal_at_deadline` (D-E4): an Open pool past its deadline holding at
   * least its OWN minimum field (`Pool.min_seats`) and fewer than its
   * capacity seals and plays. Permissionless on-chain — the settlement
   * signer merely pays the fee; the seal is a function of state and time. */
  sealAtDeadline(poolId: bigint): Promise<void>;
  /** `trigger_refund` (R7 as amended by D-E4): an Open pool past its
   * deadline BELOW its own minimum field refunds. Frees the pool TYPE's slot
   * when the pool closes empty (D-E19). */
  triggerRefund(poolId: bigint): Promise<void>;
  /** `refund`: one entry's full price back from the treasury; the last one
   * closes the pool and frees its pool type's slot. */
  refund(poolId: bigint, player: string): Promise<void>;
}

/** Everything the daemon (C8) needs beyond settlement: reading `Config` and
 * the pool types, and driving the pool-launch instructions. The program's own
 * guards (gapless ids, one Open pool per POOL TYPE, write-once VRF seed,
 * write-once collection) are what make a concurrent second daemon safe —
 * implementations surface those rejections as thrown errors, never by
 * silently succeeding. */
export interface KeeperChain extends SettlementChain {
  getConfig(): Promise<ChainConfigView>;
  /** Every `PoolType` account (D-E19), enabled or not, ordered by (mode,
   * tier, capacity). Each carries its own slot (`activePool`), cooldown
   * (`nextOpenAt`), table, minimum field and prize pool. */
  getPoolTypes(): Promise<ChainPoolTypeView[]>;
  /** `open_pool`: KEEPER-signed (prompt v2 §A — `Config.keeper` and nobody
   * else since 2026-09-07); `poolId` must equal `nextPoolId`. Since D-E19 it
   * opens one POOL TYPE — (mode, tier, capacity) — whose slot is free, whose
   * cooldown has passed and whose economics are current; the pool copies the
   * type's capacity, minimum field and table. `mode` (Phase B) picks the
   * placing rule: 0 easy, 1 hard. The implementation supplies the
   * remaining accounts the treasury reserve needs (every OTHER enabled pool
   * type, ascending by address). */
  openPool(
    poolId: bigint,
    tier: number,
    sealingPubkey: Uint8Array,
    sealingSecretHash: Uint8Array,
    mode: number,
    capacity: number
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
 *
 * Since the Ladder (D-E19) it also holds the `PoolType` accounts and
 * enforces what the program does with them: a pool seals at ITS capacity,
 * a deadline seals at ITS minimum field and refunds below it, a commit is
 * bounded by ITS first prize, pay / refund free ITS type's slot and stamp
 * that type's cooldown (and need that type's account to exist at all),
 * `pay_next_place` refuses a multi-place pool, and `open_pool` refuses a
 * disabled type, a closed tier, a busy or cooling type, stale economics,
 * and a treasury short of the reserve over every OTHER enabled type.
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
  /**
   * The `PoolType` accounts (D-E19), keyed `mode:tier:capacity`
   * (`poolTypeKey`). Created by `initPoolType` (admin), given economics by
   * `setPoolTypeEconomics`, switched by `setPoolTypeEnabled` — test setup,
   * each with the program's own refusals. `addPoolType` does all three with
   * the published launch table.
   */
  poolTypes = new Map<string, ChainPoolTypeView>();
  /** `Config.tier_pot_lamports`: the 64-player reference figure
   * `set_tier_economics` still records and nothing reads since D-E19. */
  private tierPotLamports: bigint[] = [];
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
   * program's post-entry transition (the seal at the pool's capacity). */
  registerEntry(poolId: bigint, entry: FakeEntry): void {
    const p = this.pools.get(poolId.toString());
    if (!p) throw new Error(`no pool ${poolId}`);
    if (p.state !== 'Open') throw new Error('PoolNotOpen');
    if (this.now() > p.fillDeadline) throw new Error('DeadlinePassed');
    // D-E19: the pool's OWN capacity (register.rs), never the 64 maximum.
    if (p.entrants >= p.capacity) throw new Error('PoolFull');
    const key = poolId.toString();
    const list = this.entries.get(key) ?? [];
    list.push(entry);
    this.entries.set(key, list);
    p.entrants = list.length;
    this.platform += p.entryLamports;
    this.refundableByPool.set(key, (this.refundableByPool.get(key) ?? 0n) + p.entryLamports);
    this.applyEntryTransitions(poolId);
  }

  /** `register`'s post-entry transition, mirrored: at the pool's OWN
   * capacity (8, 16, 32 or 64 — D-E19) the pool seals. Nothing happens at
   * the minimum field (option A — the deadline, set once at open, decides;
   * the go-timer is gone). Public so test helpers that push entries directly
   * can apply the same transition the program would. */
  applyEntryTransitions(poolId: bigint): void {
    const p = this.pools.get(poolId.toString());
    if (!p) throw new Error(`no pool ${poolId}`);
    if (p.state !== 'Open') return;
    p.entrants = this.entries.get(poolId.toString())?.length ?? p.entrants;
    if (p.entrants >= p.capacity) this.sealPool(poolId);
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
    // The program's checks (reveal_commit.rs), mirrored in its order —
    // including D-E19 §7.6's cheap bounds: no zero payout, and no seat owed
    // more than first place under THIS pool's table (`Pool::first_prize`).
    if (payouts.length === 0 || BigInt(payouts.length) > MAX_CAPACITY) {
      throw new Error('PayoutListMalformed');
    }
    const firstPrize = BigInt(p.prizeTable[0] ?? 0) * p.entryLamports;
    let total = 0n;
    payouts.forEach((x, i) => {
      if (x.entryIndex >= p.entrants) throw new Error('PayoutListMalformed');
      if (x.amountLamports <= 0n) throw new Error('PayoutZero');
      if (x.amountLamports > firstPrize) throw new Error('PayoutAboveFirstPrize');
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
    // `PayPrizes` names the pool's OWN pool type (D-E19) — an account that
    // must exist for the instruction to assemble at all.
    const poolType = this.requirePoolTypeOf(p);
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
      // Sequential pools (D-A1 revised): Paid frees the POOL TYPE's slot
      // (D-E19) and releases the pot from the treasury's book-keeping.
      this.reserved -= p.potLamports;
      this.freePoolTypeSlot(poolType, poolId);
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
    // D-E19: "the committed payout list IS the tied first-place group" holds
    // only for a pool paying ONE place. A Ladder pool's forfeited share is
    // HELD in its vault until the "field moves up" payout ships.
    if (p.paidPlaces > 1) throw new Error('NextPlaceUnsupported');
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
    // The program's four guards (seal.rs), mirrored in order — the floor
    // and the ceiling are the POOL's own (R7-b, D-E19), never constants.
    if (p.state !== 'Open') throw new Error('PoolNotOpen');
    if (!(this.now() > p.fillDeadline)) throw new Error('DeadlineNotPassed');
    if (p.entrants < p.minSeats) throw new Error('FieldBelowMinimum');
    if (p.entrants >= p.capacity) throw new Error('PoolFull');
    this.sealPool(poolId);
  }

  async triggerRefund(poolId: bigint): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    const poolType = this.requirePoolTypeOf(p);
    // The program's three guards (refund.rs), mirrored in order — the
    // deadline is STRICTLY past, exactly as `Clock` is compared on-chain,
    // and the floor is the pool's OWN (the mirror of `seal_at_deadline`).
    if (p.state !== 'Open') throw new Error('PoolNotOpen');
    if (!(this.now() > p.fillDeadline)) throw new Error('DeadlineNotPassed');
    if (p.entrants >= p.minSeats) throw new Error('FieldReached');
    p.state = p.entrants === 0 ? 'Closed' : 'Refunding';
    // The untouched pot returns to the treasury (refund.rs).
    this.platform += p.potLamports;
    this.reserved -= p.potLamports;
    // Sequential pools: the slot frees only when the pool CLOSES.
    if (p.state === 'Closed') this.freePoolTypeSlot(poolType, poolId);
  }

  async refund(poolId: bigint, player: string): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    const poolType = this.requirePoolTypeOf(p);
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
      this.freePoolTypeSlot(poolType, poolId);
    }
  }

  // ---- KeeperChain (C8) — the launch instructions, guards mirrored --------

  async getConfig(): Promise<ChainConfigView> {
    if (!this.config) throw new Error('config account not found');
    return {
      ...this.config,
      openTiers: [...this.config.openTiers],
      tierPriceLamports: [...this.config.tierPriceLamports],
      hardOpenTiers: [...this.config.hardOpenTiers],
      platformReserved: this.reserved,
      platformRefundable: this.refundable,
    };
  }

  /** `KeeperChain.getPoolTypes`: copies, ordered by (mode, tier, capacity). */
  async getPoolTypes(): Promise<ChainPoolTypeView[]> {
    return [...this.poolTypes.values()]
      .map((t) => ({ ...t, prizeTable: [...t.prizeTable] }))
      .sort((a, b) => a.mode - b.mode || a.tier - b.tier || a.capacity - b.capacity);
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
    // Launch policy baked into the handler (admin.rs): only tier 0 open,
    // ids from 1, prices from the launch table, reserve_pots = 1, the
    // 2026-09-07 timings at their defaults, and NO pool type — each is
    // created, priced and enabled by its own admin instruction (D-E19).
    this.config = {
      paused: false,
      openTiers: [true, false, false, false, false, false, false],
      nextPoolId: 1n,
      tierPriceLamports: [...TIER_ENTRY_LAMPORTS],
      treasuryReservePots: 1,
      treasuryMinPlatformLamports: args.treasuryMinPlatformLamports,
      platformReserved: 0n,
      platformRefundable: 0n,
      keeper: args.keeper,
      fillDeadlineSeconds: DEFAULT_FILL_DEADLINE_SECS,
      cooldownSeconds: DEFAULT_COOLDOWN_SECS,
      // Phase B: the hard ladder starts fully disabled (admin.rs), like the
      // program's `init_config`.
      hardLadderPresent: true,
      hardOpenTiers: [false, false, false, false, false, false, false],
      ladderPresent: true,
      enabledPoolTypes: 0,
    };
  }

  /** The admin's `set_open_tiers` (R6): the easy ladder's tier switch. */
  setOpenTiers(openTiers: boolean[]): void {
    if (!this.config) throw new Error('config account not found');
    this.config.openTiers = [...openTiers];
  }

  /** The admin's `set_hard_open_tiers` (Phase B): the hard ladder's switch.
   * (The program still restamps Config's per-tier clock on the enable edge;
   * nothing reads that clock since D-E19, so the fake does not keep it.) */
  setHardOpenTiers(openTiers: boolean[]): void {
    if (!this.config) throw new Error('config account not found');
    this.config.hardOpenTiers = [...openTiers];
  }

  /**
   * `set_tier_economics` (admin, treasury.rs): one tier's price and its
   * 64-player reference pot. Never touches an open pool. A PRICE change
   * makes every pool type of the tier stale — `openPool` then refuses it
   * (`PoolTypeEconomicsStale`) until `setPoolTypeEconomics` restates it.
   */
  setTierEconomics(tier: number, priceLamports: bigint, potLamports: bigint): void {
    const cfg = this.config;
    if (!cfg) throw new Error('config account not found');
    if (!Number.isInteger(tier) || tier < 0 || tier >= cfg.tierPriceLamports.length) {
      throw new Error('UnknownTier');
    }
    if (priceLamports <= 0n || potLamports <= 0n) throw new Error('ZeroAmount');
    // No larger than the 64-player pool's minimum field's entries.
    if (potLamports > BigInt(MIN_FIELD_BY_CAPACITY[64]) * priceLamports) {
      throw new Error('PotExceedsMinimumField');
    }
    cfg.tierPriceLamports[tier] = priceLamports;
    this.tierPotLamports[tier] = potLamports;
  }

  // ---- Pool types (D-E19, pool_type.rs) — admin instructions, test setup --

  /** `check_coordinates` (pool_type.rs): refused by name, before any read. */
  private static checkCoordinates(mode: number, tier: number, capacity: number): void {
    if (mode !== 0 && mode !== 1) throw new Error('UnknownMode');
    if (!Number.isInteger(tier) || tier < 0 || tier >= 7) throw new Error('UnknownTier');
    if (!(POOL_CAPACITIES as readonly number[]).includes(capacity)) {
      throw new Error('UnknownCapacity');
    }
  }

  private poolTypeAt(mode: number, tier: number, capacity: number): ChainPoolTypeView {
    const t = this.poolTypes.get(poolTypeKey({ mode, tier, capacity }));
    // Anchor's answer to an account that was never created at the PDA.
    if (!t) throw new Error('AccountNotInitialized');
    return t;
  }

  /** The pool type a pool's settlement instructions name (`pay_prizes`,
   * `trigger_refund`, `refund` derive it from the POOL's own mode, tier and
   * capacity). It must exist or the instruction cannot assemble. */
  private requirePoolTypeOf(p: ChainPoolView): ChainPoolTypeView {
    return this.poolTypeAt(p.mode, p.tier, p.capacity);
  }

  /** `init_pool_type` (admin): created disabled, with no table. */
  initPoolType(mode: number, tier: number, capacity: number): void {
    if (!this.config) throw new Error('config account not found');
    FakeChain.checkCoordinates(mode, tier, capacity);
    const key = poolTypeKey({ mode, tier, capacity });
    if (this.poolTypes.has(key)) throw new Error('already in use'); // Anchor `init`
    this.poolTypes.set(key, {
      address: `ptype:${key}`,
      mode,
      tier,
      capacity,
      minSeats: 0,
      paidPlaces: 0,
      prizeTable: new Array<number>(MAX_PAID_PLACES).fill(0),
      potLamports: 0n,
      enabled: false,
      activePool: 0n,
      nextOpenAt: 0n,
    });
  }

  /**
   * `set_pool_type_economics` (admin) with the program's four refusals: the
   * table pays exactly the top quarter, never increases and holds no zero
   * inside its paid places (`PrizeTableMalformed`); the minimum field
   * exceeds the places paid and fits the capacity (`MinimumFieldInvalid`);
   * Σ table × the tier's CURRENT price equals the stated prize pool
   * (`PrizePoolMismatch`); the minimum field's entries cover it
   * (`PotExceedsMinimumField`). `prizeTable` is the raw 16-byte form.
   */
  setPoolTypeEconomics(
    mode: number,
    tier: number,
    capacity: number,
    minSeats: number,
    prizeTable: readonly number[],
    potLamports: bigint
  ): void {
    const cfg = this.config;
    if (!cfg) throw new Error('config account not found');
    FakeChain.checkCoordinates(mode, tier, capacity);
    const t = this.poolTypeAt(mode, tier, capacity);
    if (prizeTable.length !== MAX_PAID_PLACES) throw new Error('PrizeTableMalformed');
    const paid = capacity / 4;
    prizeTable.forEach((m, i) => {
      if (!Number.isInteger(m) || m < 0 || m > 255) throw new Error('PrizeTableMalformed');
      if (i < paid) {
        if (m === 0) throw new Error('PrizeTableMalformed');
        if (i > 0 && m > prizeTable[i - 1]) throw new Error('PrizeTableMalformed');
      } else if (m !== 0) {
        throw new Error('PrizeTableMalformed');
      }
    });
    if (!(minSeats > paid && minSeats <= capacity)) throw new Error('MinimumFieldInvalid');
    if (potLamports <= 0n) throw new Error('ZeroAmount');
    const price = cfg.tierPriceLamports[tier];
    if (price <= 0n) throw new Error('ZeroAmount');
    if (tableValue(prizeTable, price) !== potLamports) throw new Error('PrizePoolMismatch');
    if (potLamports > BigInt(minSeats) * price) throw new Error('PotExceedsMinimumField');
    t.minSeats = minSeats;
    t.paidPlaces = paid;
    t.prizeTable = [...prizeTable];
    t.potLamports = potLamports;
  }

  /** `set_pool_type_enabled` (admin): enabling needs economics; the count on
   * Config moves only on an actual change of state. */
  setPoolTypeEnabled(mode: number, tier: number, capacity: number, enabled: boolean): void {
    const cfg = this.config;
    if (!cfg) throw new Error('config account not found');
    FakeChain.checkCoordinates(mode, tier, capacity);
    const t = this.poolTypeAt(mode, tier, capacity);
    if (enabled && !(t.paidPlaces > 0 && t.potLamports > 0n && t.minSeats > 0)) {
      throw new Error('PoolTypeEconomicsUnset');
    }
    if (enabled && !t.enabled) cfg.enabledPoolTypes += 1;
    else if (!enabled && t.enabled) cfg.enabledPoolTypes -= 1;
    t.enabled = enabled;
  }

  /**
   * TEST SETUP: create, price and enable one pool type with the PUBLISHED
   * launch economics (`LADDER_TABLES`, `MIN_FIELD_BY_CAPACITY`, the prize
   * pool at the tier's current price) — the three admin instructions the
   * devnet launch runs per type, each through its own refusals above.
   */
  addPoolType(mode: number, tier: number, capacity: number): ChainPoolTypeView {
    const cfg = this.config;
    if (!cfg) throw new Error('config account not found');
    const table = ladderTable(capacity);
    const raw = new Array<number>(MAX_PAID_PLACES).fill(0);
    table.forEach((m, i) => (raw[i] = m));
    this.initPoolType(mode, tier, capacity);
    this.setPoolTypeEconomics(
      mode,
      tier,
      capacity,
      MIN_FIELD_BY_CAPACITY[capacity as keyof typeof MIN_FIELD_BY_CAPACITY],
      raw,
      prizePoolFor(table, cfg.tierPriceLamports[tier])
    );
    this.setPoolTypeEnabled(mode, tier, capacity, true);
    return this.poolTypeAt(mode, tier, capacity);
  }

  /**
   * `open_pool` (open_pool.rs), its gates mirrored in the program's order:
   * the pool type must exist (Anchor assembles it from the seeds), then
   * gapless ids, the coordinates, the tier switch for the mode, the type's
   * own switch, its slot, its cooldown, the keeper, its economics (set, and
   * not stale at today's price), and the treasury policy over every OTHER
   * enabled pool type.
   */
  async openPool(
    poolId: bigint,
    tier: number,
    sealingPubkey: Uint8Array,
    sealingSecretHash: Uint8Array,
    mode: number,
    capacity: number
  ): Promise<void> {
    const cfg = this.config;
    if (!cfg) throw new Error('config account not found');
    const t = this.poolTypes.get(poolTypeKey({ mode, tier, capacity }));
    if (!t) throw new Error('AccountNotInitialized');
    if (poolId !== cfg.nextPoolId) throw new Error('WrongPoolId');
    if (tier < 0 || tier >= cfg.openTiers.length) throw new Error('UnknownTier');
    // Phase B: the mode is checked before any per-mode read (open_pool.rs).
    if (mode !== 0 && mode !== 1) throw new Error('UnknownMode');
    // R6: the tier switch for the mode, THEN the type's own (D-E19).
    if (!openTiersFor(cfg, mode)[tier]) throw new Error('TierNotOpen');
    if (!t.enabled) throw new Error('PoolTypeDisabled');
    // SEQUENTIAL pools per pool type.
    if (t.activePool !== 0n) throw new Error('TierAlreadyHasOpenPool');
    // Prompt v2 §B.6 / §A: the cooldown, then the keeper gate. Keeper-only
    // with no time-based exception since the founder ruling of 2026-09-07 —
    // audit O9b.
    const now = this.now();
    if (now < t.nextOpenAt) throw new Error('TierCoolingDown');
    if (this.opener !== cfg.keeper) throw new Error('NotKeeper');
    const entryLamports = cfg.tierPriceLamports[tier];
    const pot = t.potLamports;
    if (!(t.paidPlaces > 0 && pot > 0n)) throw new Error('PoolTypeEconomicsUnset');
    // D-E19: the stored prize pool must still be the table at TODAY's price.
    if (tableValue(t.prizeTable, entryLamports) !== pot) {
      throw new Error('PoolTypeEconomicsStale');
    }
    if (BigInt(t.capacity) > MAX_CAPACITY) throw new Error('UnknownCapacity');
    // The treasury policy gate (open_pool.rs): available = balance minus
    // refundable entries; after funding this prize pool the remainder must
    // cover the minimum plus `reserve_pots` further prize pools of every
    // OTHER enabled pool type with no live pool on an open tier.
    //
    // The RENT CUSHION (2026-09-12): `open_pool` funds pot PLUS
    // `vault::rent_floor()` and counts both in `needed`, and every reserved
    // prize pool in the idle term carries one too. This fake is what the
    // rehearsal and every daemon spec run against, so a gate here that
    // forgets the cushion makes an open look legal that the program
    // refuses. `idlePoolTypeReserve` is imported rather than re-implemented
    // for exactly that reason.
    const cushion = this.vaultCushionLamports;
    const available = this.platform - this.refundable;
    const needed =
      pot +
      cushion +
      cfg.treasuryMinPlatformLamports +
      idlePoolTypeReserve(await this.getConfig(), await this.getPoolTypes(), t, cushion);
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
      entryLamports,
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
      // D-E19: the size, floor and table, copied once from the type.
      capacity: t.capacity,
      minSeats: t.minSeats,
      paidPlaces: t.paidPlaces,
      prizeTable: [...t.prizeTable],
    });
    this.entries.set(poolId.toString(), []);
    this.openedWith.set(poolId.toString(), {
      publicKey: sealingPubkey.slice(),
      secretHash: sealingSecretHash.slice(),
    });
    cfg.nextPoolId += 1n;
    t.activePool = poolId;
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

  /** The seal itself — the filling `register`'s effect and
   * `seal_at_deadline`'s alike (the program's shared `seal_pool`): the pool
   * seals and its entries become revenue. The pool type's slot is NOT freed
   * here — SEQUENTIAL pools (D-A1 revised): only Paid or Closed clears it. */
  sealPool(poolId: bigint): void {
    const p = this.pools.get(poolId.toString())!;
    p.state = 'Sealed';
    p.entrants = this.entries.get(poolId.toString())?.length ?? p.entrants;
    this.refundableByPool.delete(poolId.toString());
  }

  /** `slot.rs::free_pool_type_slot`: clear the pool TYPE's slot if this pool
   * holds it, and stamp the type's cooldown. A no-op for a pool that does
   * not hold it (a pool opened before the Ladder, whose slot lived on
   * Config) — exactly as on-chain. */
  private freePoolTypeSlot(t: ChainPoolTypeView, poolId: bigint): void {
    if (!this.config || t.activePool !== poolId) return;
    t.activePool = 0n;
    t.nextOpenAt = this.now() + this.config.cooldownSeconds;
  }
}
