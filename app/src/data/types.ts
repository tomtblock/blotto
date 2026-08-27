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

export interface ResultRow {
  rank: number;
  player: string;
}

export interface PayoutRow {
  rank: number;
  player: string;
  amount: string;
  escrowed: boolean;
}

export interface ProfileRow {
  player: string;
  pools_entered: string;
  ranks_paid: string;
  total_won_lamports: string;
  best_rank: number | null;
  /** Class collection in fixed class order (Goblin..Titan). */
  class_counts: [number, number, number, number, number];
}

export interface IndexerApi {
  listPools(): Promise<PoolSummary[]>;
  getPool(pool: string): Promise<PoolSummary | null>;
  getEntries(pool: string): Promise<EntryRow[]>;
  getResults(pool: string): Promise<ResultRow[]>;
  getPayouts(pool: string): Promise<PayoutRow[]>;
  getProfile(player: string): Promise<ProfileRow | null>;
}
