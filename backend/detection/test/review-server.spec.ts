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
import { ALERT } from '../../_shared/src/metrics';
import { short } from '../../_shared/src/short';
import type { SettlementChain } from '../../reveal/src/chain';
import {
  MemoryDecisionLog,
  MemoryDetectionReportStore,
  canonicalReviewMessage,
  handleReviewRoute,
  parseReviewerRegistry,
  reviewActionsFromChain,
  verifyReviewSubmission,
  type Decision,
  type ReviewActions,
  type ReviewEntryState,
  type ReviewPoolState,
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

/**
 * The settlement seam as a fake, including the two READS the state
 * preconditions run on (audit B-25). The default position — a Scored pool
 * whose flagged, unsettled entry still holds its escrowed share — is one
 * where every action in this file is legal; the precondition specs below
 * move it deliberately.
 */
function fakeActions(
  calls: string[],
  fail = false,
  state: { pool?: ReviewPoolState; entry?: Partial<ReviewEntryState> | null } = {}
): ReviewActions {
  const rec = (name: string) => async (_p: string, w: string) => {
    if (fail) throw new Error('chain refused');
    calls.push(`${name}:${w}`);
  };
  const entry: ReviewEntryState | null =
    state.entry === null
      ? null
      : {
          flagged: true,
          settled: false,
          forfeited: false,
          sanctionsHold: false,
          escrowLamports: 1_000_000n,
          ...state.entry,
        };
  return {
    flagEntry: rec('flag'),
    clearFlag: rec('clear'),
    releaseEscrow: rec('release'),
    forfeitEscrow: rec('forfeit'),
    async poolState() {
      return state.pool ?? 'Scored';
    },
    async entryState() {
      return entry === null ? null : { ...entry };
    },
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

  function deps(
    calls: string[],
    failChain = false,
    state: { pool?: ReviewPoolState; entry?: Partial<ReviewEntryState> | null } = {}
  ) {
    return {
      registry: registryOf(alice),
      actions: fakeActions(calls, failChain, state),
      log: new MemoryDecisionLog(),
      now: () => NOW,
      logger: () => undefined,
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
      getPool: async (id: bigint) => {
        calls.push(`getPool:${id}`);
        return { state: 'Scored' } as Awaited<ReturnType<SettlementChain['getPool']>>;
      },
      getEntries: async (id: bigint) => {
        calls.push(`getEntries:${id}`);
        return [
          {
            player: PLAYER,
            flagged: true,
            settled: false,
            forfeited: false,
            sanctionsHold: false,
            escrowLamports: 7n,
          },
        ] as unknown as Awaited<ReturnType<SettlementChain['getEntries']>>;
      },
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

  it('reads the pool and entry position through the SAME client the writes go to', async () => {
    // B-25: a precondition read from a different source than the one the
    // action is sent to can disagree with it.
    const calls: string[] = [];
    const chain = {
      flagEntry: async () => undefined,
      clearFlag: async () => undefined,
      releaseEscrow: async () => undefined,
      forfeitEscrow: async () => undefined,
      getPool: async (id: bigint) => {
        calls.push(`getPool:${id}`);
        return { state: 'Paid' } as Awaited<ReturnType<SettlementChain['getPool']>>;
      },
      getEntries: async (id: bigint) => {
        calls.push(`getEntries:${id}`);
        return [
          {
            player: PLAYER,
            flagged: true,
            settled: true,
            forfeited: false,
            sanctionsHold: true,
            escrowLamports: 42n,
          },
        ] as unknown as Awaited<ReturnType<SettlementChain['getEntries']>>;
      },
    };
    const actions = reviewActionsFromChain(chain, async () => 7n);
    expect(await actions.poolState(POOL)).to.equal('Paid');
    expect(await actions.entryState(POOL, PLAYER)).to.deep.equal({
      flagged: true,
      settled: true,
      forfeited: false,
      sanctionsHold: true,
      escrowLamports: 42n,
    });
    // A wallet with no seat in this pool is null, not an invented entry.
    expect(await actions.entryState(POOL, base58Encode(new Uint8Array(32).fill(8)))).to.equal(null);
    expect(calls).to.deep.equal(['getPool:7', 'getEntries:7', 'getEntries:7']);
  });
});

describe('replay (audit B-23)', () => {
  const alice = reviewer('alice');

  function deps(calls: string[]) {
    return {
      registry: registryOf(alice),
      actions: fakeActions(calls),
      log: new MemoryDecisionLog(),
      now: () => NOW,
      logger: () => undefined,
    };
  }

  it('refuses a signature that is already on the entry’s record', async () => {
    const calls: string[] = [];
    const d = deps(calls);
    const decision = signedDecision(alice);

    expect((await handleReviewRoute(d, 'POST', '/decisions', decision)).status).to.equal(204);
    expect(calls).to.deep.equal([`clear:${PLAYER}`]);

    // The SAME bytes again, well inside the five-minute freshness window.
    const again = await handleReviewRoute(d, 'POST', '/decisions', decision);
    expect(again.status).to.equal(409);
    expect(again.body).to.deep.equal({ error: 'already_recorded' });
    expect(calls, 'the chain action is not repeated').to.deep.equal([`clear:${PLAYER}`]);
    expect((await d.log.list(POOL)).length, 'and nothing is logged twice').to.equal(1);
  });

  it('the material the public GET publishes is no longer sufficient to replay', async () => {
    // The finding exactly: capture a decision from the open route and send it
    // back. Being published is what spends it.
    const calls: string[] = [];
    const d = deps(calls);
    await handleReviewRoute(d, 'POST', '/decisions', signedDecision(alice));
    const published = await handleReviewRoute(d, 'GET', `/decisions?pool=${POOL}`, null);
    const [row] = (published.body as { decisions: Decision[] }).decisions;
    expect(row.signature, 'the signature really is published').to.be.a('string');

    const replayed = await handleReviewRoute(d, 'POST', '/decisions', row);
    expect(replayed.status).to.equal(409);
    expect(calls).to.deep.equal([`clear:${PLAYER}`]);
  });

  it('a genuinely different decision on the same entry still goes through', async () => {
    const calls: string[] = [];
    const d = deps(calls);
    await handleReviewRoute(d, 'POST', '/decisions', signedDecision(alice));
    const second = signedDecision(alice, { criterion: 'second look: same conclusion' });
    expect((await handleReviewRoute(d, 'POST', '/decisions', second)).status).to.equal(204);
    expect((await d.log.list(POOL)).length).to.equal(2);
  });
});

describe('state preconditions (audit B-25)', () => {
  const alice = reviewer('alice');

  function deps(state: { pool?: ReviewPoolState; entry?: Partial<ReviewEntryState> | null }) {
    const calls: string[] = [];
    return {
      calls,
      d: {
        registry: registryOf(alice),
        actions: fakeActions(calls, false, state),
        log: new MemoryDecisionLog(),
        now: () => NOW,
        logger: () => undefined,
      },
    };
  }

  async function post(
    state: { pool?: ReviewPoolState; entry?: Partial<ReviewEntryState> | null },
    action: Decision['action']
  ) {
    const { calls, d } = deps(state);
    const res = await handleReviewRoute(d, 'POST', '/decisions', signedDecision(alice, { action }));
    return { res, calls, log: d.log };
  }

  it('refuses a wallet with no entry in the pool — the plainest form of the finding', async () => {
    const { res, calls } = await post({ entry: null }, 'flag');
    expect(res.status).to.equal(409);
    expect(res.body).to.deep.include({ error: 'no_entry' });
    expect(calls, 'nothing was sent to the chain').to.deep.equal([]);
  });

  it('refuses every action whose pool state makes it meaningless', async () => {
    // A flag after payout, a release before there is an escrow to release.
    expect((await post({ pool: 'Paid' }, 'flag')).res.body).to.deep.include({ error: 'pool_state' });
    expect((await post({ pool: 'Closed' }, 'clear')).res.body).to.deep.include({ error: 'pool_state' });
    expect((await post({ pool: 'Open' }, 'release')).res.body).to.deep.include({ error: 'pool_state' });
    expect((await post({ pool: 'Refunding' }, 'forfeit')).res.body).to.deep.include({
      error: 'pool_state',
    });
  });

  it('mirrors the program’s own require! lines, action by action', async () => {
    // flags.rs: a settled entry cannot be flagged; a flag that changes
    // nothing is refused.
    expect((await post({ entry: { settled: true, flagged: false } }, 'flag')).res.body).to.deep.include({
      error: 'entry_settled',
    });
    expect((await post({ entry: { flagged: true } }, 'flag')).res.body).to.deep.include({
      error: 'flag_unchanged',
    });
    expect((await post({ entry: { flagged: false } }, 'clear')).res.body).to.deep.include({
      error: 'flag_unchanged',
    });
    // escrow.rs: release needs an escrow, an unforfeited entry and no hold.
    expect((await post({ entry: { escrowLamports: 0n } }, 'release')).res.body).to.deep.include({
      error: 'no_escrow',
    });
    expect((await post({ entry: { forfeited: true } }, 'release')).res.body).to.deep.include({
      error: 'already_forfeited',
    });
    expect((await post({ entry: { sanctionsHold: true } }, 'release')).res.body).to.deep.include({
      error: 'sanctions_hold',
    });
    // escrow.rs: forfeiting an UNFLAGGED entry would seize a share that is
    // merely waiting on KYC.
    expect((await post({ entry: { flagged: false } }, 'forfeit')).res.body).to.deep.include({
      error: 'forfeit_requires_flag',
    });
  });

  it('a legal action still goes through, and a chain that cannot be read refuses rather than acts', async () => {
    const ok = await post({ entry: { flagged: true, settled: false } }, 'clear');
    expect(ok.res.status).to.equal(204);
    expect(ok.calls).to.deep.equal([`clear:${PLAYER}`]);

    const calls: string[] = [];
    const blind = {
      registry: registryOf(alice),
      actions: {
        ...fakeActions(calls),
        async poolState(): Promise<ReviewPoolState> {
          throw new Error('RPC unreachable');
        },
      },
      log: new MemoryDecisionLog(),
      now: () => NOW,
      logger: () => undefined,
    };
    const res = await handleReviewRoute(blind, 'POST', '/decisions', signedDecision(alice));
    expect(res.status).to.equal(502);
    expect(res.body).to.deep.include({ error: 'state_unreadable' });
    expect(calls, 'legality unknown ⇒ nothing is attempted').to.deep.equal([]);
    expect(await blind.log.list(POOL)).to.deep.equal([]);
  });
});

describe('the per-reviewer action budget (audit B-25)', () => {
  const alice = reviewer('alice');

  it('bounds one key’s decisions per window, alerts, and refuses with 429', async () => {
    const calls: string[] = [];
    const alerts: Array<{ reason: string; detail: Record<string, unknown> }> = [];
    const d = {
      registry: registryOf(alice),
      actions: fakeActions(calls),
      log: new MemoryDecisionLog(),
      now: () => NOW,
      logger: () => undefined,
      budget: { actions: 2, windowMs: 60 * 60 * 1000 },
      monitor: {
        recordEvent: () => undefined,
        reportGauge: () => undefined,
        alert: (reason: string, detail: Record<string, unknown>) => void alerts.push({ reason, detail }),
      },
    };
    for (const criterion of ['first look', 'second look']) {
      const res = await handleReviewRoute(d, 'POST', '/decisions', signedDecision(alice, { criterion }));
      expect(res.status, criterion).to.equal(204);
    }
    const third = await handleReviewRoute(
      d,
      'POST',
      '/decisions',
      signedDecision(alice, { criterion: 'third look' })
    );
    expect(third.status).to.equal(429);
    expect(third.body).to.deep.include({ error: 'budget_exceeded' });
    expect(calls.length, 'the third action never reached the chain').to.equal(2);
    expect(alerts.map((a) => a.reason)).to.deep.equal([ALERT.review.reviewerBudgetSpent]);
    // The alert carries the reviewer TRUNCATED, never the whole key.
    expect(String(alerts[0].detail.reviewer)).to.contain('…');
  });

  it('counts only the window, so an older decision does not spend today’s budget', async () => {
    const calls: string[] = [];
    const log = new MemoryDecisionLog();
    await log.append({
      pool: POOL,
      player: PLAYER,
      action: 'flag',
      criterion: 'yesterday',
      decidedBy: alice.wallet,
      decidedAt: new Date(NOW - 25 * 60 * 60 * 1000).toISOString(),
      signature: 'not-checked-here',
    });
    const d = {
      registry: registryOf(alice),
      actions: fakeActions(calls),
      log,
      now: () => NOW,
      logger: () => undefined,
      budget: { actions: 1, windowMs: 60 * 60 * 1000 },
    };
    expect((await handleReviewRoute(d, 'POST', '/decisions', signedDecision(alice))).status).to.equal(
      204
    );
  });
});

describe('honest outcomes (audit B-24, C-07)', () => {
  const alice = reviewer('alice');

  it('a log write that fails AFTER the chain action lands says applied, and alerts', async () => {
    // B-24: this used to answer 502 action_failed for work that had executed,
    // so the reviewer was told to retry something irreversible.
    const calls: string[] = [];
    const alerts: { reason: string; detail: Record<string, unknown> }[] = [];
    const log = new MemoryDecisionLog();
    const failing = {
      ...log,
      append: async () => {
        throw new Error('connection terminated unexpectedly');
      },
      list: (pool: string) => log.list(pool),
      listFor: (pool: string, player: string) => log.listFor(pool, player),
      countBy: (by: string, since: string) => log.countBy(by, since),
    };
    const d = {
      registry: registryOf(alice),
      actions: fakeActions(calls),
      log: failing,
      now: () => NOW,
      logger: () => undefined,
      monitor: {
        recordEvent: () => undefined,
        reportGauge: () => undefined,
        alert: (reason: string, detail: Record<string, unknown>) => void alerts.push({ reason, detail }),
      },
    };
    const res = await handleReviewRoute(d, 'POST', '/decisions', signedDecision(alice));
    expect(res.status, 'not a 502 — the action executed').to.equal(200);
    expect(res.body).to.deep.include({ applied: true, logged: false, error: 'log_write_failed' });
    expect(calls, 'the chain action really did land').to.deep.equal([`clear:${PLAYER}`]);
    expect(alerts.map((a) => a.reason)).to.deep.equal([ALERT.review.decisionNotLogged]);
    // 2026-09-16 (the founder's data-minimisation ruling of 2026-09-15): the
    // alert carries the same truncated identifiers as the request log. It
    // used to carry the whole wallet, and an alert can be forwarded off-box.
    expect(alerts[0].detail.player).to.equal(short(PLAYER));
    expect(alerts[0].detail.pool).to.equal(short(POOL));
    expect(JSON.stringify(alerts[0].detail)).to.not.contain(PLAYER);
  });

  it('a chain refusal BEFORE the log still answers 502 and logs nothing', async () => {
    const calls: string[] = [];
    const d = {
      registry: registryOf(alice),
      actions: fakeActions(calls, true),
      log: new MemoryDecisionLog(),
      now: () => NOW,
      logger: () => undefined,
    };
    const res = await handleReviewRoute(d, 'POST', '/decisions', signedDecision(alice));
    expect(res.status).to.equal(502);
    expect(await d.log.list(POOL)).to.deep.equal([]);
  });

  it('a forfeit whose chain call is refused reports WHY and alerts (C-07)', async () => {
    const alerts: Array<{ reason: string; detail: Record<string, unknown> }> = [];
    const calls: string[] = [];
    const actions: ReviewActions = {
      ...fakeActions(calls),
      async forfeitEscrow() {
        throw new Error('forfeit_escrow is admin-signed; this service holds no admin key');
      },
    };
    const d = {
      registry: registryOf(alice),
      actions,
      log: new MemoryDecisionLog(),
      now: () => NOW,
      logger: () => undefined,
      monitor: {
        recordEvent: () => undefined,
        reportGauge: () => undefined,
        alert: (reason: string, detail: Record<string, unknown>) => void alerts.push({ reason, detail }),
      },
    };
    const res = await handleReviewRoute(d, 'POST', '/decisions', signedDecision(alice, { action: 'forfeit' }));
    expect(res.status).to.equal(202);
    expect(res.body).to.deep.include({ recorded: true, landed: false });
    // The swallowed error is the finding: the operator could not tell "no
    // admin key here" from "the RPC is down".
    expect(String((res.body as { detail: string }).detail)).to.contain('admin-signed');
    expect(alerts.map((a) => a.reason)).to.deep.equal([ALERT.review.forfeitNotLanded]);
    expect(String(alerts[0].detail.chainError)).to.contain('admin-signed');
    // 2026-09-16: truncated identifiers here too — never the whole wallet.
    expect(alerts[0].detail.player).to.equal(short(PLAYER));
    expect(JSON.stringify(alerts[0].detail)).to.not.contain(PLAYER);
  });

  it('GET /pending shows an upheld forfeit the chain does not carry yet (C-07)', async () => {
    const calls: string[] = [];
    const d = {
      registry: registryOf(alice),
      actions: {
        ...fakeActions(calls),
        async forfeitEscrow() {
          throw new Error('forfeit_escrow is admin-signed; this service holds no admin key');
        },
      },
      log: new MemoryDecisionLog(),
      now: () => NOW,
      logger: () => undefined,
    };
    await handleReviewRoute(d, 'POST', '/decisions', signedDecision(alice, { action: 'forfeit' }));

    const pending = await handleReviewRoute(d, 'GET', `/pending?pool=${POOL}`, null);
    expect(pending.status).to.equal(200);
    const body = pending.body as { pending: Array<{ player: string; decidedBy: string }> };
    expect(body.pending.length).to.equal(1);
    expect(body.pending[0].player).to.equal(PLAYER);
    expect(body.pending[0].decidedBy).to.equal(alice.wallet);

    // Once the admin lands it, the entry reads forfeited and the list empties.
    const landed = {
      ...d,
      actions: { ...d.actions, ...fakeActions([], false, { entry: { forfeited: true } }) },
    };
    const after = await handleReviewRoute(landed, 'GET', `/pending?pool=${POOL}`, null);
    expect((after.body as { pending: unknown[] }).pending).to.deep.equal([]);
  });
});

describe('the request log (audit B-35)', () => {
  const alice = reviewer('alice');
  const mallory = reviewer('mallory');

  function world() {
    const lines: Array<{ stage: string; detail: Record<string, unknown> }> = [];
    const calls: string[] = [];
    return {
      lines,
      calls,
      d: {
        registry: registryOf(alice),
        actions: fakeActions(calls),
        log: new MemoryDecisionLog(),
        now: () => NOW,
        logger: (stage: string, detail: Record<string, unknown>) => void lines.push({ stage, detail }),
      },
    };
  }

  it('a FAILED reviewer authentication leaves a line naming the check that failed', async () => {
    const w = world();
    const res = await handleReviewRoute(
      w.d,
      'POST',
      '/decisions',
      signedDecision(mallory),
      { clientKey: '203.0.113.7' }
    );
    expect(res.status).to.equal(401);
    expect(res.body, 'the CALLER still learns nothing').to.deep.equal({ error: 'unauthorized' });
    expect(w.lines.length).to.equal(1);
    expect(w.lines[0].detail).to.include({ status: 401, refusal: 'not_member', action: 'clear' });
    // Enough to investigate: which client, which reviewer key, which entry.
    expect(w.lines[0].detail.client).to.equal('203.0.x.x');
  });

  it('never writes a signature, a criterion, a whole address or a whole IP', async () => {
    const w = world();
    const decision = signedDecision(alice, { criterion: 'device fingerprint shared with seat 12' });
    await handleReviewRoute(w.d, 'POST', '/decisions', decision, { clientKey: '198.51.100.23' });
    const serialised = JSON.stringify(w.lines);
    expect(serialised).to.not.contain(decision.signature);
    expect(serialised).to.not.contain(decision.criterion);
    expect(serialised).to.not.contain(alice.wallet);
    expect(serialised).to.not.contain(POOL);
    expect(serialised).to.not.contain(PLAYER);
    expect(serialised).to.not.contain('198.51.100.23');
    // …but enough of each to correlate.
    expect(serialised).to.contain(alice.wallet.slice(0, 6));
    expect(serialised).to.contain('198.51.x.x');
    expect(w.lines[0].detail).to.include({ status: 204, outcome: 'applied' });
  });

  it('logs the reads too, and keeps the health probe out of the stream', async () => {
    const w = world();
    await handleReviewRoute(w.d, 'GET', '/health', null);
    expect(w.lines.length, 'a probe every few seconds would drown the rest').to.equal(0);
    await handleReviewRoute(w.d, 'GET', `/decisions?pool=${POOL}`, null);
    await handleReviewRoute(w.d, 'GET', '/nope', null);
    expect(w.lines.map((l) => l.detail.status)).to.deep.equal([200, 404]);
  });
});

describe('the detection report surface (audit A-18 / D-36; ruling D-E9)', () => {
  const alice = reviewer('alice');
  const TOKEN = 'operator-token-not-a-wallet-key';

  async function world(withReport = true) {
    const reports = new MemoryDetectionReportStore();
    if (withReport) {
      await reports.save({
        pool: POOL,
        poolId: '7',
        producedAt: '2026-09-12T08:00:00.000Z',
        report: {
          pool: '7',
          findings: [
            {
              signal: 'duplicate_sets',
              player: PLAYER,
              severity: 'strong',
              detail: 'battle set identical to seat 12',
              correlated: [PLAYER],
            },
          ],
          reviewRecommended: [PLAYER],
          hardBlocks: [],
        },
      });
    }
    return {
      registry: registryOf(alice),
      actions: fakeActions([]),
      log: new MemoryDecisionLog(),
      now: () => NOW,
      logger: () => undefined,
      reports,
      operatorToken: TOKEN,
    };
  }

  it('serves the latest report to the operator token, and to nobody else', async () => {
    const d = await world();
    const open = await handleReviewRoute(d, 'GET', `/detection?pool=${POOL}`, null);
    expect(open.status, 'no token, no report').to.equal(401);
    const wrong = await handleReviewRoute(d, 'GET', `/detection?pool=${POOL}`, null, {
      authorization: 'operator-token-not-a-wallet-kex',
    });
    expect(wrong.status).to.equal(401);

    const res = await handleReviewRoute(d, 'GET', `/detection?pool=${POOL}`, null, {
      authorization: TOKEN,
    });
    expect(res.status).to.equal(200);
    const body = res.body as {
      findings: unknown[];
      reviewRecommended: string[];
      producedAt: string;
    };
    expect(body.reviewRecommended).to.deep.equal([PLAYER]);
    expect(body.findings.length).to.equal(1);
    expect(body.producedAt).to.equal('2026-09-12T08:00:00.000Z');
  });

  it('is FAIL-CLOSED when no token is configured, and 404s a pool with no run', async () => {
    const d = await world(false);
    expect(
      (await handleReviewRoute({ ...d, operatorToken: undefined }, 'GET', `/detection?pool=${POOL}`, null, {
        authorization: TOKEN,
      })).status
    ).to.equal(503);
    const res = await handleReviewRoute(d, 'GET', `/detection?pool=${POOL}`, null, {
      authorization: TOKEN,
    });
    expect(res.status).to.equal(404);
  });

  it('keeps the newest run and does not overwrite the older one', async () => {
    const reports = new MemoryDetectionReportStore();
    for (const [at, players] of [
      ['2026-09-12T08:00:00.000Z', []],
      ['2026-09-12T09:00:00.000Z', [PLAYER]],
    ] as Array<[string, string[]]>) {
      await reports.save({
        pool: POOL,
        poolId: '7',
        producedAt: at,
        report: { pool: '7', findings: [], reviewRecommended: players, hardBlocks: [] },
      });
    }
    const latest = await reports.latest(POOL);
    expect(latest?.producedAt).to.equal('2026-09-12T09:00:00.000Z');
    expect(latest?.report.reviewRecommended).to.deep.equal([PLAYER]);
    expect(await reports.latest(base58Encode(new Uint8Array(32).fill(5)))).to.equal(null);
  });
});
