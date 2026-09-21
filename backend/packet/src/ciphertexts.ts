/**
 * Accepting a sealed allocation — the authorization the route used to have
 * none of.
 *
 * Before 2026-09-12 `POST /ciphertexts` checked three things: that the pool
 * and player looked like addresses, and that the body was exactly the right
 * length. It checked nothing about WHO was writing. Since the store's write
 * is an upsert, anyone who could read the public entry list could replace a
 * paying entrant's sealed allocation with random bytes; that entry then
 * failed its on-chain hash check at settlement, was scored all losses, and
 * the attacker won every battle against it. The audit of 2026-09-11 rated
 * that CRITICAL (B-02): a route to the entire prize pool from an
 * unauthenticated HTTP client.
 *
 * Three gates now stand in front of the write, in the order that refuses
 * most cheaply first:
 *
 *   1. THE POOL IS KNOWN AND STILL OPEN. A pool the projection has never
 *      seen cannot be keyed correctly (see `pool-ids.ts`), and a pool that
 *      has sealed can no longer legitimately receive an allocation — after
 *      the seal a victim could not repair an overwrite even if they noticed.
 *      Since 2026-09-19 this gate says WHICH of the two closed cases it is,
 *      because "the pool filled" and "the pool ran out of time" are different
 *      things to the person reading the screen, and the app owns a sentence
 *      for each. See the constants below for why that is not a §8 leak.
 *   2. THE SIGNATURE IS THE PLAYER'S, over a message binding the pool, the
 *      player and a digest of these exact bytes. Verified the same way the
 *      clickwrap is, with the same library, against the wallet's own key.
 *   3. NO OVERWRITE OF A PAID SEAT. A second, different allocation for a
 *      seat THE CHAIN HAS ALREADY ACCEPTED is refused rather than applied:
 *      the chain holds that run's battles_hash, the ciphertext write happens
 *      before the duplicate check the chain does (audit D-01), and the two
 *      disagreeing scores the entry all losses. Re-posting the SAME bytes
 *      stays idempotent, so an ordinary network retry is unaffected.
 *
 *      Until 2026-09-18 this gate asked "does a ciphertext already exist?"
 *      instead, which is the same question only after the register lands.
 *      Before it, the two are opposites: a stored ciphertext with no
 *      registered seat is an abandoned attempt — a refused packet, a
 *      dismissed wallet prompt, a closed laptop — and refusing to replace it
 *      barred that wallet from that pool permanently, having paid nothing,
 *      with no delete path and a generic refusal that told them trying again
 *      would not help. Eleven devnet wallets were lost that way across three
 *      pools before it was fixed (DRIFT.md §H6). `seats.ts` holds the
 *      corrected question and the reason its key is the pool's PDA.
 *
 * The refusals are deliberately distinguishable from each other but carry no
 * detail a prober could mine: a caller learns that their own write failed,
 * not anything about another wallet's entry.
 *
 * `ciphertextStatus` answers the fourth thing a wallet needs: whether it has
 * already sealed here. The lockout above was not only irreversible, it was
 * INVISIBLE — a player, an operator and a support agent had no way to find
 * out, and `battle-test/scripts/preflight.ts` reported GO for two wallets
 * that were already barred, because the question could not be asked.
 */

import nacl from 'tweetnacl';
import type { CiphertextStore } from '../../sealing/src';
import { ciphertextMessage, ciphertextStatusMessage } from './ciphertext-message';
import { CAPACITY } from '../../scoring/src/prizes';
import type { PoolIdResolver } from './pool-ids';
import type { SeatResolver } from './seats';
import { base58Decode } from './shared';

export interface CiphertextSubmission {
  pool: string;
  player: string;
  ciphertext: Uint8Array;
  /** base64 Ed25519 signature by `player` over the canonical message. */
  signature: string;
}

export interface AcceptResult {
  status: number;
  body: unknown;
}

/** The only pool state that may still receive a sealed allocation. */
const OPEN = 'Open';

/**
 * The two ways a pool can already be shut when a late allocation arrives, and
 * why the route bothers to tell them apart.
 *
 * These are the `error` strings a refused caller receives, and the app maps
 * them to the two sentences it already owns: "this pool filled before your
 * entry reached it" and "this pool is no longer taking entries". Until
 * 2026-09-19 the route answered a single string for both, so the app could
 * only show a message that hedged — and the "filled" sentence, which is the
 * one a player in that situation actually wants, had never been shown to
 * anybody (battle-test/registry/pool-22.observation.md, Observation 4).
 *
 * WHY THIS DOES NOT WEAKEN THE GENERIC-REFUSAL RULE (PID §8). The refusal
 * that must stay generic is the ENTRY PACKET's — geo, sanctions, age — where
 * naming the failing check would turn the endpoint into an oracle a probe
 * could walk. These two say nothing about the caller. They are facts about
 * the POOL, already published on its own page to anyone who loads it, and
 * they are returned only from this route. `/packet` is untouched and still
 * answers one generic refusal for every reason it has.
 */
