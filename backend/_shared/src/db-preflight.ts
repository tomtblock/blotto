/**
 * The database-url preflight: before a deploy replaces a machine, can a
 * service actually boot on this connection string?
 *
 * ── WHY THIS EXISTS (incident 2026-09-24) ─────────────────────────────────
 *
 * The database password was reset at the provider while a deploy was in
 * flight. `BLOTTO_DATABASE_URL` still held the old one. What followed:
 *
 *   14:23  run #37 deployed the indexer; it connected and passed its checks
 *   14:26  the password stopped working; the daemon's every tick failed
 *   14:28  run #37 failed at its smoke check
 *   14:31  run #38 replaced the indexer's machine — `cmdSync` migrates BEFORE
 *          it serves, so a database it cannot reach means nothing answers
 *          `/health`, and `min_machines_running = 1` with no healthy machine
 *          is no service at all
 *   14:36  the deploy gave up after five minutes of health checks
 *   15:29  a corrected secret and a fourth run brought it back
 *
 * Sixty-five minutes of outage, two failed runs, and the whole time the
 * answer was one Postgres error code away: 28P01, invalid password. The
 * deploy checked that `BLOTTO_DATABASE_URL` was SET. Nothing checked that it
 * WORKED. A credential is not configuration until something has used it.
 *
 * Worse, the three services that were never redeployed kept answering their
 * health checks with 200 while failing every query, because those checks do
 * not touch the database. A green tick and a working system were not the
 * same thing, and nothing in the run said so.
 *
 * So: dial the database first, with the same client the services use, and
 * refuse the run before a single machine is touched.
 *
 * ── AND THE TLS POSTURE, WHICH MOVED HERE ─────────────────────────────────
 *
 * `db.ts::tlsWarning` says its piece at boot, which is after the machine is
 * already replaced. Its own `PHASE-N-REVIEW` note said the check should
 * become a refusal and move into the deploy's gate job once the secret was
 * confirmed. The secret is now confirmed — it classifies as `alias` — so the
 * refusal lives here.
 *
 * It did NOT move into the `gate` job, and that note was written without
 * reading the workflow. `gate` is a separate job precisely so that the
 * `actions: read` scope it needs never sits beside a credential, and this
 * check needs the database url. It therefore runs at the head of `deploy`,
 * which already holds that url — still before any machine is replaced, which
 * is the property that mattered.
 *
 * ── WHAT THIS FILE MAY NOT DO ─────────────────────────────────────────────
 *
 * NEVER print the driver's own error text. A connection url carries the
 * password AND the host, the whole string is the secret, and a driver
 * message for an unresolvable host quotes that host back. The runner masks
 * the secret it was given, not its substrings. So every sentence here is
 * written locally, and for an error this file does not recognise it prints
 * the error CODE alone — a short SQLSTATE or Node errno, which carries
 * nothing from the url.
 *
 * Pure decisions and error naming live here so a suite drives them without a
 * database; `check-database-url.ts` is the executable that does the dialling.
 */

import { isLocalUrl, tlsPosture } from './db';
import type { Cluster } from './cluster';
import { POSTGRES_ENV } from './config';

/**
 * What the preflight concluded. Two lists, never one: a warning that reads
 * like a refusal teaches an operator to scroll past refusals.
 */
export interface Verdict {
  /** Each a reason this deploy must not proceed. Empty means proceed. */
  readonly refusals: readonly string[];
  /** Each worth reading, none blocking. */
  readonly warnings: readonly string[];
}

/** The remedy named by every TLS message here, written once. */
const TLS_REMEDY = `set sslmode=verify-full in the ${POSTGRES_ENV.url} secret`;

