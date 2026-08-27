/**
 * The canonical EntryPacket encoding + the Ed25519 instruction the client
 * embeds (roadmap 4.1; TECH-ARCH §8).
 *
 * The 85-byte layout MIRRORS `programs/blotto_cup/src/entry_packet.rs` —
 * that file is the verifier and this file is the issuer, and the layout
 * table lives in both headers on purpose:
 *
 *   | offset | size | field           |
 *   |--------|------|-----------------|
 *   | 0      | 32   | wallet          |
 *   | 32     | 32   | pool            |
 *   | 64     | 8    | nonce (u64 LE)  |
 *   | 72     | 1    | geo_cleared     |
 *   | 73     | 1    | age_verified    |
 *   | 74     | 1    | kyc_tier        |
 *   | 75     | 8    | issued_at (i64) |
 *   | 83     | 2    | terms_version (u16) |
 *
 * The independent oracle is `fixtures/gen_vectors.py` (Python builds the
 * bytes for known fields; the suite pins this encoder to it), and the
 * LiteSVM suite drives the REAL on-chain verifier with instructions built
 * exactly this way.
 */

import nacl from 'tweetnacl';
import { base58Decode } from './shared';

export const PACKET_LEN = 85;

export interface EntryPacketFields {
  /** Base58 wallet. */
  wallet: string;
  /** Base58 pool PDA. */
  pool: string;
  nonce: bigint;
  geoCleared: boolean;
  ageVerified: boolean;
  kycTier: number;
  /** Unix seconds. */
  issuedAt: bigint;
  /** Terms/attestation version the wallet accepted (D-B4); never 0. */
  termsVersion: number;
}

export function encodePacket(p: EntryPacketFields): Uint8Array {
  const out = new Uint8Array(PACKET_LEN);
  out.set(base58Decode(p.wallet), 0);
  out.set(base58Decode(p.pool), 32);
  let n = p.nonce;
  for (let i = 0; i < 8; i++) {
    out[64 + i] = Number(n & 0xffn);
    n >>= 8n;
  }
  out[72] = p.geoCleared ? 1 : 0;
  out[73] = p.ageVerified ? 1 : 0;
  if (!Number.isInteger(p.kycTier) || p.kycTier < 0 || p.kycTier > 255) {
    throw new Error(`kyc_tier must fit a u8, got ${p.kycTier}`);
  }
  out[74] = p.kycTier;
  let t = BigInt.asUintN(64, p.issuedAt);
  for (let i = 0; i < 8; i++) {
    out[75 + i] = Number(t & 0xffn);
    t >>= 8n;
  }
  if (!Number.isInteger(p.termsVersion) || p.termsVersion < 0 || p.termsVersion > 0xffff) {
    throw new Error(`terms_version must fit a u16, got ${p.termsVersion}`);
  }
  out[83] = p.termsVersion & 0xff;
  out[84] = p.termsVersion >> 8;
  return out;
}

/** The signing seam. Turnkey in production (sign-only, no export, R21);
 * `LocalPacketSigner` for development and tests. */
export interface PacketSigner {
  publicKey(): Promise<Uint8Array>;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/** In-process Ed25519 signer — NOT production custody (R21). */
export class LocalPacketSigner implements PacketSigner {
  private readonly kp: nacl.SignKeyPair;
  constructor(seed: Uint8Array) {
    if (seed.length !== 32) throw new Error('seed must be 32 bytes');
    this.kp = nacl.sign.keyPair.fromSeed(seed);
  }
  async publicKey(): Promise<Uint8Array> {
    return this.kp.publicKey;
  }
  async sign(message: Uint8Array): Promise<Uint8Array> {
    return nacl.sign.detached(message, this.kp.secretKey);
  }
}

/**
 * The Ed25519Program instruction DATA the client embeds in the `register`
 * transaction: header(2) ‖ offsets(14, self-referential u16::MAX) ‖
 * pubkey(32) ‖ signature(64) ‖ message — byte-identical to what the LiteSVM
 * suite builds and the on-chain parser expects.
 */
export function ed25519InstructionData(
  pubkey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array
): Uint8Array {
  const pubkeyOffset = 16;
  const sigOffset = 16 + 32;
  const msgOffset = 16 + 32 + 64;
  const data = new Uint8Array(msgOffset + message.length);
  data[0] = 1;
  data[1] = 0;
  const offsets = [sigOffset, 0xffff, pubkeyOffset, 0xffff, msgOffset, message.length, 0xffff];
  offsets.forEach((v, i) => {
    data[2 + i * 2] = v & 0xff;
    data[3 + i * 2] = v >> 8;
  });
  data.set(pubkey, pubkeyOffset);
  data.set(signature, sigOffset);
  data.set(message, msgOffset);
  return data;
}
