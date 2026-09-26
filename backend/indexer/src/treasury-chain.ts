/**
 * The treasury report's OPTIONAL chain read (audit D-18 / prior-audit O26).
 *
 * The events ledger cannot tell the report what the treasury policy is.
 * `init_config` writes `treasury_min_platform_lamports`, the two tier tables
 * and the launch tier enablement WITHOUT emitting a single event
 * (`programs/blotto_cup/src/instructions/admin.rs`), so a report assembled
 * from events alone shows a 0 minimum and the launch constants while the
 * live Config holds the founder's real numbers. Audit O26 measured the gap
 * on devnet: a floor of 0.1 SOL published where the program enforces 0.6,
 * and tier pots six values out of seven wrong.
 *
 * So the policy is read from the account that decides it. This module is the
 * read: `Config` (decoded by the shared layout module — `_shared/src/
 * config-account.ts`, the one TypeScript copy), the platform PDA's lamport
 * balance, and the per-vault rent cushion the program applies
 * (`getMinimumBalanceForRentExemption(0)` = `vault::rent_floor()`).
 *
 * IT IS OPTIONAL BY CONSTRUCTION. `GET /treasury` is public and
 * rate-limited, not authenticated; an RPC outage must degrade the report,
 * never fail the request. `treasuryReport` calls this inside a try and falls
 * back to the bounded ledger, and says which it used in `policy_source`.
 *
 * Every value is a bigint. Nothing here touches a float.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { resolveRpcUrl } from '../../_shared/src/cluster';
import { decodeConfigAccount } from '../../_shared/src/config-account';
import { DEFAULT_PROGRAM_ID, INDEXER_ENV } from './config';

/**
 * Everything the treasury report wants from the cluster, in one read. Field
 * for field, this is what the program's own floor is computed from
 * (`instructions/treasury.rs::handle_withdraw_platform`).
 */
export interface TreasuryChainView {
  /** `Config.treasury_min_platform_lamports`. */
  minPlatformLamports: bigint;
  /** `Config.treasury_reserve_pots`. */
  reservePots: bigint;
  /** `Config.tier_price_lamports` / `tier_pot_lamports`, live. */
  tierPriceLamports: readonly bigint[];
  tierPotLamports: readonly bigint[];
  /** `Config.open_tiers` — the enablement, without waiting for a
   * `TiersOpened` event that `init_config` never emits. */
  openTiers: readonly boolean[];
  /** `Config.hard_open_tiers` (Phase B) — the hard ladder's enablement;
   * all false on a pre-Phase-B account, which has no hard ladder. */
  hardOpenTiers: readonly boolean[];
  /** `Config.platform_refundable` — players' money in transit (R7). */
  platformRefundableLamports: bigint;
  /** The platform treasury PDA's lamports, as the chain holds them. */
  platformBalanceLamports: bigint;
  /** `vault::rent_floor()` — the rent-exempt minimum for a zero-data
   * account, which `open_pool` funds every prize vault with ON TOP of its
   * pot and `idle_tier_reserve` counts once per reserved pot. Read from the
   * cluster, never pinned: it is 890,880 under the standard rent parameters
   * and 650,240 on devnet. */
  vaultCushionLamports: bigint;
}

/** The seam the report depends on: one call, all of it, or it throws. */
export type TreasuryChainReader = () => Promise<TreasuryChainView>;

/**
 * How long one chain read is reused, in milliseconds.
 *
 * PHASE-A1-REVIEW: `GET /treasury` is rate-limited at 600 requests per
 * minute per client and the admin page fetches it with `cache: 'no-store'`,
 * so an uncached read would put ten RPC round trips a second behind an
 * unauthenticated route — the same shape of defect as B-18, moved from the
 * database to the cluster. Ten seconds bounds that at three reads a minute
 * while keeping the page honest: `Config` changes only when the founder
 * signs an admin instruction, and the cushion is a genesis-level parameter.
 * A FAILED read is cached for the same window, so an RPC outage costs one
 * attempt per window rather than one per request.
 */
export const CHAIN_READ_TTL_MS = 10_000;

interface CacheEntry {
  at: number;
  value: TreasuryChainView | null;
  error: unknown;
}

