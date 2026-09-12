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
 *   2. THE SIGNATURE IS THE PLAYER'S, over a message binding the pool, the
 *      player and a digest of these exact bytes. Verified the same way the
 *      clickwrap is, with the same library, against the wallet's own key.
 *   3. NO SILENT OVERWRITE. A second, different allocation for a seat that
 *      already has one is refused rather than applied. A player who starts
 *      a second run would otherwise destroy their own paid entry, because
 *      the ciphertext write happens before the duplicate check the chain
 *      does (audit D-01); re-posting the SAME bytes stays idempotent, so an
 *      ordinary network retry is unaffected.
 *
 * The refusals are deliberately distinguishable from each other but carry no
 * detail a prober could mine: a caller learns that their own write failed,
 * not anything about another wallet's entry.
 */

import nacl from 'tweetnacl';
import type { CiphertextStore } from '../../sealing/src';
import { ciphertextMessage } from './ciphertext-message';
import type { PoolIdResolver } from './pool-ids';
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

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function acceptCiphertext(
  poolIds: PoolIdResolver,
  store: CiphertextStore,
  submission: CiphertextSubmission
): Promise<AcceptResult> {
  // ---- 1. the pool ------------------------------------------------------
  const pool = await poolIds.lookup(submission.pool);
  if (pool === null) {
    return { status: 400, body: { error: 'unknown pool' } };
  }
  if (pool.state !== OPEN) {
    return { status: 409, body: { error: 'pool closed to entries' } };
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

  // ---- 3. no silent overwrite -------------------------------------------
  const existing = await store.get(pool.id, submission.player);
  if (existing && !sameBytes(existing.ciphertext, submission.ciphertext)) {
    return { status: 409, body: { error: 'already sealed' } };
  }

  await store.put(pool.id, submission.player, submission.ciphertext);
  return { status: 204, body: null };
}
