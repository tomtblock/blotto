import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { submitEntry, type EntryServices } from './submit';
import { generateKeypair, sealOpen, decodePayload } from '@blotto/sealing';
import type { Allocation } from '@/battle/allocation';

const battles: Allocation[] = Array.from({ length: 7 }, (_, k) => {
  const a = [20, 20, 20, 20, 20];
  a[k % 5] += 3;
  a[(k + 1) % 5] -= 3;
  return a as unknown as Allocation;
});

function services(pool: ReturnType<typeof generateKeypair>) {
  const calls: string[] = [];
  const stored: Uint8Array[] = [];
  const svc: EntryServices = {
    async putCiphertext(_p, _w, c) {
      calls.push('ciphertext');
      stored.push(c);
    },
    async requestPacket() {
      calls.push('packet');
      return {
        message: new Uint8Array(85),
        signature: new Uint8Array(64),
        publicKey: new Uint8Array(32),
      };
    },
    async sendRegister(_p, h, packet) {
      calls.push('register');
      expect(h.length).toBe(32);
      expect(packet.message.length).toBe(85);
      return 'SIG';
    },
    randomBytes(n) {
      return new Uint8Array(createHash('sha256').update('salt').digest()).slice(0, n);
    },
    async deviceHash() {
      return new Uint8Array(32);
    },
  };
  return { svc, calls, stored, pool };
}

describe('submitEntry', () => {
  it('seals the exact payload the crank will decode, ciphertext before money', async () => {
    const pool = generateKeypair();
    const { svc, calls, stored } = services(pool);
    const out = await submitEntry(svc, {
      pool: 'POOL',
      sealingPubkeyHex: Buffer.from(pool.publicKey).toString('hex'),
      player: 'PLAYER',
      battles,
      timingsMs: [1, 2, 3, 4, 5, 6, 7],
    });
    expect(calls).toEqual(['ciphertext', 'packet', 'register']);
    expect(out.signature).toBe('SIG');
    // The crank can open and decode what the client sealed.
    const opened = sealOpen(stored[0], pool)!;
    const payload = decodePayload(opened);
    expect(payload.battles).toEqual(battles);
    expect(payload.timingsMs).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('refuses a malformed allocation before anything leaves the client', async () => {
    const pool = generateKeypair();
    const { svc, calls } = services(pool);
    const bad = battles.map((b) => [...b]) as unknown as Allocation[];
    (bad[0] as unknown as number[])[0] += 1; // sum 101
    await expect(
      submitEntry(svc, {
        pool: 'POOL',
        sealingPubkeyHex: Buffer.from(pool.publicKey).toString('hex'),
        player: 'PLAYER',
        battles: bad,
        timingsMs: [1, 2, 3, 4, 5, 6, 7],
      })
    ).rejects.toThrow('sum to exactly 100');
    expect(calls).toEqual([]); // nothing left the client
  });
});
