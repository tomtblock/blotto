/**
 * X25519 sealed boxes — the encryption clients seal battles with
 * (TECH-ARCH §5). Implements libsodium's `crypto_box_seal` construction over
 * tweetnacl primitives, so the SAME code runs in the browser (the client
 * seals) and in Node (the crank opens):
 *
 *   ephemeral (epk, esk) = fresh X25519 keypair
 *   nonce               = blake2b-24(epk ‖ recipient_pk)
 *   ciphertext          = epk(32) ‖ crypto_box(msg, nonce, recipient_pk, esk)
 *
 * The construction is deliberately libsodium-compatible: any standard
 * sodium binding (Python, Rust, CLI) can open or produce these boxes, which
 * keeps the "anyone can decrypt with the revealed secret" claim honest —
 * a player is NOT locked into our code to verify (tradeoff order #3).
 *
 * The public wording is fixed (TECH-ARCH §5): "Battles are encrypted to a
 * key nobody holds until the pool closes, and their hash is recorded
 * on-chain at entry."
 */

import { blake2b } from '@noble/hashes/blake2b';
import nacl from 'tweetnacl';

export const SEALED_OVERHEAD = 32 + 16; // ephemeral pk + poly1305 tag

/** A pool's X25519 keypair. `secretKey` exists only inside custody. */
export interface X25519Keypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateKeypair(): X25519Keypair {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

function sealNonce(epk: Uint8Array, recipientPk: Uint8Array): Uint8Array {
  const input = new Uint8Array(64);
  input.set(epk, 0);
  input.set(recipientPk, 32);
  return blake2b(input, { dkLen: nacl.box.nonceLength }); // 24 bytes
}

/** Seal `message` to `recipientPk` (libsodium `crypto_box_seal`). */
export function seal(message: Uint8Array, recipientPk: Uint8Array): Uint8Array {
  if (recipientPk.length !== 32) {
    throw new Error(`recipient public key must be 32 bytes, got ${recipientPk.length}`);
  }
  const eph = nacl.box.keyPair();
  const nonce = sealNonce(eph.publicKey, recipientPk);
  const boxed = nacl.box(message, nonce, recipientPk, eph.secretKey);
  const out = new Uint8Array(32 + boxed.length);
  out.set(eph.publicKey, 0);
  out.set(boxed, 32);
  return out;
}

/**
 * Open a sealed box with the recipient's secret key. Returns null on any
 * authentication failure — a tampered or misdirected ciphertext.
 */
export function sealOpen(sealed: Uint8Array, recipient: X25519Keypair): Uint8Array | null {
  if (sealed.length < SEALED_OVERHEAD) return null;
  const epk = sealed.subarray(0, 32);
  const nonce = sealNonce(epk, recipient.publicKey);
  const opened = nacl.box.open(sealed.subarray(32), nonce, epk, recipient.secretKey);
  return opened ?? null;
}

/** Derive the X25519 public key of a secret key (for reveal-time checks). */
export function publicKeyOf(secretKey: Uint8Array): Uint8Array {
  return nacl.box.keyPair.fromSecretKey(secretKey).publicKey;
}
