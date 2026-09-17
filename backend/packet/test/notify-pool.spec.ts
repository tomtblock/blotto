/** The one-message opt-in, v2 (round four, 2026-09-17): signature-verified,
 * skew-bounded, monotonic, per pool and WITH the address — and the
 * dispatcher that sends once the pool is done and drops the address. */
import { expect } from 'chai';
import nacl from 'tweetnacl';

import {
  MemoryPoolNotifyStore,
  NOTIFY_POOL_MAX_SKEW_SECONDS,
  acceptPoolNotify,
  composePoolMessage,
  notifyPoolMessage,
  runNotifyDispatch,
  type PoolStateFacts,
} from '../src/notify-pool';
import { MemoryEmailSender, maskAddress } from '../src/email-sender';
import { base58Encode } from '../src/shared';

const kp = nacl.sign.keyPair();
const WALLET = base58Encode(kp.publicKey);
const POOL_A = base58Encode(new Uint8Array(32).fill(1));
const POOL_B = base58Encode(new Uint8Array(32).fill(2));
const POOL_C = base58Encode(new Uint8Array(32).fill(3));
const NOW = 1_758_000_000n;

function signed(pool: string, email: string, atUnix: bigint, key = kp.secretKey) {
  const sig = nacl.sign.detached(notifyPoolMessage(WALLET, pool, email, atUnix), key);
  return { wallet: WALLET, pool, email, atUnix, signature: Buffer.from(sig).toString('base64') };
}

describe('notify v2 — the opt-in', () => {
  it('stores a verified choice, trimmed, and serves it back unsent', async () => {
    const store = new MemoryPoolNotifyStore();
    expect(await acceptPoolNotify(store, () => NOW, signed(POOL_A, 'tom@example.com', NOW))).to.equal(true);
    const rec = await store.get(POOL_A, WALLET);
    expect(rec?.email).to.equal('tom@example.com');
    expect(rec?.timestamp).to.equal(NOW);
    expect(rec?.sentAt).to.equal(null);
  });

  it('rejects a foreign key, a tampered address and a tampered pool', async () => {
    const store = new MemoryPoolNotifyStore();
    const other = nacl.sign.keyPair();
    expect(await acceptPoolNotify(store, () => NOW, signed(POOL_A, 'a@b.co', NOW, other.secretKey))).to.equal(false);
    expect(await acceptPoolNotify(store, () => NOW, { ...signed(POOL_A, 'a@b.co', NOW), email: 'x@b.co' })).to.equal(false);
    expect(await acceptPoolNotify(store, () => NOW, { ...signed(POOL_A, 'a@b.co', NOW), pool: POOL_B })).to.equal(false);
    expect(await store.get(POOL_A, WALLET)).to.equal(null);
  });

  it('refuses an address with no shape and a pool that is not a key, before verifying anything', async () => {
    const store = new MemoryPoolNotifyStore();
    expect(await acceptPoolNotify(store, () => NOW, signed(POOL_A, 'not an address', NOW))).to.equal(false);
    expect(await acceptPoolNotify(store, () => NOW, { ...signed('short', 'a@b.co', NOW), pool: 'short' })).to.equal(false);
  });

  it('rejects a message outside the skew window', async () => {
    const store = new MemoryPoolNotifyStore();
    const stale = NOW - NOTIFY_POOL_MAX_SKEW_SECONDS - 1n;
    expect(await acceptPoolNotify(store, () => NOW, signed(POOL_A, 'a@b.co', stale))).to.equal(false);
  });

  it('never lets an older captured message overwrite a newer choice; a newer one replaces and reopens', async () => {
    const store = new MemoryPoolNotifyStore();
    expect(await acceptPoolNotify(store, () => NOW, signed(POOL_A, 'first@b.co', NOW))).to.equal(true);
    expect(await acceptPoolNotify(store, () => NOW, signed(POOL_A, 'older@b.co', NOW - 60n))).to.equal(false);
    expect((await store.get(POOL_A, WALLET))?.email).to.equal('first@b.co');
    await store.markSent(POOL_A, WALLET, new Date());
    expect(await acceptPoolNotify(store, () => NOW + 5n, signed(POOL_A, 'again@b.co', NOW + 5n))).to.equal(true);
    const rec = await store.get(POOL_A, WALLET);
    expect(rec?.email).to.equal('again@b.co');
    expect(rec?.sentAt).to.equal(null);
  });

  it('is per pool: the same wallet holds one choice per pool', async () => {
    const store = new MemoryPoolNotifyStore();
    expect(await acceptPoolNotify(store, () => NOW, signed(POOL_A, 'a@b.co', NOW))).to.equal(true);
    expect(await acceptPoolNotify(store, () => NOW, signed(POOL_B, 'a@b.co', NOW))).to.equal(true);
    expect((await store.pending()).map((r) => r.pool).sort()).to.deep.equal([POOL_A, POOL_B].sort());
  });
});

