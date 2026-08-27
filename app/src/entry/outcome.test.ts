/*
 * C9: submitForReveal resolves with the honest terminal state and NEVER
 * rejects. The confirmed path decodes the entry's own EntryRegistered from
 * the transaction's logs; a confirmed-but-unreadable outcome renders as
 * `outcome-unreadable` (recorded entry, no "try again"), and pre-broadcast
 * failures pass their classification through.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import type { TxRpc } from '@/tx/tx-rpc';
import { submitForReveal } from './outcome';
import { RegisterFailedError } from './services';
import type { EntryServices } from './submit';

const PLAYER = new PublicKey(createHash('sha256').update('player').digest()).toBase58();
const ASSET = new PublicKey(createHash('sha256').update('asset').digest()).toBase58();
const POOL_HASH = createHash('sha256').update('pool').digest();

function entryRegisteredLog(): string {
  const disc = createHash('sha256').update('event:EntryRegistered').digest().subarray(0, 8);
  const u16 = (v: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v);
    return b;
  };
  const body = Buffer.concat([
    POOL_HASH,
    new PublicKey(PLAYER).toBuffer(),
    u16(11),
    Buffer.alloc(32, 7),
    Buffer.from([4]),
    Buffer.alloc(32, 9),
    new PublicKey(ASSET).toBuffer(),
    u16(1),
  ]);
  return `Program data: ${Buffer.concat([disc, body]).toString('base64')}`;
}

function services(sendRegister: EntryServices['sendRegister']): EntryServices {
  return {
    async putCiphertext() {},
    async requestPacket() {
      return {
        message: new Uint8Array(85),
        signature: new Uint8Array(64),
        publicKey: new Uint8Array(32),
      };
    },
    sendRegister,
    randomBytes: (n) => new Uint8Array(n).fill(1),
    deviceHash: async () => new Uint8Array(32),
  };
}

const rpcWithLogs = (logs: readonly string[] | null): TxRpc =>
  ({
    async getTransaction() {
      return logs === null ? null : { slot: 1n, err: null, logMessages: logs };
    },
  }) as unknown as TxRpc;

// A valid five-stat allocation summing to 100, seven times over.
const battles = Array.from({ length: 7 }, () => [20, 20, 20, 20, 20]) as never;
const input = {
  pool: 'PoolAddr',
  sealingPubkeyHex: '11'.repeat(32),
  player: PLAYER,
  battles,
  timingsMs: [1, 2, 3, 4, 5, 6, 7],
};

describe('submitForReveal', () => {
  it('confirmed: yields the decoded class, seat and pass', async () => {
    const r = await submitForReveal(
      services(async () => 'SIG'),
      rpcWithLogs(['x', entryRegisteredLog()]),
      input
    );
    expect(r.kind).toBe('confirmed');
    if (r.kind === 'confirmed') {
      expect(r.outcome.class).toBe(4);
      expect(r.outcome.entryIndex).toBe(11);
      expect(r.outcome.asset).toBe(ASSET);
    }
  });

  it('confirmed but unreadable logs: outcome-unreadable, broadcast true', async () => {
    for (const logs of [null, [] as string[], ['Program log: nothing']]) {
      const r = await submitForReveal(services(async () => 'SIG'), rpcWithLogs(logs), input);
      expect(r.kind).toBe('failed');
      if (r.kind === 'failed') {
        expect(r.failure.kind).toBe('outcome-unreadable');
        expect(r.failure.broadcast).toBe(true);
      }
    }
  });

  it('a classified tx failure passes straight through', async () => {
    const failure = {
      kind: 'user-rejected' as const,
      message: 'declined',
      detail: 'wallet said no',
      broadcast: false,
    };
    const r = await submitForReveal(
      services(async () => {
        throw new RegisterFailedError(failure, null);
      }),
      rpcWithLogs(null),
      input
    );
    expect(r).toEqual({ kind: 'failed', failure });
  });

  it('a service throw becomes a non-broadcast rpc-failure, never a rejection', async () => {
    const r = await submitForReveal(
      services(async () => {
        throw new Error('entry unavailable');
      }),
      rpcWithLogs(null),
      input
    );
    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') {
      expect(r.failure.kind).toBe('rpc-failure');
      expect(r.failure.broadcast).toBe(false);
      expect(r.failure.detail).toContain('entry unavailable');
    }
  });
});
