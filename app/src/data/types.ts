/*
 * The app's read-side data model — the JSON the indexer read API serves
 * (backend/indexer/src/read-api.ts) and the pages render. Lamport amounts
 * are DECIMAL STRINGS end-to-end; nothing here ever holds one in a float.
 */

export interface PoolSummary {
  pool: string; // Pool PDA, base58
  id: string;
  tier: number;
  entry_lamports: string;
  /** The pool's FIXED pot (D-A1 revised), from `PoolOpened.pot_lamports`. */
  pot_lamports: string;
  /** The moment entries close, unix seconds, decimal string: set once at
   * open (12 h at launch — `Config.fill_deadline_seconds`), never rewritten
   * (option A, 2026-09-07). The one clock to show. */
  fill_deadline: string;
  timer_seconds: number;
  state: 'Open' | 'Sealed' | 'Scored' | 'Paid' | 'Refunding' | 'Closed';
  /** Hex, 32 bytes — the X25519 key entries seal to (from PoolOpened). */
  sealing_pubkey: string;
  entrants: number;
  /** The floor this pool plays at (R7-b). Below it at the deadline, every
   * entry refunds in full; at or above, the pool seals and plays. */
  min_seats: number;
  /** What the deadline would do RIGHT NOW, derived by the read API from the
   * seat count and the floor. The page shows a live countdown beside an
   * entrant count, and a player should not have to know the rule and do the
   * comparison themselves. */
  outcome_if_deadline_now: 'seal' | 'refund';
  results_root: string | null;
  secret: string | null;
  /**
   * Phase 2 Stage C — RESOLVING, derived by the read API rather than stored
   * on-chain: `held_shares` is the count of escrowed payouts whose entry has
   * not settled either way; `resolving` is true while at least one is held
   * AND the published review window (12 hours from the indexer's sight of
   * `PrizesPaid`) has not passed; `resolving_until` is that window's end,
   * unix seconds as a decimal string, null for a pool that never settled.
   * A pool with no held share is never resolving.
   */
  held_shares: number;
  resolving: boolean;
  resolving_until: string | null;
  /** The read API's clock at response time (unix seconds, decimal string).
   * Every countdown derives "now" from THIS plus an offset captured once,
   * never from the device's clock. */
  server_time: string;
  /**
   * Phase B (2026-09-24): the placing rule this pool was opened under —
   * `Pool.mode` on chain, `pools.mode` in the indexer. OPTIONAL because the
   * app must stay safe against a read API from before the backend change:
   * absent means easy, which is what every pool before Phase B played.
   * Read it through `poolMode()` (data/format.ts), never by hand.
   */
  mode?: 'easy' | 'hard';
}

/** The hard ladder's row at one tier (Phase B): its own switch and stamp. */
export interface HardTierStatus {
  enabled: boolean;
  status: 'open' | 'closed';
  next_open_at: string;
  last_pool_id: string | null;
}

/** One tier's enablement and cooldown stamp, from GET /tiers. One row per
 * CONFIGURED tier, whether or not it has ever run a pool. */
export interface TierStatusRow {
  tier: number;
  /** The founder's `Config.open_tiers[tier]` — whether a pool may be opened
   * in this tier at all (roadmap R6/D1). Nothing in the app may decide this
   * for itself; see `enablement_source`. */
  enabled: boolean;
  status: 'open' | 'closed';
  /** Unix seconds, decimal string; the tier's next pool may open from here.
   * '0' for a tier that has never settled a pool. */
  next_open_at: string;
  last_pool_id: string | null;
  /**
   * Phase B: the HARD ladder at this tier. Optional for the same reason as
   * `PoolSummary.mode` — a read API from before the backend change serves
   * no `hard`, and that reads as "no hard tier is open", which is true of
   * it. The landing decides from `hard.enabled` alone whether a hard card
   * exists (Phase B plan, decision 3): there is no switch in the app.
   */
  hard?: HardTierStatus;
}

export interface TiersResponse {
  server_time: string;
  /** Where `enabled` came from: the live Config account, the event ledger,
   * or `init_config`'s seeded posture when the founder has never sent
   * `set_open_tiers`. Published so a stale answer is visible. */
  enablement_source: 'chain' | 'ledger' | 'launch_default';
  /** The hard ladder's source, by the same three-way rule (Phase B). */
  hard_enablement_source?: 'chain' | 'ledger' | 'launch_default';
  tiers: TierStatusRow[];
}

export interface EntryRow {
  pool: string;
  player: string;
  idx: number;
  class: number;
  battles_hash: string;
  flagged: boolean;
  refunded: boolean;
  escrow_settled: 'released' | 'forfeited' | null;
}

/**
 * One row of the committed payout list (D3-B), keyed by seat. Rank labels
 * are not served by the indexer — they live in the published bundle, and
 * the verify page recomputes them.
 */
export interface ResultRow {
  seat: number;
  amount: string;
}

