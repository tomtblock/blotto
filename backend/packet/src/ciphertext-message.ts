/**
 * The canonical sealed-entry message — the exact bytes a wallet signs to
 * prove it owns the allocation it is storing.
 *
 * ONE definition, browser-bundleable, imported by both ends exactly as the
 * notify and attestation messages are: the app builds it to sign, the packet
 * service rebuilds it to verify, and the two cannot drift.
 *
 * Why this exists. Until 2026-09-12 `POST /ciphertexts` accepted a sealed
 * allocation for any (pool, player) from anyone, and the store's write is an
 * upsert. That meant any internet user could replace a paying entrant's
 * sealed allocation with random bytes: at settlement the replaced entry
 * fails its on-chain hash check, is scored all losses, and the attacker wins
 * every battle against it. The audit of 2026-09-11 rated it CRITICAL (B-02)
 * because it is a route to the whole prize pool with no wallet and no
 * on-chain footprint beyond one ordinary entry.
 *
 * The message binds three things, and each one closes a different door:
 *
 *   - the POOL, so a signature captured for one pool cannot be replayed into
 *     another;
 *   - the PLAYER, so only the wallet that owns the seat can write its own
 *     allocation;
 *   - a HASH OF THE CIPHERTEXT, so a captured signature cannot be re-used to
 *     store DIFFERENT bytes for the same wallet and pool. This is what makes
 *     the signature specific to one allocation rather than a standing
 *     permission.
 *
 * It is human-readable because wallets display the text they are asked to
 * sign, and a signer should be able to read what they are agreeing to. The
 * digest is rendered as lowercase hex for the same reason.
 */

// The same pure-JS hash the scoring and Merkle modules use. Deliberately
// NOT node:crypto: this module is imported by the browser, and a built-in
// here would either break the bundle or drag a polyfill into it.
import { sha256 } from '@noble/hashes/sha256';

/** sha256 of the sealed box, lowercase hex — what the message commits to. */
export function ciphertextDigest(ciphertext: Uint8Array): string {
  return Array.from(sha256(ciphertext))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The bytes the player's wallet signs. Rejects an empty pool or player
 * rather than producing a message with "undefined" in it: a malformed call
 * must fail closed, never sign something nobody can read.
 */
export function ciphertextMessage(
  pool: string,
  player: string,
  ciphertext: Uint8Array
): Uint8Array {
  if (!pool || !player) {
    throw new Error('ciphertext message needs both a pool and a player');
  }
  if (ciphertext.length === 0) {
    throw new Error('ciphertext message needs the sealed bytes');
  }
  return new TextEncoder().encode(
    `Blotto Cup\n` +
      `I am sealing my allocation for this tournament.\n` +
      `Pool: ${pool}\n` +
      `Wallet: ${player}\n` +
      `Sealed: ${ciphertextDigest(ciphertext)}\n`
  );
}

/**
 * The bytes a wallet signs to ASK whether it has already sealed for a pool.
 *
 * A separate message from the write, deliberately, and not a convenience.
 * The write message commits to a digest of the ciphertext — which is the
 * whole of what makes a captured signature specific to one allocation
 * rather than a standing permission. A reader has no ciphertext to commit
 * to, so reusing that message would mean either inventing a digest or
 * dropping the binding; both turn a read signature into something a write
 * could be built from. This message is distinguishable from the write's by
 * its first line, so neither can ever be replayed as the other.
 *
 * It carries a client timestamp for the same reason the notify message
 * does: the verifier accepts only a bounded skew, so a captured read
 * signature stops working. There is nothing behind it worth capturing — the
 * answer is one boolean about the caller's own wallet — but a read
 * endpoint that accepts a signature forever is a habit worth not forming.
 */
export function ciphertextStatusMessage(
  pool: string,
  player: string,
  atUnix: bigint
): Uint8Array {
  if (!pool || !player) {
    throw new Error('ciphertext status message needs both a pool and a player');
  }
  return new TextEncoder().encode(
    `Blotto Cup\n` +
      `I am asking whether I have already sealed for this tournament.\n` +
      `Pool: ${pool}\n` +
      `Wallet: ${player}\n` +
      `At: ${atUnix}\n`
  );
}