/**
 * Everything the url's own text decides, before anything is dialled.
 *
 * On a development cluster an `alias` sslmode is a warning: it is verified
 * TLS on the pinned `pg` 8 and becomes unverified on `pg` 9, so it is a
 * dated risk rather than a present one, and the founder owns whether to take
 * an outage to fix it today. On mainnet it is a refusal, because "correct
 * until a dependency bump" is not a posture to carry real money on.
 *
 * A url with no TLS at all is a refusal on EVERY cluster. There is no
 * version of this product where sealed entries and the text players write
 * about their own problems cross a network in the clear.
 *
 * A url naming the local machine gets no TLS opinion — that is a developer's
 * own Postgres — but on mainnet it is a refusal of its own, because a
 * mainnet service pointed at localhost has no store at all.
 */
export function inspectUrl(url: string, cluster: Cluster): Verdict {
  const refusals: string[] = [];
  const warnings: string[] = [];

  if (url.trim() === '') {
    // Defence in depth: the workflow's credential preflight already names an
    // absent secret. This file must still refuse rather than dial "".
    return {
      refusals: [`${POSTGRES_ENV.url} is unset — there is nothing to connect to`],
      warnings: [],
    };
  }

  const mainnet = cluster === 'mainnet';

  if (isLocalUrl(url)) {
    if (mainnet) {
      refusals.push(
        `${POSTGRES_ENV.url} names a host that can only be a developer's own machine, ` +
          'and this is a mainnet deploy'
      );
    }
    return { refusals, warnings };
  }

  const posture = tlsPosture(url);
  if (posture === 'plaintext') {
    refusals.push(
      `${POSTGRES_ENV.url} names a remote host with NO TLS — every row, including sealed ` +
        `entries and the text players write about their own problems, would cross the ` +
        `network in the clear. ${TLS_REMEDY}`
    );
  } else if (posture === 'alias') {
    const sentence =
      `${POSTGRES_ENV.url} relies on an sslmode that pg-connection-string treats as ` +
      `verify-full TODAY and will treat as unverified TLS from pg 9 — ${TLS_REMEDY} so the ` +
      'posture survives a dependency bump';
    if (mainnet) {
      refusals.push(sentence);
    } else {
      warnings.push(sentence);
    }
  }

  return { refusals, warnings };
}

/**
 * A fixed, url-free sentence for a failure to connect.
 *
 * Reads `code` and nothing else. Postgres sends a five-character SQLSTATE;
 * Node sends an errno or an OpenSSL reason for a TLS failure. None of them
 * carries any part of the connection string, which is why they are the only
 * thing this function is allowed to look at.
 */
export function describeConnectError(err: unknown): string {
  const code = readCode(err);
  const byCode = KNOWN_CODES[code ?? ''];
  if (byCode !== undefined) return byCode;

  // MATCHING a message is not PRINTING one, and the difference is the whole
  // rule: what leaks a url is echoing the driver's text, not testing it.
  // Only exact equality against a sentence `pg` composes itself — a message
  // carrying any part of the url could never equal one of these.
  const byMessage = KNOWN_MESSAGES[readMessage(err) ?? ''];
  if (byMessage !== undefined) return byMessage;

  if (code === null) {
    return (
      `could not connect with ${POSTGRES_ENV.url}, and the driver gave no error code. ` +
      'The error text is not printed because a connection url is a secret and driver ' +
      'messages quote it back'
    );
  }
  return (
    `could not connect with ${POSTGRES_ENV.url} (driver code ${code}). The error text is ` +
    'not printed because a connection url is a secret and driver messages quote it back'
  );
}

/** The `code` off an error object, when it carries a usable one. */
function readCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code !== '' ? code : null;
}

/** The `message` off an error object — read to classify, never to print. */
function readMessage(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && message !== '' ? message : null;
}

/**
 * The failures `pg` reports with NO code at all, keyed by the exact sentence
 * it composes for each. Both matter here:
 *
 *   - the first is what a `verify-full` url meets at a database that does
 *     not serve TLS. That is the edit this deployment is one step away from
 *     making, and "the driver gave no error code" would be a useless thing
 *     to hand somebody at that moment.
 *   - the second is a connection that never opened. Left unnamed it reads
 *     like a mystery; named, it is a host, a port or a firewall.
 *
 * Exact equality, never a substring test: a message carrying any part of the
 * url cannot equal a sentence with no url in it, so this cannot become a
 * route by which one is recognised and repeated.
 */
