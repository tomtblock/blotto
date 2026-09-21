/*
 * The client entry pipeline (roadmap 3.3/3.4, client side of TECH-ARCH §5):
 *
 *   confirmed battles + timings
 *     → 32-byte salt from the browser CSPRNG
 *     → canonical sealed payload (batteries from @blotto/sealing — the SAME
 *       encoding the crank decodes)
 *     → sealed-box encrypt to the pool's published key
 *     → obtain the entry packet (Ed25519-signed by the packet service — 4.1)
 *     → POST the ciphertext to the entry service
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
} from '@blotto/sealing';
import type { Allocation } from '@/battle/allocation';
import type { IssuedPacketBytes } from './register-tx';

export interface EntryServices {
  /** Store the sealed ciphertext (backend/sealing store). Must succeed BEFORE
   * the transaction: a paid entry whose ciphertext never landed is the lost-
   * ciphertext failure mode, so the order is ciphertext first, pay second.
   *
   * It is now also AFTER `requestPacket` — see the call order below. */
  putCiphertext(pool: string, player: string, ciphertext: Uint8Array): Promise<void>;
  /** Obtain the service-issued entry packet — message, signature and signer
   * key (the packet service, 4.1). All three feed the Ed25519 instruction. */
  requestPacket(pool: string, player: string): Promise<IssuedPacketBytes>;
  /** Build, sign and land `register` with the battles hash + packet. Resolves
   * with the confirmed signature (the reveal machine's `tx_confirmed`). */
  sendRegister(
    pool: string,
    battlesHash: Uint8Array,
    packet: IssuedPacketBytes
  ): Promise<string>;
  /** 32 CSPRNG bytes (window.crypto in the browser; injected in tests). */
  randomBytes(n: number): Uint8Array;
  /**
   * The device marker for THIS POOL (C11; R19 called it the Privy
   * fingerprint — see device.ts for why it is not). Takes the pool because
   * the value is derived per pool: the same browser entering two pools
   * produces two unrelated markers, so the published record can never link a
   * player's entries across tournaments (audit 2026-09-11, B-40). Same
   * browser, same pool, same marker — which is the whole of what the
   * detection signal reads.
   */
  deviceHash(pool: string): Promise<Uint8Array>;
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
    deviceHash: await services.deviceHash(input.pool),
  };
  // Throws unless the invariant holds — the last line of client defense.
  const payloadBytes = encodePayload(payload);
  const ciphertext = seal(payloadBytes, unhex(input.sealingPubkeyHex));
  const battlesHash = payloadBattlesHash(payload);

  /*
   * PERMISSION FIRST, THEN THE SEAL, THEN MONEY.
   *
   * The two invariants sit either side of the ciphertext write and both
   * hold here: the packet is only a permission — nothing is signed and
   * nothing is charged by requesting one — and the ciphertext still lands
   * BEFORE the transaction, so the lost-ciphertext failure mode is closed
   * exactly as it was.
   *
   * What the swap closes (2026-09-18): asking for permission AFTER sealing
   * meant every refusal arrived one step too late. The ciphertext was
   * already stored, and until the same day's backend fix a stored
   * ciphertext with no seat barred that wallet from the pool for good. The
   * signing quota that struck on 2026-09-16 is one cause of a refusal here;
   * a blocked territory, a stale terms version and an unreachable service
   * are others, and every one of them used to cost the player the pool.
   *
   * This does NOT close the window between the ciphertext write and the
   * register — a wallet prompt dismissed at that point still leaves a
   * stored ciphertext with no seat. That window is why the backend gate
   * asks whether the SEAT is registered rather than whether a ciphertext
   * exists (backend/packet/src/seats.ts). This is the narrowing; that is
   * the fix.
   */
  const packet = await services.requestPacket(input.pool, input.player);
  await services.putCiphertext(input.pool, input.player, ciphertext);
  const signature = await services.sendRegister(input.pool, battlesHash, packet);
  return { signature, battlesHashHex: hex(battlesHash) };
}
