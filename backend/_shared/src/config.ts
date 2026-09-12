/**
 * Shared env/config loading for the Phase 9 services.
 *
 * Mirrors the `services/me-registration/src/config.ts` pattern (a single ENV map,
 * `required()` that fails closed, a strict default-FALSE `parseBool`) so all
 * off-chain services validate their environment the same way. The hard rule it
 * carries forward: no operational literal is baked into logic — it is read here,
 * typed, and validated at startup.
 *
 * Step 0 ships only the shared primitives + the Postgres connection block that
 * every service needs. Service-specific
 * config (Helius webhook auth, ME creds, Arweave keys) lands with each service.
 */

/** Strict, default-FALSE boolean: only "true"/"1"/"yes"/"on" (case-insensitive) is true. */
export function parseBool(raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/** Read a required env var; throw (fail closed) if missing or blank. */
export function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (v === undefined || v.trim() === '') {
    throw new Error(`missing required env ${name}`);
  }
  return v.trim();
}

/** Read an optional env var, returning `fallback` if unset/blank. */
export function optional(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string
): string {
  const v = env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

/** Parse a positive-integer env var; throw on a non-integer / non-positive value. */
export function parsePositiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer; got "${raw}"`);
  }
  return n;
}

/**
 * The local-dev connection string, for a developer to COPY — never a value
 * this module falls back to.
 *
 * Until 2026-09-12 `loadPostgresConfig` used it whenever BLOTTO_DATABASE_URL
 * was unset, so a service booted in a deployment that had lost its database
 * variable connected (or tried to) to localhost, quietly, with the real store
 * nowhere in the picture (audit 2026-09-11, Tier 3 item 6). Every other
 * credentialed seam in this repository refuses to start unconfigured; the
 * database now does too.
 */
export const DEFAULT_DATABASE_URL =
  'postgres://blotto:blotto@localhost:5432/blotto_dev';

/** Postgres connection block shared by every service that reads or writes the store. */
export interface PostgresConfig {
  /** libpq-style connection string. */
  url: string;
  /** Max pool connections. */
  poolMax: number;
}

/** Env var names for the shared Postgres block, in one auditable place. */
export const POSTGRES_ENV = {
  url: 'BLOTTO_DATABASE_URL',
  poolMax: 'BLOTTO_DB_POOL_MAX',
} as const;

/** Build the shared Postgres config from the environment. */
export function loadPostgresConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresConfig {
  const url = env[POSTGRES_ENV.url];
  if (url === undefined || url.trim() === '') {
    throw new Error(
      `${POSTGRES_ENV.url} is not set — refusing to start rather than fall back to a ` +
        `local database. For local development: ${POSTGRES_ENV.url}=${DEFAULT_DATABASE_URL}`
    );
  }
  return {
    url,
    poolMax: parsePositiveInt(env, POSTGRES_ENV.poolMax, 10),
  };
}
