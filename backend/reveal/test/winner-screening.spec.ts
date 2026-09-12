/**
 * The winner check (Phase 2, Stage F).
 *
 * Two levels, because the promise has two halves. The unit tests pin what
 * `makeWinnerScreen` decides from a verdict; the crank test proves the
 * decision reaches the chain — a listed winner's share is ESCROWED and not a
 * lamport moves, while everyone else in the pool is paid normally and the
 * pool still reaches `Paid`.
 */
import { expect } from 'chai';
import { createHash } from 'crypto';
import { crankPool, FakeChain, MemoryPublisher, makeWinnerScreen, type FakeEntry } from '../src';
import {
  LocalCustody,
  MemoryCiphertextStore,
  encodePayload,
  seal,
  type SealedPayload,
} from '../../sealing/src';
import { StubSanctionsCheck, type SanctionsCheck } from '../../sanctions/src';
import { battlesHash, potForTier, type BattleSet } from '../../scoring/src';
import { base58Encode } from '../../_shared/src/blotto-events';

const sha = (s: string) => new Uint8Array(createHash('sha256').update(s).digest());
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

function alloc(i: number): number[] {
  const h = sha(`alloc:${i}`);
  const d = [0, 1, 2, 3].map((k) => (h[k * 2] | (h[k * 2 + 1] << 8)) % 101).sort((a, b) => a - b);
  return [d[0], d[1] - d[0], d[2] - d[1], d[3] - d[2], 100 - d[3]];
}
function battlesFor(base: number): BattleSet {
  return Array.from({ length: 7 }, (_, k) => alloc(base + k)) as never;
}

/** A sealed 64-entry pool, ready to crank. */
async function sealedPool() {
  const chain = new FakeChain();
  const custody = new LocalCustody(async (id) => (await chain.getPool(id)).state !== 'Open');
  const store = new MemoryCiphertextStore();
  const publisher = new MemoryPublisher();
  const { publicKey } = await custody.createPoolKey(1n);
  const players: string[] = [];
  const entries: FakeEntry[] = [];

  for (let i = 0; i < 64; i++) {
    const player = base58Encode(sha(`player:${i}`));
    players.push(player);
    const payload: SealedPayload = {
      battles: battlesFor(i * 100),
      salt: sha(`salt:${i}`),
      timingsMs: [1000, 2000, 3000, 4000, 5000, 6000, 7000],
      deviceHash: sha(`device:${i}`),
    };
    entries.push({
      player,
      index: i,
      battlesHash: hex(battlesHash(payload.battles, payload.salt)),
      flagged: false,
      refunded: false,
      settled: false,
      forfeited: false,
    });
    await store.put(1n, player, seal(encodePayload(payload), publicKey));
  }

  chain.pools.set('1', {
    poolId: 1n,
    tier: 0,
    state: 'Sealed',
    resultsRootHex: null,
    vrfCommitted: true,
    entryLamports: 100_000_000n,
    potLamports: potForTier(0),
    fillDeadline: 0n,
    secretRevealed: false,
    resultsCommitted: false,
    paidMask: 0n,
    payouts: [],
    entrants: 64,
  });
  chain.entries.set('1', entries);
  return { chain, custody, store, publisher, players };
}

/** A screener that always throws — the "we could not check" path. */
const brokenCheck: SanctionsCheck = {
  async screen() {
    throw new Error('every configured source failed');
  },
};

