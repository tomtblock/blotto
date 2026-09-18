/**
 * THE SEAM TEST — the browser's sealed allocation, through the real HTTP
 * handler, out through the settlement crank's own read path.
 *
 * This is the test the 2026-09-11 audit said the repository most needed.
 * Every other suite exercises one side of this handoff: the packet route
 * suite used to read its ciphertext back through the writer's own key
 * transform, and the twenty-pool rehearsal writes to the store directly with
 * the reader's key. Both pass whether or not the two sides agree, which is
 * why a producer/consumer key mismatch survived 121 test files and shipped.
 *
 * So this suite deliberately crosses the seam. It writes the way a browser
 * writes — a POST body carrying the pool's PDA address — and reads the way
 * the crank reads, by calling `revealEntries` from `backend/reveal/src`. It
 * asserts on the scored output rather than on the stored bytes, because the
 * symptom of the original defect was not a missing row: it was a full field
 * silently scored as all losses.
 *
 * If this file ever needs a translation step between what it writes and what
 * it reads, that translation is the bug.
 */

import { expect } from 'chai';
import nacl from 'tweetnacl';
import { handleEntryRoute, type EntryServerDeps } from '../src/server';
import { MemoryPoolIdResolver } from '../src/pool-ids';
import { MemorySeatResolver } from '../src/seats';
import {
  MemoryCiphertextStore,
  encodePayload,
  generateKeypair,
  seal,
  type SealedPayload,
} from '../../sealing/src';
import { battlesHash, type BattleSet } from '../../scoring/src';
import { base58Encode } from '../src/shared';
import { ciphertextMessage } from '../src/ciphertext-message';
import { revealEntries } from '../../reveal/src/ranking';
import type { ChainEntryView } from '../../reveal/src/chain';

/** The pool's on-chain numeric id and its PDA address: two different values,
 * which is the whole point of this file. */
const POOL_ID = 12n;
const POOL_PDA = base58Encode(new Uint8Array(32).fill(4));

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** A wallet that can sign: the route proves ownership of the seat before it
 * accepts an allocation, so the seam test signs the way a browser does. */
function wallet() {
  const kp = nacl.sign.keyPair();
  const address = base58Encode(kp.publicKey);
  return {
    address,
    sign(pool: string, ciphertext: Uint8Array): string {
      const msg = ciphertextMessage(pool, address, ciphertext);
      return Buffer.from(nacl.sign.detached(msg, kp.secretKey)).toString('base64');
    },
  };
}

/** A legal allocation: five stats summing to exactly 100, seven battles. */
function battlesFor(seed: number): BattleSet {
  const one = [20 + seed, 20, 20, 20, 20 - seed] as const;
  return Array.from({ length: 7 }, () => [...one]) as unknown as BattleSet;
}

function payloadFor(seed: number): SealedPayload {
  return {
    battles: battlesFor(seed),
    salt: new Uint8Array(32).fill(seed + 1),
    timingsMs: Array.from({ length: 7 }, () => 1000 + seed),
    deviceHash: new Uint8Array(32).fill(200 + seed),
  };
}

/** Route deps with everything the ciphertext path needs and nothing it does not. */
function serverDeps(): EntryServerDeps {
  const poolIds = new MemoryPoolIdResolver();
  poolIds.set(POOL_PDA, POOL_ID);
  return {
    // The ciphertext route touches none of the issuance seam.
    packet: undefined as unknown as EntryServerDeps['packet'],
    ciphertexts: new MemoryCiphertextStore(),
    poolIds,
    seats: new MemorySeatResolver(),
    trustProxyHeader: false,
  };
}

describe('the entry seam: browser write → HTTP route → crank read', () => {
  it('a ciphertext posted with the pool ADDRESS is found by the crank, which reads by pool ID', async () => {
    const deps = serverDeps();
    const pool = generateKeypair();
    const players = [wallet(), wallet(), wallet()];

    // --- the browser half: seal, then POST exactly what the app POSTs ------
    const chainEntries: ChainEntryView[] = [];
    for (const [i, player] of players.entries()) {
      const payload = payloadFor(i);
      const sealed = seal(encodePayload(payload), pool.publicKey);
      const res = await handleEntryRoute(
        deps,
        'POST',
        '/ciphertexts',
        {
          pool: POOL_PDA, // the address — the only pool identifier a browser has
          player: player.address,
          ciphertext: Buffer.from(sealed).toString('base64'),
          signature: player.sign(POOL_PDA, sealed),
        },
        'ip'
      );
      expect(res.status, 'the route accepted the sealed allocation').to.equal(204);

      chainEntries.push({
        player: player.address,
        index: i,
        battlesHash: hex(battlesHash(payload.battles, payload.salt)),
        flagged: false,
        refunded: false,
        settled: false,
        forfeited: false,
        escrowLamports: 0n,
        sanctionsHold: false,
        escrowedAt: 0n,
      } as ChainEntryView);
    }

    // --- the crank half: read by the numeric pool id, decrypt, verify ------
    const revealed = await revealEntries(
      deps.ciphertexts,
      POOL_ID,
      pool.secretKey,
      chainEntries
    );

    // The assertion that matters. Before the fix this list held every player.
    expect(
      revealed.allLosses,
      'no entrant was scored all losses — the crank found every ciphertext'
    ).to.deep.equal([]);
    expect(revealed.scoringInput).to.have.length(players.length);
    for (const entry of revealed.scoringInput) {
      expect(entry.battles, 'the crank decrypted a real allocation').to.not.equal(null);
    }
    for (const entry of revealed.bundleEntries) {
      expect(entry.status).to.equal('ok');
    }
  });

  it('a pool the service cannot resolve is refused, not written under a guessed key', async () => {
    const deps = serverDeps();
    const pool = generateKeypair();
    const player = wallet();
    const sealed = seal(encodePayload(payloadFor(0)), pool.publicKey);
    const unknownPool = base58Encode(new Uint8Array(32).fill(99)); // never registered

    const res = await handleEntryRoute(
      deps,
      'POST',
      '/ciphertexts',
      {
        pool: unknownPool,
        player: player.address,
        ciphertext: Buffer.from(sealed).toString('base64'),
        signature: player.sign(unknownPool, sealed),
      },
      'ip'
    );

    expect(res.status).to.equal(400);
    // Nothing was written anywhere: not under the real id, not under any other.
    expect(await deps.ciphertexts.listForPool(POOL_ID)).to.have.length(0);
  });
});
