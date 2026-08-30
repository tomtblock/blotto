/*
 * The browser EntryServices factory — the wiring play-client.tsx carries
 * inline, exported so the arena's create phase submits through the
 * IDENTICAL pipeline (one sealed-submit path; a second one could drift).
 *
 * PHASE-3-REVIEW posture unchanged: packet + register surface a clear
 * "entry service not configured" until the Phase 4 packet service and the
 * Phase 5 devnet rehearsal land — an honest failure, never a pretend
 * submit.
 */

import type { EntryServices } from './submit';

export function browserServices(): EntryServices {
  const base = process.env.NEXT_PUBLIC_ENTRY_API_URL;
  const need = (): never => {
    throw new Error('entry service not configured (NEXT_PUBLIC_ENTRY_API_URL)');
  };
  return {
    async putCiphertext(pool, player, ciphertext) {
      if (!base) need();
      const res = await fetch(`${base}/ciphertexts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pool,
          player,
          ciphertext: Buffer.from(ciphertext).toString('base64'),
        }),
      });
      if (!res.ok) throw new Error(`ciphertext store: ${res.status}`);
    },
    async requestPacket() {
      // Phase 4 (roadmap 4.1) — the packet service issues this.
      return need();
    },
    async sendRegister() {
      // Phase 5 wires the carried tx seam against devnet.
      return need();
    },
    randomBytes(n) {
      const out = new Uint8Array(n);
      crypto.getRandomValues(out);
      return out;
    },
    async deviceHash() {
      // R19: the Privy device fingerprint — wired in Phase 4 with detection.
      return new Uint8Array(32);
    },
  };
}