const KNOWN_MESSAGES: Readonly<Record<string, string>> = {
  'The server does not support SSL connections':
    `${POSTGRES_ENV.url} asks for TLS and the database does not offer it. Either the host ` +
    'in the string is not the one intended, or that database has TLS switched off — and a ' +
    'database holding sealed entries must not',
  'timeout expired': `the connection to the host in ${POSTGRES_ENV.url} timed out`,
  'Connection terminated due to connection timeout': `the connection to the host in ${POSTGRES_ENV.url} timed out`,
};

/**
 * Every failure worth naming in its own words.
 *
 * The first row is the incident of 2026-09-24 and the reason this file
 * exists: a reset password looks like nothing else, and an operator who is
 * told "28P01" by name knows immediately which of the two ends to change.
 *
 * The TLS rows are the failure the verify-full edit could introduce, caught
 * here rather than by a crash-looping machine — which is the whole point of
 * running this before the deploy instead of after it.
 */
const KNOWN_CODES: Readonly<Record<string, string>> = {
  '28P01':
    `the password in ${POSTGRES_ENV.url} was rejected (Postgres 28P01, invalid password). ` +
    'If the database\'s password was reset at the provider, this secret still holds the old ' +
    'one — take the current connection string from the provider and update the secret',
  '28000':
    `the role named in ${POSTGRES_ENV.url} was rejected (Postgres 28000). Check the user ` +
    'part of the connection string against the roles the database actually has',
  '3D000':
    `the database named in ${POSTGRES_ENV.url} does not exist (Postgres 3D000). Check the ` +
    'path at the end of the connection string',
  '42501':
    `the role in ${POSTGRES_ENV.url} connected but lacks privileges (Postgres 42501)`,
  '53300':
    'the database refused a new connection: too many are already open (Postgres 53300). ' +
    'This is the provider\'s limit, not the connection string',
  '57P03':
    'the database is starting up and not yet accepting connections (Postgres 57P03). ' +
    'A provider that suspends an idle database may just need a moment',
  ENOTFOUND: `the host in ${POSTGRES_ENV.url} does not resolve (DNS ENOTFOUND)`,
  EAI_AGAIN: `the host in ${POSTGRES_ENV.url} could not be resolved (DNS EAI_AGAIN)`,
  ECONNREFUSED: `nothing is listening at the host and port in ${POSTGRES_ENV.url}`,
  ECONNRESET: 'the database closed the connection while it was being opened (ECONNRESET)',
  ETIMEDOUT: `the connection to the host in ${POSTGRES_ENV.url} timed out`,
  CERT_HAS_EXPIRED:
    `TLS verification failed: the database's certificate has expired. ${TLS_REMEDY} asks ` +
    'for a verified chain, and this one cannot be verified',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    'TLS verification failed: the database\'s certificate chain does not verify against ' +
    'the trusted roots this runtime carries',
  SELF_SIGNED_CERT_IN_CHAIN:
    'TLS verification failed: the database presents a self-signed certificate, which a ' +
    'verify-full connection will not accept',
  DEPTH_ZERO_SELF_SIGNED_CERT:
    'TLS verification failed: the database presents a self-signed certificate, which a ' +
    'verify-full connection will not accept',
  ERR_TLS_CERT_ALTNAME_INVALID:
    'TLS verification failed: the certificate does not name the host the connection string ' +
    'asks for',
};

/** A timeout long enough for a suspended managed database to wake. */
export const PROBE_TIMEOUT_MS = 20_000;

/** The one statement this preflight runs. It proves a session, nothing more. */
export const PROBE_STATEMENT = 'SELECT 1';
