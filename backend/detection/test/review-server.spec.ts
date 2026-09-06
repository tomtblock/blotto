/**
 * C10 specs: the review HTTP service. Real Ed25519 signatures throughout
 * (tweetnacl keypairs) — the auth layer is exercised with genuine
 * signatures, wrong keys, tampered fields and stale timestamps, and the
 * route's contract is pinned: apply-then-log, one uniform 401, a chain
 * refusal logs nothing.
 */
import { expect } from 'chai';
import nacl from 'tweetnacl';
import { base58Encode } from '../../_shared/src/blotto-events';
import {
  MemoryDecisionLog,
  canonicalReviewMessage,
  handleReviewRoute,
  parseReviewerRegistry,
  reviewActionsFromChain,
  verifyReviewSubmission,
  type Decision,
  type ReviewActions,
  type ReviewerRegistry,
} from '../src';

const NOW = Date.parse('2026-08-27T12:00:00Z');

interface Reviewer {
  keys: nacl.SignKeyPair;
  wallet: string;
}

function reviewer(seed: string): Reviewer {
  const keys = nacl.sign.keyPair.fromSeed(
    new TextEncoder().encode(seed.padEnd(32, '.')).slice(0, 32)
  );
  return { keys, wallet: base58Encode(keys.publicKey) };
}

const POOL = base58Encode(new Uint8Array(32).fill(3));
const PLAYER = base58Encode(new Uint8Array(32).fill(4));

function signedDecision(
  r: Reviewer,
  overrides: Partial<Decision> = {},
  tamper: Partial<Decision> = {}
): Decision {
  const base: Decision = {
    pool: POOL,
    player: PLAYER,
    action: 'clear',
    criterion: 'timings human on inspection',
    decidedBy: r.wallet,
    decidedAt: new Date(NOW).toISOString(),
    signature: '',
    ...overrides,
  };
  const signature = nacl.sign.detached(
    canonicalReviewMessage({
      pool: base.pool,
      player: base.player,
      action: base.action,
      criterion: base.criterion,
      signedAt: base.decidedAt,
    }),
    r.keys.secretKey
  );
  return { ...base, signature: Buffer.from(signature).toString('base64'), ...tamper };
}

function registryOf(...reviewers: Reviewer[]): ReviewerRegistry {
  return { version: 1, members: reviewers.map((r) => r.wallet), updated: '2026-08-27' };
}

function fakeActions(calls: string[], fail = false): ReviewActions {
  const rec = (name: string) => async (_p: string, w: string) => {
    if (fail) throw new Error('chain refused');
    calls.push(`${name}:${w}`);
  };
  return {
    flagEntry: rec('flag'),
    clearFlag: rec('clear'),
    releaseEscrow: rec('release'),
    forfeitEscrow: rec('forfeit'),
  };
}

describe('the reviewer registry (config/reviewers.json)', () => {
  it('parses the committed config and rejects malformations', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const committed = require('../../../config/reviewers.json');
    const parsed = parseReviewerRegistry(committed);
    // This asserted `members` was EMPTY while the file shipped unconfigured.
    // The founder ratified the devnet reviewer on 2026-09-06, so emptiness was
    // a moment in time rather than an invariant, and pinning it turned a
    // founder-owned config change into a CI failure. What IS invariant is that
    // the committed file survives the parser: a typo'd or non-base58 key makes
    // `parseReviewerRegistry` throw, and this test fails, which is the guard
    // worth having. Whether the list is empty is the founder's call, and the
    // service already logs loudly at startup when it is.
    expect(parsed.members).to.be.an('array');
    for (const member of parsed.members) {
      expect(member).to.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    }
    expect(parsed.version).to.be.at.least(1);
    expect(() => parseReviewerRegistry({ version: 1 })).to.throw(/malformed/);
    expect(() =>
      parseReviewerRegistry({ version: 1, members: ['not base58!!'], updated: 'x' })
    ).to.throw(/malformed/);
  });
});

describe('verifyReviewSubmission', () => {
  const alice = reviewer('alice');
  const mallory = reviewer('mallory');
  const registry = registryOf(alice);

  it('accepts a member’s fresh, genuine signature', () => {
    expect(verifyReviewSubmission(registry, signedDecision(alice), NOW)).to.equal(true);
  });

  it('refuses a non-member even with a valid signature', () => {
    expect(verifyReviewSubmission(registry, signedDecision(mallory), NOW)).to.equal(false);
  });

  it('refuses a signature claiming someone else’s key', () => {
    const forged = signedDecision(mallory, { decidedBy: alice.wallet });
    expect(verifyReviewSubmission(registry, forged, NOW)).to.equal(false);
  });

  it('refuses any tampered field', () => {
    for (const tamper of [
      { player: base58Encode(new Uint8Array(32).fill(9)) },
      { action: 'forfeit' as const },
      { criterion: 'different criterion' },
    ]) {
      expect(
        verifyReviewSubmission(registry, signedDecision(alice, {}, tamper), NOW)
      ).to.equal(false);
    }
  });

  it('refuses outside the freshness window, either direction', () => {
    const d = signedDecision(alice);
    expect(verifyReviewSubmission(registry, d, NOW + 6 * 60 * 1000)).to.equal(false);
    expect(verifyReviewSubmission(registry, d, NOW - 6 * 60 * 1000)).to.equal(false);
    expect(verifyReviewSubmission(registry, d, NOW + 4 * 60 * 1000)).to.equal(true);
  });

  it('an empty member list verifies nothing (fail-closed launch state)', () => {
    expect(
      verifyReviewSubmission({ version: 1, members: [], updated: 'x' }, signedDecision(alice), NOW)
    ).to.equal(false);
  });
});

