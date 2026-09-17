/**
 * The one-message opt-in, v2 (founder 2026-09-17, round four,
 * CHANGE-2026-09-16_ui-uplift.md §F): "keep me updated when this pool
 * ends". A wallet-signed, PER-POOL consent that carries the address the one
 * message goes to, and the dispatcher that sends it when the pool is done.
 *
 * v1 (notify.ts) recorded a per-wallet flag with no address and no pool, and
 * nothing ever sent — the ruling of 2026-09-13 (D-E11) took the promise off
 * the app for that reason. v2 makes the consent complete on its own:
 *
 *   { pool, wallet, email, timestamp, wallet_signature }
 *
 * The signature is the wallet's Ed25519 signature over the canonical message
 * below, verified BEFORE anything is stored — the record proves the
 * keyholder chose, not merely that a browser POSTed. Bounded clock skew, and
 * an older captured message never overwrites a newer stored choice.
 *
 * THE ADDRESS IS KEPT ONLY UNTIL THE MESSAGE GOES. The dispatcher marks the
 * row sent and nulls the address in the same store call; a log line only
 * ever carries a masked form. One message per opt-in, about that pool,
 * nothing else — no schedule, no second message, no marketing.
 */

import nacl from 'tweetnacl';
import { base58Decode } from './shared';
import { maskAddress, type EmailSender } from './email-sender';

export const NOTIFY_POOL_VERSION = 'v2';

/** Canonical signed message — the same bytes the app signs (app/src/notify/pool-notify.ts). */
export function notifyPoolMessage(wallet: string, pool: string, email: string, atUnix: bigint): Uint8Array {
  return new TextEncoder().encode(
    `blotto-cup notify ${NOTIFY_POOL_VERSION}\nwallet: ${wallet}\npool: ${pool}\nemail: ${email}\nat: ${atUnix}`
  );
}

/** Accept a signed message no older/newer than this many seconds. */
export const NOTIFY_POOL_MAX_SKEW_SECONDS = 600n;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Enough shape to refuse a typo; the provider is the real check. */
export function acceptableEmail(address: string): boolean {
  return address.length <= 254 && EMAIL_SHAPE.test(address);
}

export interface PoolNotifyRecord {
  pool: string;
  wallet: string;
  /** Null once the message has gone. */
  email: string | null;
  /** Unix seconds from the SIGNED message (monotonicity guard). */
  timestamp: bigint;
  /** Base64 Ed25519 signature over `notifyPoolMessage(...)`. */
  walletSignature: string;
  sentAt: Date | null;
}

export interface PoolNotifyStore {
  get(pool: string, wallet: string): Promise<PoolNotifyRecord | null>;
  /** Insert or replace the (pool, wallet) row; a replacement reopens it. */
  put(record: PoolNotifyRecord): Promise<void>;
  /** Rows still to send: not yet sent and still holding an address. */
  pending(limit?: number): Promise<PoolNotifyRecord[]>;
  /** The message went: set sent_at and drop the address, in one step. */
  markSent(pool: string, wallet: string, at: Date): Promise<void>;
}

/** In-memory reference store — the Postgres twin follows the same contract
 * (backend/_shared/migrations/0023_notify_pool_optin.sql). */
export class MemoryPoolNotifyStore implements PoolNotifyStore {
  private readonly rows = new Map<string, PoolNotifyRecord>();
  private static key(pool: string, wallet: string): string {
    return `${pool}\n${wallet}`;
  }
  async get(pool: string, wallet: string): Promise<PoolNotifyRecord | null> {
    return this.rows.get(MemoryPoolNotifyStore.key(pool, wallet)) ?? null;
  }
  async put(record: PoolNotifyRecord): Promise<void> {
    this.rows.set(MemoryPoolNotifyStore.key(record.pool, record.wallet), { ...record });
  }
  async pending(limit = 500): Promise<PoolNotifyRecord[]> {
    return [...this.rows.values()].filter((r) => r.sentAt === null && r.email !== null).slice(0, limit);
  }
  async markSent(pool: string, wallet: string, at: Date): Promise<void> {
    const k = MemoryPoolNotifyStore.key(pool, wallet);
    const r = this.rows.get(k);
    if (r) this.rows.set(k, { ...r, email: null, sentAt: at });
  }
}

export interface PoolNotifySubmission {
  wallet: string;
  pool: string;
  email: string;
  /** Unix seconds the client signed into the message. */
  atUnix: bigint;
  /** Base64 Ed25519 signature over `notifyPoolMessage(wallet, pool, email, atUnix)`. */
  signature: string;
}

/**
 * Verify a submission and store it. Returns false (storing nothing) when the
 * address has no shape, the signature does not verify, the signed timestamp
 * is outside the skew window, or a newer choice is already stored for this
 * pool and wallet.
 */
