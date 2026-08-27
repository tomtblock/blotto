/*
 * The client entry pipeline (roadmap 3.3/3.4, client side of TECH-ARCH §5):
 *
 *   confirmed battles + timings
 *     → 32-byte salt from the browser CSPRNG
 *     → canonical sealed payload (batteries from @blotto/sealing — the SAME
 *       encoding the crank decodes)
 *     → sealed-box encrypt to the pool's published key
 *     → POST the ciphertext to the entry service
 *     → obtain the entry packet (Ed25519-signed by the packet service — 4.1)
 *     → `register` transaction carrying sha256(battles ‖ salt)
 *
 * THE CLIENT INVARIANT lives at this boundary: `encodePayload` validates
 * five non-negative integers summing to exactly 100 in fixed order and
 * throws otherwise — nothing else can leave this function toward the chain.
 *
 * The two service calls are SEAMS (`EntryServices`): the ciphertext POST and
 * the packet request land with the Phase 4 packet service; the transaction
 * seam is the carried src/tx pipeline, wired against devnet in the Phase 5
 * rehearsal. This module is pure over its dependencies and fully testable
 * today (submit.test.ts).
 */

import {
  encodePayload,
  seal,
  payloadBattlesHash,
} from '../../../backend/sealing/src';
import type { Allocation } from '@/battle/allocation';

export interface EntryServices {
  /** Store the sealed ciphertext (backend/sealing store). Must succeed BEFORE
   * the transaction: a paid entry whose ciphertext never landed is the lost-
   * ciphertext failure mode, so the order is ciphertext first, pay second. */
  putCiphertext(pool: string, player: string, ciphertext: Uint8Array): Promise<void>;
  /** Obtain the Ed25519 entry-packet instruction bytes (packet service, 4.1). */
  requestPacket(pool: string, player: string): Promise<Uint8Array>;
  /** Build, sign and land `register` with the battles hash + packet. Resolves
   * with the confirmed signature (the reveal machine's `tx_confirmed`). */
  sendRegister(pool: string, battlesHash: Uint8Array, packet: Uint8Array): Promise<string>;
  /** 32 CSPRNG bytes (window.crypto in the browser; injected in tests). */
  randomBytes(n: number): Uint8Array;
  /** The device fingerprint (Privy, R19) — zeros until Phase 4 wires it. */
  deviceHash(): Promise<Uint8Array>;
}

export interface SubmitInput {
  pool: string;
  /** Hex, 32 bytes — `Pool.sealing_pubkey`. */
  sealingPubkeyHex: string;
  player: string;
  battles: readonly Allocation[];
  timingsMs: readonly number[];
}

export interface SubmitOutcome {
  signature: string;
  battlesHashHex: string;
}

const unhex = (s: string) => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export async function submitEntry(
  services: EntryServices,
  input: SubmitInput
): Promise<SubmitOutcome> {
  const salt = services.randomBytes(32);
  const payload = {
    battles: input.battles as never,
    salt,
    timingsMs: input.timingsMs,
    deviceHash: await services.deviceHash(),
  };
  // Throws unless the invariant holds — the last line of client defense.
  const payloadBytes = encodePayload(payload);
  const ciphertext = seal(payloadBytes, unhex(input.sealingPubkeyHex));
  const battlesHash = payloadBattlesHash(payload);

  // Ciphertext BEFORE money — see the interface doc.
  await services.putCiphertext(input.pool, input.player, ciphertext);
  const packet = await services.requestPacket(input.pool, input.player);
  const signature = await services.sendRegister(input.pool, battlesHash, packet);
  return { signature, battlesHashHex: hex(battlesHash) };
}