describe('POST /decisions', () => {
  const alice = reviewer('alice');

  function deps(calls: string[], failChain = false) {
    return {
      registry: registryOf(alice),
      actions: fakeActions(calls, failChain),
      log: new MemoryDecisionLog(),
      now: () => NOW,
    };
  }

  it('applies the chain action THEN logs, and answers 204', async () => {
    const calls: string[] = [];
    const d = deps(calls);
    const res = await handleReviewRoute(d, 'POST', '/decisions', signedDecision(alice));
    expect(res.status).to.equal(204);
    expect(calls).to.deep.equal([`clear:${PLAYER}`]);
    const rows = await d.log.list(POOL);
    expect(rows.length).to.equal(1);
    expect(rows[0].decidedBy).to.equal(alice.wallet);
    expect(rows[0].signature).to.equal(signedDecision(alice).signature);
  });

  it('answers one uniform 401 for non-member, forged and stale alike', async () => {
    const calls: string[] = [];
    const d = deps(calls);
    const mallory = reviewer('mallory');
    for (const body of [
      signedDecision(mallory),
      signedDecision(mallory, { decidedBy: alice.wallet }),
      signedDecision(alice, { decidedAt: new Date(NOW - 10 * 60 * 1000).toISOString() }),
    ]) {
      const res = await handleReviewRoute(d, 'POST', '/decisions', body);
      expect(res.status).to.equal(401);
      expect(res.body).to.deep.equal({ error: 'unauthorized' });
    }
    expect(calls).to.deep.equal([]);
    expect(await d.log.list(POOL)).to.deep.equal([]);
  });

  it('rejects malformed bodies with 400 before any verification', async () => {
    const d = deps([]);
    for (const body of [
      null,
      {},
      signedDecision(alice, { action: 'nuke' as never }),
      signedDecision(alice, { criterion: '' }),
      { ...signedDecision(alice), pool: 'not-base58!' },
    ]) {
      expect((await handleReviewRoute(d, 'POST', '/decisions', body)).status).to.equal(400);
    }
  });

  it('a chain refusal answers 502 and logs NOTHING', async () => {
    const d = deps([], true);
    const res = await handleReviewRoute(d, 'POST', '/decisions', signedDecision(alice));
    expect(res.status).to.equal(502);
    expect(await d.log.list(POOL)).to.deep.equal([]);
  });

  it('GET /decisions?pool= lists the pool’s log; unknown routes 404', async () => {
    const calls: string[] = [];
    const d = deps(calls);
    await handleReviewRoute(d, 'POST', '/decisions', signedDecision(alice));
    const res = await handleReviewRoute(d, 'GET', `/decisions?pool=${POOL}`, null);
    expect(res.status).to.equal(200);
    expect((res.body as { decisions: Decision[] }).decisions.length).to.equal(1);
    expect((await handleReviewRoute(d, 'GET', '/decisions', null)).status).to.equal(400);
    expect((await handleReviewRoute(d, 'PUT', '/decisions', null)).status).to.equal(405);
    expect((await handleReviewRoute(d, 'GET', '/other', null)).status).to.equal(404);
  });
});

describe('reviewActionsFromChain', () => {
  it('maps pool addresses to ids and the four settlement calls', async () => {
    const calls: string[] = [];
    const chain = {
      flagEntry: async (id: bigint, w: string) => void calls.push(`flag:${id}:${w}`),
      clearFlag: async (id: bigint, w: string) => void calls.push(`clear:${id}:${w}`),
      releaseEscrow: async (id: bigint, w: string) => void calls.push(`release:${id}:${w}`),
      forfeitEscrow: async (id: bigint, w: string) => void calls.push(`forfeit:${id}:${w}`),
    };
    const actions = reviewActionsFromChain(chain, async (pool) =>
      pool === POOL ? 7n : 0n
    );
    await actions.clearFlag(POOL, PLAYER);
    await actions.releaseEscrow(POOL, PLAYER);
    await actions.forfeitEscrow(POOL, PLAYER);
    await actions.flagEntry(POOL, PLAYER);
    expect(calls).to.deep.equal([
      `clear:7:${PLAYER}`,
      `release:7:${PLAYER}`,
      `forfeit:7:${PLAYER}`,
      `flag:7:${PLAYER}`,
    ]);
  });
});
