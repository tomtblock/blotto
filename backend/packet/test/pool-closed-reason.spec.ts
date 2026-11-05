/**
 * WHY A LATE ENTRANT IS REFUSED — "the pool filled" versus "the pool closed".
 *
 * Devnet pool 22 (battle-test/registry/pool-22.observation.md, Observation 4)
 * filled to 64 while a real person was still on the dials. They submitted, and
 * were correctly refused, having been charged nothing at all — but the sentence
 * they read hedged between two unrelated causes:
 *
 *   "either an earlier attempt from this wallet at this pool is the one that
 *    stands, or the pool stopped taking entries first"
 *
 * The server already knew which. It just said the same thing for both, so the
 * app could not tell them apart and had to cover itself. Meanwhile the sentence
 * written for exactly this case — "this pool filled before your entry reached
 * it" — had never been shown to anybody and, as the app was wired, never could
 * be: it hung off the on-chain error 6010 `PoolFull`, which cannot fire,
 * because `register.rs` checks the pool's STATE (6000 `PoolNotOpen`) before its
 * capacity, and a late entrant never reaches the chain in any case.
 *
 * So this suite pins the distinction at its source. A pool at capacity answers
 * one reason, a pool closed below capacity answers the other, and an overwrite
 * of a paid seat answers a third — three causes, three strings, and the route
 * is the only place that can tell them apart.
 *
 * Since the Ladder (D-E19) "capacity" is the POOL's own — 8, 16, 32 or 64 —
 * so eight seated is a full 8-player pool and a short 64-player one.
 *
 * It also pins the thing that must NOT change: none of these says anything
 * about the caller. The `/packet` refusal, which is where PID §8's generic-
 * refusal rule actually bites, is untouched and has its own suites.
 */

import { expect } from 'chai';
import nacl from 'tweetnacl';
import { acceptCiphertext } from '../src/ciphertexts';
import { MemoryPoolIdResolver, PgPoolIdResolver } from '../src/pool-ids';
import type { Queryable } from '../../_shared/src/db';
import { MemorySeatResolver } from '../src/seats';
import { MemoryCiphertextStore } from '../../sealing/src';
import { POOL_CAPACITIES } from '../../scoring/src/prizes';
import { base58Encode } from '../src/shared';
import { ciphertextMessage } from '../src/ciphertext-message';

const POOL_ID = 22n;
const POOL_PDA = base58Encode(new Uint8Array(32).fill(7));

/** 175 bytes is what a sealed allocation actually is; the route length-checks. */
const CIPHERTEXT_BYTES = 175;

function wallet() {
  const kp = nacl.sign.keyPair();
  const address = base58Encode(kp.publicKey);
  return {
    address,
    sign(pool: string, ciphertext: Uint8Array): string {
      return Buffer.from(
        nacl.sign.detached(ciphertextMessage(pool, address, ciphertext), kp.secretKey)
      ).toString('base64');
    },
  };
}

const bytes = (fill: number): Uint8Array => new Uint8Array(CIPHERTEXT_BYTES).fill(fill);

/** The largest pool, and the only size before the Ladder. */
const FULL_64 = 64;

/** Post one sealed allocation into a pool in the given state and seat count. */
async function post(
  state: string,
  entrants: number,
  opts: {
    player?: ReturnType<typeof wallet>;
    fill?: number;
    store?: MemoryCiphertextStore;
    capacity?: number;
  } = {}
) {
  const poolIds = new MemoryPoolIdResolver();
  poolIds.set(POOL_PDA, POOL_ID, state, entrants, 0, opts.capacity ?? FULL_64);
  const store = opts.store ?? new MemoryCiphertextStore();
  const player = opts.player ?? wallet();
  const ciphertext = bytes(opts.fill ?? 1);
  return {
    player,
    store,
    result: await acceptCiphertext(poolIds, new MemorySeatResolver(), store, {
      pool: POOL_PDA,
      player: player.address,
      ciphertext,
      signature: player.sign(POOL_PDA, ciphertext),
    }),
  };
}