export async function acceptPoolNotify(
  store: PoolNotifyStore,
  now: () => bigint,
  submission: PoolNotifySubmission
): Promise<boolean> {
  const email = submission.email.trim();
  if (!acceptableEmail(email)) return false;

  let signature: Uint8Array;
  let pubkey: Uint8Array;
  let poolKey: Uint8Array;
  try {
    signature = new Uint8Array(Buffer.from(submission.signature, 'base64'));
    pubkey = base58Decode(submission.wallet);
    poolKey = base58Decode(submission.pool);
  } catch {
    return false;
  }
  if (signature.length !== 64 || pubkey.length !== 32 || poolKey.length !== 32) return false;

  const at = submission.atUnix;
  const t = now();
  const skew = at > t ? at - t : t - at;
  if (skew > NOTIFY_POOL_MAX_SKEW_SECONDS) return false;

  const message = notifyPoolMessage(submission.wallet, submission.pool, email, at);
  if (!nacl.sign.detached.verify(message, signature, pubkey)) return false;

  const existing = await store.get(submission.pool, submission.wallet);
  if (existing !== null && existing.timestamp >= at) return false;

  await store.put({
    pool: submission.pool,
    wallet: submission.wallet,
    email,
    timestamp: at,
    walletSignature: submission.signature,
    sentAt: null,
  });
  return true;
}

/* ------------------------------------------------------------------------ */
/* The dispatcher                                                            */
/* ------------------------------------------------------------------------ */

/** A pool's state as the indexer projects it (`pools.state`), and its number. */
export interface PoolStateFacts {
  id: string | null;
  state: string;
}

export interface PoolStateReader {
  states(pools: readonly string[]): Promise<Map<string, PoolStateFacts>>;
}

/**
 * The pool is DONE — the message goes — in exactly these states: Paid
 * (prizes out) and Closed (refunded, or lapsed with nobody in it). Sealed,
 * Scored and Refunding are still moving; Open has not started.
 */
export const TERMINAL_POOL_STATES: ReadonlySet<string> = new Set(['Paid', 'Closed']);

// PHASE-N-REVIEW (founder 2026-09-17, round four): the one message. Plain
// text, one link, the same rule as the pool page. Founder owns the words.
export function composePoolMessage(
  facts: PoolStateFacts,
  poolPageUrl: string
): { subject: string; text: string } {
  const name = facts.id !== null ? `Pool #${facts.id}` : 'Your pool';
  const what =
    facts.state === 'Paid'
      ? 'The pool you entered has finished and its prizes are paid.'
      : 'The pool you entered has closed. If it did not reach its minimum field, every entry was refunded in full.';
  return {
    subject: `${name} has finished`,
    text:
      `${what}\n\n` +
      `The ranking, and every battle, is on the pool page:\n${poolPageUrl}\n\n` +
      `Every number there is recomputable from the published data.\n\n` +
      `You asked for this one message when you entered. The address it went to was deleted the moment it was sent.\n\n` +
      `Blotto Cup · blotto.gg · 18+ only · not available in some territories`,
  };
}

export interface NotifyDispatchDeps {
  store: PoolNotifyStore;
  pools: PoolStateReader;
  sender: EmailSender;
  /** The public pool page for a pool PDA. */
  poolPageUrl: (pool: string) => string;
  now: () => Date;
  log?: (line: string) => void;
}

export interface NotifyDispatchOutcome {
  /** Messages the provider accepted; their rows are marked and stripped. */
  sent: number;
  /** Rows whose pool is not done yet; untouched. */
  waiting: number;
  /** Sends the provider refused; rows left pending for the next run. */
  failed: number;
}

/**
 * One pass: every pending row whose pool is done gets its message; a
 * provider failure leaves the row for the next pass (nothing is marked
 * until the provider has accepted). Runs on a schedule (main.ts); a run
 * with nothing pending does nothing and reads nothing.
 */
export async function runNotifyDispatch(deps: NotifyDispatchDeps): Promise<NotifyDispatchOutcome> {
  const out: NotifyDispatchOutcome = { sent: 0, waiting: 0, failed: 0 };
  const rows = await deps.store.pending();
  if (rows.length === 0) return out;
  const states = await deps.pools.states([...new Set(rows.map((r) => r.pool))]);
  for (const row of rows) {
    if (row.email === null) continue;
    const facts = states.get(row.pool);
    if (!facts || !TERMINAL_POOL_STATES.has(facts.state)) {
      out.waiting += 1;
      continue;
    }
    const message = composePoolMessage(facts, deps.poolPageUrl(row.pool));
    try {
      await deps.sender.send({ to: row.email, ...message });
    } catch (e) {
      out.failed += 1;
      deps.log?.(
        `notify: send failed for pool ${row.pool} to ${maskAddress(row.email)} — ${e instanceof Error ? e.message : String(e)}`
      );
      continue;
    }
    await deps.store.markSent(row.pool, row.wallet, deps.now());
    out.sent += 1;
    deps.log?.(`notify: sent for pool ${row.pool} (${facts.state}) to ${maskAddress(row.email)}`);
  }
  return out;
}
