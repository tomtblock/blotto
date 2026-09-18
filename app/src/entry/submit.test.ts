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
  const devicePools: string[] = [];
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
    async deviceHash(forPool) {
      // B-40: the marker is asked for BY POOL. Recorded so the test can
      // prove the pool actually reaches the derivation.
      devicePools.push(forPool);
      return new Uint8Array(createHash('sha256').update(`device:${forPool}`).digest());
    },
  };
  return { svc, calls, stored, devicePools, pool };
}

describe('submitEntry', () => {
  it('asks permission, then seals, then pays — and seals what the crank decodes', async () => {
    const pool = generateKeypair();
    const { svc, calls, stored } = services(pool);
    const out = await submitEntry(svc, {
      pool: 'POOL',
      sealingPubkeyHex: Buffer.from(pool.publicKey).toString('hex'),
      player: 'PLAYER',
      battles,
      timingsMs: [1, 2, 3, 4, 5, 6, 7],
    });
    /*
     * The order is load-bearing in both directions (2026-09-18).
     *
     * `packet` first: a refusal — a dry signing quota, a blocked territory,
     * a stale terms version — must arrive BEFORE anything is stored.
     * Asking afterwards is what barred eleven devnet wallets from their
     * pools (DRIFT.md §H6), because a stored ciphertext could not be
     * replaced. Requesting a packet signs nothing and charges nothing.
     *
     * `ciphertext` still before `register`: a paid entry whose ciphertext
     * never landed is the lost-ciphertext failure mode, and that invariant
     * is unchanged.
     */
    expect(calls).toEqual(['packet', 'ciphertext', 'register']);
    expect(out.signature).toBe('SIG');
    // The crank can open and decode what the client sealed.
    const opened = sealOpen(stored[0], pool)!;
    const payload = decodePayload(opened);
    expect(payload.battles).toEqual(battles);
    expect(payload.timingsMs).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  /*
   * Audit 2026-09-11, B-40. The sealed payload's device marker used to be
   * one value per browser, the same in every pool, and it was published
   * verbatim in every reveal bundle — a permanent public link between every
   * wallet a browser had used. The marker is now derived per pool, and the
   * pool has to reach the derivation for that to be true.
   */
  it('seals a marker derived for THIS pool, never one shared across pools', async () => {
    const pool = generateKeypair();
    const sealingPubkeyHex = Buffer.from(pool.publicKey).toString('hex');
    const markerFor = async (poolAddress: string) => {
      const { svc, stored, devicePools } = services(pool);
      await submitEntry(svc, {
        pool: poolAddress,
        sealingPubkeyHex,
        player: 'PLAYER',
        battles,
        timingsMs: [1, 2, 3, 4, 5, 6, 7],
      });
      expect(devicePools).toEqual([poolAddress]);
      return decodePayload(sealOpen(stored[0], pool)!).deviceHash;
    };
    const a = await markerFor('POOL-A');
    const b = await markerFor('POOL-B');
    expect([...a]).not.toEqual([...b]);
    expect([...(await markerFor('POOL-A'))]).toEqual([...a]);
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