describe('a late allocation is told WHY the pool would not take it', () => {
  it('a pool at capacity answers "pool filled" — the case pool 22 hit', async () => {
    const { result } = await post('Sealed', FULL_64);
    expect(result.status).to.equal(409);
    expect(result.body).to.deep.equal({ error: 'pool filled' });
  });

  it('every pool size fills at ITS OWN capacity, and only there (D-E19)', async () => {
    for (const capacity of POOL_CAPACITIES) {
      const full = await post('Sealed', capacity, { capacity });
      expect(full.result.body, `${capacity} of ${capacity}`).to.deep.equal({ error: 'pool filled' });
      const short = await post('Sealed', capacity - 1, { capacity });
      expect(short.result.body, `${capacity - 1} of ${capacity}`).to.deep.equal({
        error: 'pool closed to entries',
      });
    }
  });

  it('eight seated filled an 8-player pool, and did NOT fill a 64-player one', async () => {
    // The bug a single shared capacity would have: an 8-player pool's late
    // entrant told it "closed" when it filled, or a 64-player pool's told
    // it "filled" at eight.
    expect((await post('Sealed', 8, { capacity: 8 })).result.body).to.deep.equal({ error: 'pool filled' });
    expect((await post('Sealed', 8, { capacity: 64 })).result.body).to.deep.equal({
      error: 'pool closed to entries',
    });
  });

  it('every post-Open state says filled while the seats are full', async () => {
    // The player who was still playing when it filled may not submit until
    // after the crank has run. "It filled" is true at Sealed, Scored and Paid
    // alike, and is the answer they are owed at any of them.
    for (const state of ['Sealed', 'Scored', 'Paid']) {
      const { result } = await post(state, FULL_64);
      expect(result.body, state).to.deep.equal({ error: 'pool filled' });
    }
  });

  it('a pool closed BELOW capacity says so instead — it ran out of time, it did not fill', async () => {
    // A deadline seal at the minimum field, and a refund pool below it. Neither
    // filled, and telling either player "this pool filled" would be a lie.
    for (const entrants of [63, 40, 39, 0]) {
      const { result } = await post('Sealed', entrants);
      expect(result.status, `${entrants} seats`).to.equal(409);
      expect(result.body, `${entrants} seats`).to.deep.equal({
        error: 'pool closed to entries',
      });
    }
  });

  it('an OPEN pool at capacity is still accepted — the gate is the state, not the count', async () => {
    // Capacity alone must never refuse: the count only ever chooses the WORDING
    // of a refusal the state has already decided on. If this ever fails, the
    // seat count has become a gate of its own and the 64th honest entrant is
    // being turned away by the copy layer.
    const { result } = await post('Open', FULL_64);
    expect(result.status).to.equal(204);
    const small = await post('Open', 8, { capacity: 8 });
    expect(small.result.status).to.equal(204);
  });

  it('overwriting a PAID seat still answers "already sealed", and not a pool reason', async () => {
    const poolIds = new MemoryPoolIdResolver();
    poolIds.set(POOL_PDA, POOL_ID, 'Open', 10);
    const store = new MemoryCiphertextStore();
    const seats = new MemorySeatResolver();
    const player = wallet();

    const first = bytes(1);
    expect(
      (
        await acceptCiphertext(poolIds, seats, store, {
          pool: POOL_PDA,
          player: player.address,
          ciphertext: first,
          signature: player.sign(POOL_PDA, first),
        })
      ).status
    ).to.equal(204);

    seats.register(POOL_PDA, player.address);

    const second = bytes(2);
    const res = await acceptCiphertext(poolIds, seats, store, {
      pool: POOL_PDA,
      player: player.address,
      ciphertext: second,
      signature: player.sign(POOL_PDA, second),
    });
    expect(res.status).to.equal(409);
    expect(res.body).to.deep.equal({ error: 'already sealed' });
  });

  it('no refusal reason mentions the caller', async () => {
    // The reasons are facts about the POOL and about the caller's own seat —
    // never about their eligibility, which is the packet route's business and
    // stays generic there (PID §8). A reason that carried an address would be
    // a channel for exactly what that rule forbids.
    const cases = [
      await post('Sealed', FULL_64),
      await post('Sealed', 39),
    ];
    for (const { player, result } of cases) {
      expect(JSON.stringify(result.body)).to.not.contain(player.address);
      expect(JSON.stringify(result.body)).to.not.contain(POOL_PDA);
    }
  });
});

describe('the pool resolver reads each pool’s own capacity (D-E19)', () => {
  function resolverOver(row: Record<string, unknown> | null) {
    const issued: string[] = [];
    const db: Queryable = {
      async query(sql: string) {
        issued.push(sql);
        return { rows: row ? [row] : [] } as never;
      },
    };
    return { resolver: new PgPoolIdResolver(db), issued };
  }

  it('selects the capacity column with the rest of the pool facts', async () => {
    const { resolver, issued } = resolverOver({ id: '31', state: 'Sealed', entrants: '8', mode: 0, capacity: 8 });
    const facts = await resolver.lookup(POOL_PDA);
    expect(issued[0]).to.match(/\bcapacity\b/);
    expect(facts).to.deep.equal({ id: 31n, state: 'Sealed', entrants: 8, mode: 0, capacity: 8 });
  });

  it('reads a row without the column, or an unreadable one, as 64 — the only size before the Ladder', async () => {
    for (const capacity of [undefined, null, 0, 'x']) {
      const { resolver } = resolverOver({ id: '9', state: 'Sealed', entrants: '64', mode: 0, capacity });
      expect((await resolver.lookup(POOL_PDA))?.capacity, String(capacity)).to.equal(64);
    }
  });
});