describe('the winner check (Stage F)', () => {
  describe('what a verdict decides', () => {
    it('holds a listed wallet and names the list that matched', async () => {
      const screen = makeWinnerScreen(new StubSanctionsCheck(['LISTED']));
      const holds = await screen(1n, ['LISTED', 'CLEAN']);
      expect(holds).to.have.length(1);
      expect(holds[0].player).to.equal('LISTED');
      expect(holds[0].reason).to.equal('listed');
      expect(holds[0].matches[0].source).to.equal('stub');
    });

    it('holds nobody when nobody is listed', async () => {
      const screen = makeWinnerScreen(new StubSanctionsCheck([]));
      expect(await screen(1n, ['A', 'B', 'C'])).to.deep.equal([]);
    });

    it('a screening that cannot answer HOLDS, and says it is not a match', async () => {
      const screen = makeWinnerScreen(brokenCheck);
      const holds = await screen(1n, ['A']);
      expect(holds).to.have.length(1);
      expect(holds[0].reason).to.equal('screening_unavailable');
      expect(holds[0].matches).to.deep.equal([]);
      expect(holds[0].error).to.contain('every configured source failed');
    });

    it('one wallet failing does not decide for the others', async () => {
      let n = 0;
      const flaky: SanctionsCheck = {
        async screen(address) {
          if (n++ === 0) throw new Error('timeout');
          return {
            address,
            listed: false,
            matches: [],
            consulted: ['stub'],
            failed: [],
            checkedAt: '2026-09-07T00:00:00.000Z',
          };
        },
      };
      const holds = await makeWinnerScreen(flaky)(1n, ['A', 'B']);
      expect(holds.map((h) => h.player)).to.deep.equal(['A']);
    });

    it('carries no risk score — a match has no field that could hold one', async () => {
      const screen = makeWinnerScreen(new StubSanctionsCheck(['LISTED']));
      const [hold] = await screen(1n, ['LISTED']);
      expect(Object.keys(hold.matches[0]).sort()).to.deep.equal(
        ['addressMatched', 'entityName', 'listName', 'source'].sort()
      );
    });
  });

  describe('through the crank, to the chain', () => {
    it('a listed winner is ESCROWED, never paid, and the pool still reaches Paid', async function () {
      this.timeout(30000);
      const t = await sealedPool();

      // Learn who wins by cranking a probe world with no screening at all.
      const probe = await sealedPool();
      await crankPool(
        {
          chain: probe.chain,
          custody: probe.custody,
          ciphertexts: probe.store,
          publisher: probe.publisher,
        },
        1n
      );
      const winners = [...probe.chain.paid.keys()];
      expect(winners, 'the probe pool paid somebody').to.not.be.empty;
      const winner = winners[0];

      const outcome = await crankPool(
        {
          chain: t.chain,
          custody: t.custody,
          ciphertexts: t.store,
          publisher: t.publisher,
          screenWinners: makeWinnerScreen(new StubSanctionsCheck([winner])),
        },
        1n
      );

      expect(outcome.finalState, 'one held wallet must not strand the pool').to.equal('Paid');
      expect(t.chain.sanctionsHeld.has(winner)).to.equal(true);
      expect(t.chain.paid.get(winner) ?? 0n, 'not a lamport to a listed wallet').to.equal(0n);
      expect(t.chain.escrowed.get(winner)).to.equal(probe.chain.paid.get(winner));
      // And it is NOT a flag: nothing about a list is a finding about play.
      const entry = (await t.chain.getEntries(1n)).find((e) => e.player === winner)!;
      expect(entry.flagged).to.equal(false);
      expect(entry.settled).to.equal(true);

      // Every other winner in the same committed list was paid normally.
      for (const [p, amount] of probe.chain.paid) {
        if (p === winner) continue;
        expect(t.chain.paid.get(p)).to.equal(amount);
      }
    });

    it('an unlisted winner is paid exactly as if there were no screening', async function () {
      this.timeout(30000);
      const t = await sealedPool();
      const probe = await sealedPool();
      await crankPool(
        {
          chain: probe.chain,
          custody: probe.custody,
          ciphertexts: probe.store,
          publisher: probe.publisher,
        },
        1n
      );
      await crankPool(
        {
          chain: t.chain,
          custody: t.custody,
          ciphertexts: t.store,
          publisher: t.publisher,
          screenWinners: makeWinnerScreen(new StubSanctionsCheck([])),
        },
        1n
      );
      expect(t.chain.sanctionsHeld.size).to.equal(0);
      expect([...t.chain.paid.entries()]).to.deep.equal([...probe.chain.paid.entries()]);
    });

    it('a screener that cannot answer stops the settlement rather than paying unscreened', async function () {
      this.timeout(30000);
      // 2026-09-12: this used to assert that an unanswerable screener placed
      // an on-chain HOLD. Failing closed was right; making the closure
      // permanent was not. A hold is one boolean, so the chain could not
      // tell a vendor outage from a list match, and every release path
      // refuses while it is set — a legitimate winner's whole share sat
      // behind an admin lift nobody was told to raise (audit C-02).
      //
      // The promise this test exists to protect is unchanged and still
      // asserted below: NOBODY IS PAID UNSCREENED. What changed is that the
      // refusal is now retryable, and leaves nothing on chain to unwind.
      const t = await sealedPool();
      let threw: Error | null = null;
      try {
        await crankPool(
          {
            chain: t.chain,
            custody: t.custody,
            ciphertexts: t.store,
            publisher: t.publisher,
            screenWinners: makeWinnerScreen(brokenCheck),
          },
          1n
        );
      } catch (e) {
        threw = e as Error;
      }
      expect(threw, 'the crank refuses to settle on an outage').to.not.equal(null);
      expect(threw!.message).to.match(/could not answer/);
      expect(t.chain.paid.size, 'nobody is paid unscreened').to.equal(0);
      expect(t.chain.sanctionsHeld.size, 'and no hold was recorded for an outage').to.equal(0);
    });

    it('a resumed crank does not place a hold twice', async function () {
      this.timeout(30000);
      const t = await sealedPool();
      const probe = await sealedPool();
      await crankPool(
        {
          chain: probe.chain,
          custody: probe.custody,
          ciphertexts: probe.store,
          publisher: probe.publisher,
        },
        1n
      );
      const winner = [...probe.chain.paid.keys()][0];
      const deps = {
        chain: t.chain,
        custody: t.custody,
        ciphertexts: t.store,
        publisher: t.publisher,
        screenWinners: makeWinnerScreen(new StubSanctionsCheck([winner])),
      };
      await crankPool(deps, 1n);
      // The program refuses a second placement; the crank must see the hold
      // it already placed and skip it rather than crash the whole pass.
      const again = await crankPool(deps, 1n);
      expect(again.finalState).to.equal('Paid');
      expect(again.stepsTaken).to.include('sanctions_hold:already');
    });
  });
});