const CLOSED_BECAUSE_FULL = 'pool filled';
const CLOSED_TO_ENTRIES = 'pool closed to entries';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function acceptCiphertext(
  poolIds: PoolIdResolver,
  seats: SeatResolver,
  store: CiphertextStore,
  submission: CiphertextSubmission
): Promise<AcceptResult> {
  // ---- 1. the pool ------------------------------------------------------
  const pool = await poolIds.lookup(submission.pool);
  if (pool === null) {
    return { status: 400, body: { error: 'unknown pool' } };
  }
  if (pool.state !== OPEN) {
    // A pool that took its 64th entry and a pool that reached its deadline
    // are BOTH no longer Open, so `state` alone cannot separate them. The
    // seat count can: at capacity it filled, below it the clock ran out.
    // A pool can never exceed capacity — `register` refuses past it — so
    // `>=` and `===` agree here; `>=` is used so a projection that ever
    // over-counts degrades to the more specific message rather than the
    // vaguer one.
    const filled = pool.entrants >= Number(CAPACITY);
    return {
      status: 409,
      body: { error: filled ? CLOSED_BECAUSE_FULL : CLOSED_TO_ENTRIES },
    };
  }

  // ---- 2. the signature -------------------------------------------------
  let signature: Uint8Array;
  let pubkey: Uint8Array;
  try {
    signature = new Uint8Array(Buffer.from(submission.signature, 'base64'));
    pubkey = base58Decode(submission.player);
  } catch {
    return { status: 403, body: { error: 'signature' } };
  }
  if (signature.length !== 64 || pubkey.length !== 32) {
    return { status: 403, body: { error: 'signature' } };
  }
  const message = ciphertextMessage(submission.pool, submission.player, submission.ciphertext);
  if (!nacl.sign.detached.verify(message, signature, pubkey)) {
    return { status: 403, body: { error: 'signature' } };
  }

  // ---- 3. no overwrite of a PAID seat -----------------------------------
  // What must never be overwritten is a seat the chain has already accepted.
  // A ciphertext with NO registered seat is an abandoned attempt; replacing
  // it harms nobody, and refusing it costs that wallet the pool for good.
  //
  // FAILS CLOSED: `isRegistered` answers null when it cannot say, and null is
  // treated as "registered". The cost of a wrong refusal is one retry before
  // anything is paid; the cost of a wrong allowance is a player's paid entry.
  // The seat lookup runs only on an actual overwrite attempt, so the ordinary
  // first seal still costs one store read and no more.
  const existing = await store.get(pool.id, submission.player);
  if (existing && !sameBytes(existing.ciphertext, submission.ciphertext)) {
    const seated = await seats.isRegistered(submission.pool, submission.player);
    if (seated !== false) {
      return { status: 409, body: { error: 'already sealed' } };
    }
  }

  await store.put(pool.id, submission.player, submission.ciphertext);
  return { status: 204, body: null };
}

/** A wallet asking whether it has already sealed for a pool. */
export interface CiphertextStatusQuery {
  pool: string;
  player: string;
  /** Unix seconds the client signed into the message. */
  atUnix: bigint;
  /** base64 Ed25519 signature by `player` over `ciphertextStatusMessage`. */
  signature: string;
}

/** How far a signed status request's clock may be from ours. Same window as
 * the notify message, and for the same reason: enough for an honest client's
 * drift, short enough that a captured signature stops working. */
export const CIPHERTEXT_STATUS_MAX_SKEW_SECONDS = 600n;

/**
 * Answer "have I sealed for this pool?" for the wallet that asks it about
 * ITSELF, proven by a signature over the canonical status message.
 *
 * It returns a BOOLEAN and never the ciphertext, so "no public reader of the
 * sealed boxes" is untouched: the answer is one bit the asking wallet could
 * already infer from its own failed entry, and nothing about any other seat.
 * Deliberately NOT gated on the pool's state — a player who was barred wants
 * the truth after the pool sealed as much as before, and the endpoint writes
 * nothing.
 *
 * An unknown pool answers 400 exactly as the write does, rather than a
 * cheerful `sealed: false` for an address nobody has ever seen.
 */
export async function ciphertextStatus(
  poolIds: PoolIdResolver,
  store: CiphertextStore,
  now: () => bigint,
  query: CiphertextStatusQuery
): Promise<AcceptResult> {
  const pool = await poolIds.lookup(query.pool);
  if (pool === null) {
    return { status: 400, body: { error: 'unknown pool' } };
  }

  let signature: Uint8Array;
  let pubkey: Uint8Array;
  try {
    signature = new Uint8Array(Buffer.from(query.signature, 'base64'));
    pubkey = base58Decode(query.player);
  } catch {
    return { status: 403, body: { error: 'signature' } };
  }
  if (signature.length !== 64 || pubkey.length !== 32) {
    return { status: 403, body: { error: 'signature' } };
  }

  const t = now();
  const skew = query.atUnix > t ? query.atUnix - t : t - query.atUnix;
  if (skew > CIPHERTEXT_STATUS_MAX_SKEW_SECONDS) {
    return { status: 403, body: { error: 'signature' } };
  }

  const message = ciphertextStatusMessage(query.pool, query.player, query.atUnix);
  if (!nacl.sign.detached.verify(message, signature, pubkey)) {
    return { status: 403, body: { error: 'signature' } };
  }

  const existing = await store.get(pool.id, query.player);
  return { status: 200, body: { sealed: existing !== null } };
}
