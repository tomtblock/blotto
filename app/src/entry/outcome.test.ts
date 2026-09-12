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
import { EntryServiceError, RegisterFailedError } from './services';
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

/** A node that has confirmed the signature but cannot serve the
 * transaction yet — the ordinary lag D-34 is about. Answers `null` (or
 * throws) for the first `lagged` reads, then serves the logs. */
const laggingRpc = (lagged: number, mode: 'null' | 'throw' = 'null') => {
  let calls = 0;
  return {
    calls: () => calls,
    rpc: {
      async getTransaction() {
        calls++;
        if (calls <= lagged) {
          if (mode === 'throw') throw new Error('node behind');
          return null;
        }
        return { slot: 1n, err: null, logMessages: ['x', entryRegisteredLog()] };
      },
    } as unknown as TxRpc,
  };
};

/** No waiting in the suite: the retry's timing is not what is under test. */
const noSleep = { sleep: async () => {}, delayMs: 0 };

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
      const r = await submitForReveal(
        services(async () => 'SIG'),
        rpcWithLogs(logs),
        input,
        noSleep
      );
      expect(r.kind).toBe('failed');
      if (r.kind === 'failed') {
        expect(r.failure.kind).toBe('outcome-unreadable');
        expect(r.failure.broadcast).toBe(true);
        // The entry IS recorded: a retry would enter twice (PID §8.6).
        expect(r.failure.retryable).toBe(false);
      }
    }
  });

  it('a classified tx failure passes straight through', async () => {
    const failure = {
      kind: 'user-rejected' as const,
      message: 'declined',
      detail: 'wallet said no',
      broadcast: false,
      retryable: true,
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

  /*
   * D-34 (audit 2026-09-11): one getTransaction call, no retry. A node that
   * has confirmed the signature but not yet caught up cost the player the
   * class reveal they had just paid for.
   */
  describe('the post-confirmation outcome read (D-34)', () => {
    it('chases a lagging node instead of giving up on the first empty read', async () => {
      const { rpc, calls } = laggingRpc(3);
      const r = await submitForReveal(services(async () => 'SIG'), rpc, input, noSleep);
      expect(r.kind).toBe('confirmed');
      expect(calls()).toBe(4);
    });

    it('treats a THROWING read the same as an empty one — both mean "not yet"', async () => {
      const { rpc } = laggingRpc(2, 'throw');
      const r = await submitForReveal(services(async () => 'SIG'), rpc, input, noSleep);
      expect(r.kind).toBe('confirmed');
    });

    it('gives up after a bounded number of attempts, never loops for ever', async () => {
      let calls = 0;
      const never = {
        async getTransaction() {
          calls++;
          return null;
        },
      } as unknown as TxRpc;
      const r = await submitForReveal(services(async () => 'SIG'), never, input, {
        ...noSleep,
        attempts: 3,
      });
      expect(calls).toBe(3);
      expect(r.kind).toBe('failed');
      // The entry IS on-chain; the copy must still be the recovery one.
      if (r.kind === 'failed') expect(r.failure.kind).toBe('outcome-unreadable');
    });
  });

  /*
   * D-12 (audit 2026-09-11): every unenumerated entry failure — a
   * compliance refusal after the ninety-second run included — was reported
   * as a connection problem, with a retry that cannot work.
   */
  describe('an entry the service declined (D-12)', () => {
    const refusing = (status: number | null, stage: 'ciphertext' | 'packet' = 'packet') =>
      services(async () => {
        throw new EntryServiceError(stage, status, 'entry unavailable');
      });

    it('is entry-refused, with no retry offered', async () => {
      for (const status of [400, 403, 409, 429]) {
        const r = await submitForReveal(refusing(status), rpcWithLogs(null), input, noSleep);
        expect(r.kind).toBe('failed');
        if (r.kind === 'failed') {
          expect(r.failure.kind, String(status)).toBe('entry-refused');
          expect(r.failure.retryable).toBe(false);
          expect(r.failure.broadcast).toBe(false);
          // Not the connection sentence, which is what it used to say.
          expect(r.failure.message).not.toMatch(/connection/i);
        }
      }
    });

    it('a service that is DOWN or unreachable is still an honest connection failure', async () => {
      for (const status of [500, 502, 503, null]) {
        const r = await submitForReveal(refusing(status), rpcWithLogs(null), input, noSleep);
        expect(r.kind).toBe('failed');
        if (r.kind === 'failed') {
          expect(r.failure.kind, String(status)).toBe('rpc-failure');
          expect(r.failure.retryable).toBe(true);
        }
      }
    });

    it('holds for the ciphertext store too, not only the packet endpoint', async () => {
      const r = await submitForReveal(refusing(409, 'ciphertext'), rpcWithLogs(null), input, noSleep);
      expect(r.kind).toBe('failed');
      if (r.kind === 'failed') expect(r.failure.kind).toBe('entry-refused');
    });
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
