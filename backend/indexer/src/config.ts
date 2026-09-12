/**
 * Indexer config — built on the shared `loadPostgresConfig` + env helpers. No operational
 * literal is baked into logic: the Helius webhook secret, RPC URL, program ID, commitment, and
 * port are all read and validated here (fail-closed for the secret).
 *
 * The webhook secret is loaded lazily (`requireWebhookSecret`) so `migrate` and `backfill` — which
 * don't serve the webhook — run without it set.
 */
import {
  loadPostgresConfig,
  optional,
  parsePositiveInt,
  required,
  type PostgresConfig,
} from './shared';
import { PUBLIC_DEVNET_RPC_URL, resolveRpcUrl } from '../../_shared/src/cluster';

/** Default program ID — the `declare_id!` in programs/blotto_cup/src/lib.rs. Overridable per env.
 * C12 fix: this had drifted from the program's actual declared id. */
export const DEFAULT_PROGRAM_ID = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
/** The devnet fallback; the endpoint itself follows BLOTTO_CLUSTER (_shared/src/cluster.ts). */
export const DEFAULT_RPC_URL = PUBLIC_DEVNET_RPC_URL;

export const INDEXER_ENV = {
  webhookSecret: 'BLOTTO_HELIUS_WEBHOOK_SECRET',
  rpcUrl: 'BLOTTO_RPC_URL',
  programId: 'BLOTTO_PROGRAM_ID',
  commitment: 'BLOTTO_INDEXER_COMMITMENT',
  port: 'BLOTTO_INDEXER_PORT',
  readApiPort: 'BLOTTO_READ_API_PORT',
  irysUploadAddress: 'BLOTTO_IRYS_UPLOAD_ADDRESS',
} as const;

/** Commitment the indexer ingests at. Default `finalized` — see the README reorg note. */
export type Commitment = 'finalized' | 'confirmed';

export interface IndexerConfig {
  postgres: PostgresConfig;
  rpcUrl: string;
  programId: string;
  commitment: Commitment;
  webhookPort: number;
  /** E5: the public read API's port (`serve` runs both servers). */
  readApiPort: number;
  /**
   * The address the daemon uploads published bundles from (audit
   * 2026-09-11, C-25). Only the archive backfill's LAST-RESORT gateway
   * query uses it, to ask for our own uploads rather than for anything
   * carrying our tags; unset, that query is skipped rather than widened.
   * The normal path reads the daemon's own `published_bundles` row and
   * needs nothing here.
   */
  irysUploadAddress: string | null;
}

function parseCommitment(raw: string): Commitment {
  if (raw === 'finalized' || raw === 'confirmed') {
    return raw;
  }
  throw new Error(
    `${INDEXER_ENV.commitment} must be "finalized" or "confirmed"; got "${raw}"`
  );
}

export function loadIndexerConfig(
  env: NodeJS.ProcessEnv = process.env
): IndexerConfig {
  return {
    postgres: loadPostgresConfig(env),
    rpcUrl: resolveRpcUrl({ BLOTTO_CLUSTER: env.BLOTTO_CLUSTER, BLOTTO_RPC_URL: env.BLOTTO_RPC_URL }),
    programId: optional(env, INDEXER_ENV.programId, DEFAULT_PROGRAM_ID),
    commitment: parseCommitment(optional(env, INDEXER_ENV.commitment, 'finalized')),
    webhookPort: parsePositiveInt(env, INDEXER_ENV.port, 8080),
    readApiPort: parsePositiveInt(env, INDEXER_ENV.readApiPort, 8081),
    irysUploadAddress: optional(env, INDEXER_ENV.irysUploadAddress, '').trim() || null,
  };
}

/** The Helius webhook shared secret — required (fail-closed) only when serving the webhook. */
export function requireWebhookSecret(
  env: NodeJS.ProcessEnv = process.env
): string {
  return required(env, INDEXER_ENV.webhookSecret);
}