function reader(states: Record<string, PoolStateFacts>) {
  return {
    states: async (pools: readonly string[]) => {
      const m = new Map<string, PoolStateFacts>();
      for (const p of pools) if (states[p]) m.set(p, states[p]);
      return m;
    },
  };
}

describe('notify v2 — the dispatcher', () => {
  async function seeded() {
    const store = new MemoryPoolNotifyStore();
    for (const pool of [POOL_A, POOL_B, POOL_C]) {
      expect(await acceptPoolNotify(store, () => NOW, signed(pool, 'tom@example.com', NOW))).to.equal(true);
    }
    return store;
  }

  it('sends for pools that are done, waits on the rest, and strips the address once sent', async () => {
    const store = await seeded();
    const sender = new MemoryEmailSender();
    const log: string[] = [];
    const out = await runNotifyDispatch({
      store,
      pools: reader({ [POOL_A]: { id: '16', state: 'Paid' }, [POOL_B]: { id: '17', state: 'Open' }, [POOL_C]: { id: '15', state: 'Closed' } }),
      sender,
      poolPageUrl: (pool) => `https://www.blotto.gg/pools/${pool}`,
      now: () => new Date('2026-09-17T03:00:00Z'),
      log: (l) => log.push(l),
    });
    expect(out).to.deep.equal({ sent: 2, waiting: 1, failed: 0 });
    expect(sender.sent.map((m) => m.subject).sort()).to.deep.equal(['Pool #15 has finished', 'Pool #16 has finished']);
    expect(sender.sent.every((m) => m.to === 'tom@example.com')).to.equal(true);
    expect(sender.sent.find((m) => m.subject.includes('16'))?.text).to.include(`https://www.blotto.gg/pools/${POOL_A}`);
    expect((await store.get(POOL_A, WALLET))?.email).to.equal(null);
    expect((await store.get(POOL_A, WALLET))?.sentAt?.toISOString()).to.equal('2026-09-17T03:00:00.000Z');
    expect((await store.get(POOL_B, WALLET))?.email).to.equal('tom@example.com');
    // No log line ever carries the address.
    expect(log.length).to.equal(2);
    for (const line of log) {
      expect(line).to.not.include('tom@example.com');
      expect(line).to.include('t***@example.com');
    }
  });

  it('a second pass sends nothing for what already went', async () => {
    const store = await seeded();
    const sender = new MemoryEmailSender();
    const deps = {
      store,
      pools: reader({ [POOL_A]: { id: '16', state: 'Paid' }, [POOL_B]: { id: '17', state: 'Paid' }, [POOL_C]: { id: '15', state: 'Paid' } }),
      sender,
      poolPageUrl: (pool: string) => `https://www.blotto.gg/pools/${pool}`,
      now: () => new Date(),
    };
    expect((await runNotifyDispatch(deps)).sent).to.equal(3);
    expect((await runNotifyDispatch(deps)).sent).to.equal(0);
    expect(sender.sent.length).to.equal(3);
  });

  it('a provider failure leaves the row pending, address intact, for the next pass', async () => {
    const store = await seeded();
    const sender = new MemoryEmailSender();
    sender.failing = true;
    const deps = {
      store,
      pools: reader({ [POOL_A]: { id: '16', state: 'Paid' } }),
      sender,
      poolPageUrl: (pool: string) => `https://www.blotto.gg/pools/${pool}`,
      now: () => new Date(),
    };
    const first = await runNotifyDispatch(deps);
    expect(first.failed).to.equal(1);
    expect(first.waiting).to.equal(2);
    expect((await store.get(POOL_A, WALLET))?.email).to.equal('tom@example.com');
    sender.failing = false;
    expect((await runNotifyDispatch(deps)).sent).to.equal(1);
    expect((await store.get(POOL_A, WALLET))?.email).to.equal(null);
  });

  it('a pool the indexer does not know yet waits', async () => {
    const store = await seeded();
    const sender = new MemoryEmailSender();
    const out = await runNotifyDispatch({
      store,
      pools: reader({}),
      sender,
      poolPageUrl: (pool) => `https://www.blotto.gg/pools/${pool}`,
      now: () => new Date(),
    });
    expect(out).to.deep.equal({ sent: 0, waiting: 3, failed: 0 });
    expect(sender.sent.length).to.equal(0);
  });

  it('the message says paid or closed, names the pool, and carries one link', () => {
    const paid = composePoolMessage({ id: '16', state: 'Paid' }, 'https://www.blotto.gg/pools/x');
    expect(paid.subject).to.equal('Pool #16 has finished');
    expect(paid.text).to.include('prizes are paid');
    expect(paid.text).to.include('https://www.blotto.gg/pools/x');
    expect(paid.text).to.include('deleted the moment it was sent');
    const closed = composePoolMessage({ id: null, state: 'Closed' }, 'https://www.blotto.gg/pools/y');
    expect(closed.subject).to.equal('Your pool has finished');
    expect(closed.text).to.include('refunded in full');
  });

  it('masks an address for logs', () => {
    expect(maskAddress('tom@example.com')).to.equal('t***@example.com');
    expect(maskAddress('nonsense')).to.equal('***');
  });
});
