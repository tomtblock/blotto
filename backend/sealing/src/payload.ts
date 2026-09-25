/**
 * The canonical sealed payload (TECH-ARCH §5, roadmap 2.3): what the client
 * encrypts to the pool key at entry.
 *
 *   | offset | size   | field                                  |
 *   |--------|--------|----------------------------------------|
 *   | 0      | B      | battle set (7 × 5 stats, canonical)    |
 *   | B      | 32     | salt                                   |
 *   | B+32   | 28     | per-battle timings, 7 × u32 LE (ms)    |
 *   | B+60   | 32     | device hash (Privy fingerprint, R19)   |
 *
 * where B is the battle set's canonical length for the pool's MODE (Phase
 * B, founder rulings 2026-09-24): 35 bytes in easy (one byte per stat, each
 * battle summing to 100) — 127 bytes in all — or 70 bytes in hard (two bytes
 * per stat, the board summing to 700) — 162 in all. The mode is the pool's
 * (`Pool.mode`), never inferred from the bytes: a payload of the wrong
 * length for its pool fails to decode and is scored as a lost ciphertext.
 *
 * The battles and salt are what `battles_hash` commits on-chain; timings and
 * the device hash ride along sealed for the detection layer (TECH-ARCH §9)
 * and reach only it: the published reveal bundle carries neither (bundle
 * version 2, audit B-31, 2026-09-12). The layout is fixed-width per mode so
 * a decode either yields exactly these fields or fails loudly — no optional
 * tail.
 */

import { sha256 } from '@noble/hashes/sha256';
import {
  BATTLES,
  BATTLE_SET_BYTES,
  SALT_BYTES,
  type BattleSet,
  type BoardMode,
  battleSetBytes,
  decodeBattleSet,
  encodeBattleSet,
} from './scoring';

export const TIMINGS_BYTES = BATTLES * 4;
export const DEVICE_HASH_BYTES = 32;
/** The EASY payload length (127). `payloadBytes(mode)` for either. */
export const PAYLOAD_BYTES = BATTLE_SET_BYTES + SALT_BYTES + TIMINGS_BYTES + DEVICE_HASH_BYTES;

/** The sealed payload's length for a mode: 127 easy, 162 hard. */
export function payloadBytes(mode: BoardMode = 'easy'): number {
  return battleSetBytes(mode) + SALT_BYTES + TIMINGS_BYTES + DEVICE_HASH_BYTES;
}

export interface SealedPayload {
  battles: BattleSet;
  salt: Uint8Array;
  /** Milliseconds per battle screen, captured client-side. */
  timingsMs: readonly number[];
  deviceHash: Uint8Array;
}

export function encodePayload(p: SealedPayload, mode: BoardMode = 'easy'): Uint8Array {
  if (p.salt.length !== SALT_BYTES) {
    throw new Error(`salt must be ${SALT_BYTES} bytes, got ${p.salt.length}`);
  }
  if (p.timingsMs.length !== BATTLES) {
    throw new Error(`timings must have ${BATTLES} entries, got ${p.timingsMs.length}`);
  }
  if (p.deviceHash.length !== DEVICE_HASH_BYTES) {
    throw new Error(`device hash must be ${DEVICE_HASH_BYTES} bytes, got ${p.deviceHash.length}`);
  }
  const setBytes = battleSetBytes(mode);
  const out = new Uint8Array(payloadBytes(mode));
  out.set(encodeBattleSet(p.battles, mode), 0);
  out.set(p.salt, setBytes);
  let o = setBytes + SALT_BYTES;
  for (const t of p.timingsMs) {
    if (!Number.isInteger(t) || t < 0 || t > 0xffffffff) {
      throw new Error(`timing must fit a u32, got ${t}`);
    }
    out[o++] = t & 0xff;
    out[o++] = (t >>> 8) & 0xff;
    out[o++] = (t >>> 16) & 0xff;
    out[o++] = (t >>> 24) & 0xff;
  }
  out.set(p.deviceHash, o);
  return out;
}

export function decodePayload(bytes: Uint8Array, mode: BoardMode = 'easy'): SealedPayload {
  const expected = payloadBytes(mode);
  if (bytes.length !== expected) {
    throw new Error(`${mode} sealed payload must be ${expected} bytes, got ${bytes.length}`);
  }
  const setBytes = battleSetBytes(mode);
  const battles = decodeBattleSet(bytes.subarray(0, setBytes), mode);
  const salt = bytes.slice(setBytes, setBytes + SALT_BYTES);
  const timingsMs: number[] = [];
  let o = setBytes + SALT_BYTES;
  for (let k = 0; k < BATTLES; k++) {
    timingsMs.push(
      (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | ((bytes[o + 3] << 24) >>> 0)) >>> 0
    );
    o += 4;
  }
  const deviceHash = bytes.slice(o, o + DEVICE_HASH_BYTES);
  return { battles, salt, timingsMs, deviceHash };
}

/**
 * The on-chain commitment from its two inputs alone: `sha256(battles ‖ salt)`
 * over the mode's canonical battle-set bytes.
 *
 * One definition (R20): the client commits with it at entry, the crank checks
 * it at reveal, and — since 2026-09-16 — a browser reading the PUBLISHED
 * bundle recomputes it to decide whether a seat's published battles are the
 * ones that were committed, instead of opening the sealed box itself.
 */
export function battlesCommitment(
  battles: BattleSet,
  salt: Uint8Array,
  mode: BoardMode = 'easy'
): Uint8Array {
  if (salt.length !== SALT_BYTES) {
    throw new Error(`salt must be ${SALT_BYTES} bytes, got ${salt.length}`);
  }
  const bytes = encodeBattleSet(battles, mode);
  const input = new Uint8Array(bytes.length + SALT_BYTES);
  input.set(bytes, 0);
  input.set(salt, bytes.length);
  return sha256(input);
}

export function payloadBattlesHash(p: SealedPayload, mode: BoardMode = 'easy'): Uint8Array {
  return battlesCommitment(p.battles, p.salt, mode);
}
