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
  fill_deadline: string; // unix seconds, decimal string
  timer_seconds: number;
  state: 'Open' | 'Sealed' | 'Scored' | 'Paid' | 'Refunding' | 'Closed';
  /** Hex, 32 bytes — the X25519 key entries seal to (from PoolOpened). */
  sealing_pubkey: string;
  entrants: number;
  results_root: string | null;
  secret: string | null;
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

/** One career entry (D3), from GET /profiles/:player/history. Rank labels
 * are deliberately absent (D3-B: ranks live in the published bundle). */
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
}

/** One rival (D3): a wallet often in the same pools, co-entry facts only. */
export interface RivalRow {
  player: string;
  pools_shared: string;
  paid_in_shared: string;
}

/** One sealed ciphertext (D3), seat-keyed and anonymised; served by the
 * read API only after the pool secret is on-chain. */
export interface SealedEntryRow {
  seat: number;
  ciphertext_hex: string;
}

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
  getRivals(player: string): Promise<RivalRow[]>;
  getSealedEntries(pool: string): Promise<SealedEntryRow[]>;
  getTreasury(): Promise<TreasuryTiers | null>;
}