export interface TreasuryChainReaderOptions {
  /** Defaults to `process.env` — `BLOTTO_CLUSTER` / `BLOTTO_RPC_URL` /
   * `BLOTTO_PROGRAM_ID`, all already on the indexer's env checklist. */
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests; defaults to `Date.now`. */
  clock?: () => number;
  /** Injectable for tests; defaults to a real `Connection`. */
  connect?: (rpcUrl: string) => ChainConnection;
  ttlMs?: number;
  /** Where a failed read is reported. Defaults to `console.warn`; the read
   * API has no Monitor wired through it (that is `index.ts`'s call), and a
   * chain read that starts failing must not be invisible just because the
   * report keeps serving. */
  warn?: (message: string) => void;
}

/** The slice of `@solana/web3.js`'s `Connection` this module uses. */
export interface ChainConnection {
  getAccountInfo(
    address: PublicKey,
    commitment?: 'processed' | 'confirmed' | 'finalized'
  ): Promise<{ data: Uint8Array; lamports: number } | null>;
  getMinimumBalanceForRentExemption(dataLength: number): Promise<number>;
}

/**
 * Build the production reader. Construction is lazy and every failure —
 * a mainnet deployment with no endpoint configured, an unreachable RPC, a
 * pre-migration Config — comes back as a rejected promise for the report to
 * fall back from.
 */
export function web3TreasuryChainReader(
  options: TreasuryChainReaderOptions = {}
): TreasuryChainReader {
  const env = options.env ?? process.env;
  const clock = options.clock ?? Date.now;
  const ttlMs = options.ttlMs ?? CHAIN_READ_TTL_MS;
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const connect =
    options.connect ?? ((rpcUrl: string) => new Connection(rpcUrl, 'confirmed') as ChainConnection);

  let cache: CacheEntry | null = null;
  let connection: ChainConnection | null = null;
  let programId: PublicKey | null = null;

  return async function read(): Promise<TreasuryChainView> {
    const now = clock();
    if (cache && now - cache.at < ttlMs) {
      if (cache.value) return cache.value;
      throw cache.error;
    }
    try {
      if (!connection || !programId) {
        // Resolved on first use, not at import: a config error must reach
        // the caller as a failed read, not as a crash at module load.
        connection = connect(resolveRpcUrl(env));
        programId = new PublicKey(env[INDEXER_ENV.programId]?.trim() || DEFAULT_PROGRAM_ID);
      }
      const value = await readTreasuryChainView(connection, programId);
      cache = { at: now, value, error: null };
      return value;
    } catch (error) {
      cache = { at: now, value: null, error };
      warn(
        `treasury report: the chain read failed, serving ledger-derived policy ` +
          `(policy_source="ledger"): ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  };
}

/**
 * The read itself, given a connection and the program id. Exported so a test
 * can drive it with a fixture connection and no cache in the way.
 *
 * PDA seeds match `state.rs`: `[b"config"]` and `[b"platform"]`, distinct
 * prefixes per PDA type (`threat-tm-401`).
 */
export async function readTreasuryChainView(
  connection: ChainConnection,
  programId: PublicKey
): Promise<TreasuryChainView> {
  const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
  const platformPda = PublicKey.findProgramAddressSync([Buffer.from('platform')], programId)[0];

  const [configInfo, platformInfo, cushion] = await Promise.all([
    connection.getAccountInfo(configPda, 'confirmed'),
    connection.getAccountInfo(platformPda, 'confirmed'),
    connection.getMinimumBalanceForRentExemption(0),
  ]);
  if (!configInfo) throw new Error('config account not found');
  const config = decodeConfigAccount(configInfo.data);

  return {
    minPlatformLamports: config.treasuryMinPlatformLamports,
    reservePots: BigInt(config.treasuryReservePots),
    tierPriceLamports: config.tierPriceLamports,
    tierPotLamports: config.tierPotLamports,
    openTiers: config.openTiers,
    hardOpenTiers: config.hardOpenTiers,
    platformRefundableLamports: config.platformRefundable,
    // A platform PDA with no lamports is an unfunded treasury, not an error:
    // the account is a system-owned holder and only exists once funded.
    platformBalanceLamports: BigInt(platformInfo?.lamports ?? 0),
    vaultCushionLamports: BigInt(cushion),
  };
}

/**
 * The process-wide reader `GET /treasury` uses. One per process so the cache
 * and the connection are shared across requests; built on first call so
 * nothing is constructed in a command (`migrate`, `backfill`) that never
 * serves the route.
 */
let shared: TreasuryChainReader | null = null;

export function defaultTreasuryChainReader(): TreasuryChainReader {
  if (!shared) shared = web3TreasuryChainReader();
  return shared;
}