export interface PayoutRow {
  seat: number;
  player: string;
  amount: string;
  escrowed: boolean;
}

export interface ProfileRow {
  player: string;
  pools_entered: string;
  seats_paid: string;
  total_won_lamports: string;
  /** Class collection in fixed class order (Goblin..Titan). */
  class_counts: [number, number, number, number, number];
}

/** One career entry (D3), from GET /profiles/:player/history. */
export interface CareerRow {
  pool: string;
  pool_id: string | null;
  tier: number | null;
  seat: number | null;
  entries_to_date: string;
  paid: boolean;
  amount_lamports: string;
  pot_lamports: string | null;
  state: PoolSummary['state'] | null;
  /**
   * E3: nullable, and sourced ONLY from the verified archive — null until
   * the pool's published bundle recomputed to the on-chain root. Absent on
   * rows served by a pre-E3 indexer, hence optional.
   */
  rank?: number | null;
}

/**
 * One row of a pool's archive ranking (E3), in the shape the read API serves
 * under D-E8 (founder ruling, 2026-09-12).
 *
 * The on-chain results root commits to a leaf of `player ‖ rank ‖ amount` and
 * to NOTHING else. Those three fields are the only ones a player can hold the
 * chain to, so they are the only ones this type may present as committed;
 * every other field says where it actually came from. `committed_fields` on
 * the response names the same set on the wire.
 */
export interface LeaderboardRow {
  /** COMMITTED — in the results-root leaf. Base58 wallet. */
  player: string;
  /** COMMITTED — in the results-root leaf. Rank 1 is the paid place. */
  rank: number;
  /** COMMITTED — in the results-root leaf. Decimal string, never a float. */
  amount_lamports: string;
  /**
   * NOT COMMITTED. The player's entry number, read from our OWN indexed
   * records of the chain rather than from the uploaded file — null when
   * those records hold no entry row for this player, which happens if an
   * entry event was missed. Null and never 0: a reader has to be able to
   * tell entry number zero from an entry number we do not have.
   */
  seat: number | null;
  /**
   * NOT COMMITTED. Recomputed from the published entries, never proven by
   * the chain — the Verify page derives the identical numbers from the
   * identical published data, and so can any player. Always present.
   */
  recomputed: {
    /** Battle score in HALF-POINT integer units (a drawn battle is 1). */
    score_half: number;
    zones: number;
  };
}

/**
 * GET /pools/:pool/leaderboard — served only when the published bundle
 * recomputed to the on-chain results_root; the provenance rides along so
 * the page can link to the published data itself.
 */
export interface PoolLeaderboard {
  pool: string;
  /** Where the bundle lives (the player can fetch the same bytes). */
  uri: string;
  /** The locally recomputed root, hex — equals the on-chain commitment. */
  results_root: string;
  verified_at: string;
  /**
   * D-E8: the leaf fields that root actually commits to, named by the API
   * instead of assumed by the client. This is the authoritative list —
   * `COPY.results.archive.provenance` states the same split in words for the
   * reader and has to be re-read against this if the leaf ever changes.
   */
  committed_fields: Array<'player' | 'rank' | 'amount_lamports'>;
  /** Rank ascending. */
  rows: LeaderboardRow[];
}

/*
 * Gone on 2026-09-16 (the founder's data-minimisation ruling of 2026-09-15):
 * `RivalRow` and `getRivals` (the profile's co-entrant graph, which nothing
 * in scoring, payment or verification needed) and `SealedEntryRow` and
 * `getSealedEntries` (the sealed boxes, which have no public reader — the
 * what-beat-you view reads the published bundle instead).
 */

/** The tier rows of GET /treasury the app renders (D3 fixture list). The
 * full TreasuryReport carries more; the app reads only what it shows. */
export interface TreasuryTierStatus {
  tier: number;
  price_lamports: string;
  pot_lamports: string;
  status: 'open' | 'settling' | 'openable' | 'short';
  live_pool_state: string | null;
  short_by_lamports: string;
}

export interface TreasuryTiers {
  tiers: TreasuryTierStatus[];
}

export interface IndexerApi {
  listPools(): Promise<PoolSummary[]>;
  getPool(pool: string): Promise<PoolSummary | null>;
  getEntries(pool: string): Promise<EntryRow[]>;
  getResults(pool: string): Promise<ResultRow[]>;
  getPayouts(pool: string): Promise<PayoutRow[]>;
  getProfile(player: string): Promise<ProfileRow | null>;
  /** D3 additions. */
  getCareer(player: string): Promise<CareerRow[]>;
  getTreasury(): Promise<TreasuryTiers | null>;
  /** GET /tiers — the per-tier cooldown stamps plus the server's clock. */
  getTiers(): Promise<TiersResponse | null>;
  /** E3: null when the pool has no VERIFIED archive (fail-closed 404). */
  getLeaderboard(pool: string): Promise<PoolLeaderboard | null>;
}
