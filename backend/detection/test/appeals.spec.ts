/**
 * Phase 2 Stage E: the appeal route. Real Ed25519 signatures throughout, as
 * in review-server.spec: the appellant signs the appeal message with the
 * entry's own key, reviewers sign the review message, and every row the
 * server accepts is re-verified from the log alone with `verifyRow`.
 */
import { expect } from 'chai';
import { createServer } from 'http';
import { request as httpRequest } from 'http';
import nacl from 'tweetnacl';
import { base58Encode } from '../../_shared/src/blotto-events';
import {
  APPEAL_LODGE_WINDOW_MS,
  MemoryDecisionLog,
  appealDecisionRefusal,
  appealState,
  canonicalAppealMessage,
  canonicalReviewMessage,
  handleReviewRoute,
  lodgeRefusal,
  serveReviewApi,
  verifyRow,
  type Decision,
  type ReviewActions,
  type ReviewerRegistry,
} from '../src';

const T0 = Date.parse('2026-09-07T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

interface Key {
  keys: nacl.SignKeyPair;
  wallet: string;
}
function key(seed: string): Key {
  const keys = nacl.sign.keyPair.fromSeed(
    new TextEncoder().encode(seed.padEnd(32, '.')).slice(0, 32)
  );
  return { keys, wallet: base58Encode(keys.publicKey) };
}
const POOL = base58Encode(new Uint8Array(32).fill(9));
const alice = key('alice-reviewer');
const bob = key('bob-reviewer');
const player = key('the-appellant');
const stranger = key('someone-else');

function registryOf(...r: Key[]): ReviewerRegistry {
  return { version: 1, members: r.map((k) => k.wallet), updated: '2026-09-07' };
}

function reviewerRow(r: Key, action: Decision['action'], atMs: number, criterion = 'device reuse'): Decision {
  const decidedAt = new Date(atMs).toISOString();
  const signature = nacl.sign.detached(
    canonicalReviewMessage({ pool: POOL, player: player.wallet, action, criterion, signedAt: decidedAt }),
    r.keys.secretKey
  );
  return {
    pool: POOL,
    player: player.wallet,
    action,
    criterion,
    decidedBy: r.wallet,
    decidedAt,
    signature: Buffer.from(signature).toString('base64'),
  };
}

function appealBody(signer: Key, atMs: number, grounds = 'the device was shared with my brother, see attached') {
  const signedAt = new Date(atMs).toISOString();
  const signature = nacl.sign.detached(
    canonicalAppealMessage({ pool: POOL, player: player.wallet, grounds, signedAt }),
    signer.keys.secretKey
  );
  return {
    pool: POOL,
    player: player.wallet,
    grounds,
    signedAt,
    signature: Buffer.from(signature).toString('base64'),
  };
}

/** Actions that record calls; forfeit throws like the real service (no admin key). */
function actions(calls: string[]): ReviewActions {
  const rec = (name: string) => async (_p: string, w: string) => void calls.push(`${name}:${w}`);
  return {
    flagEntry: rec('flag'),
    clearFlag: rec('clear'),
    releaseEscrow: rec('release'),
    async forfeitEscrow() {
      throw new Error('forfeit_escrow is admin-signed; this service holds no admin key');
    },
  };
}

describe('appeal state (pure, from one entry’s thread)', () => {
  it('nothing to appeal until a flag is UPHELD; a pending flag is not appealable', () => {
    expect(appealState([]).forfeit).to.equal(null);
    expect(lodgeRefusal([reviewerRow(alice, 'flag', T0)], new Date(T0 + 1).toISOString())).to.equal(
      'nothing_to_appeal'
    );
  });

  it('the lodge window is seven days from the upheld flag, on the signed timestamp', () => {
    const thread = [reviewerRow(alice, 'flag', T0), reviewerRow(alice, 'forfeit', T0 + DAY)];
    const s = appealState(thread);
    expect(s.forfeit?.decidedBy).to.equal(alice.wallet);
    expect(s.lodgeUntil).to.equal(new Date(T0 + DAY + APPEAL_LODGE_WINDOW_MS).toISOString());
    expect(lodgeRefusal(thread, new Date(T0 + DAY + 7 * DAY).toISOString())).to.equal(null);
    expect(lodgeRefusal(thread, new Date(T0 + DAY + 7 * DAY + 1).toISOString())).to.equal('window_closed');
    // Signed BEFORE the forfeit existed: not a valid lodge either.
    expect(lodgeRefusal(thread, new Date(T0).toISOString())).to.equal('window_closed');
  });

  it('one appeal per upheld flag; decided by a DIFFERENT reviewer; never twice', () => {
    const thread: Decision[] = [reviewerRow(alice, 'forfeit', T0)];
    expect(appealDecisionRefusal(thread, bob.wallet)).to.equal('no_open_appeal');
    const lodge = appealBody(player, T0 + DAY);
    thread.push({
      pool: POOL,
      player: player.wallet,
      action: 'appeal_lodged',
      criterion: lodge.grounds,
      decidedBy: player.wallet,
      decidedAt: lodge.signedAt,
      signature: lodge.signature,
    });
    expect(lodgeRefusal(thread, new Date(T0 + 2 * DAY).toISOString())).to.equal('already_lodged');
    expect(appealDecisionRefusal(thread, alice.wallet)).to.equal('same_reviewer');
    expect(appealDecisionRefusal(thread, bob.wallet)).to.equal(null);
    expect(appealState(thread).decideBy).to.equal(new Date(T0 + DAY + 7 * DAY).toISOString());
    thread.push(reviewerRow(bob, 'appeal_dismissed', T0 + 3 * DAY, 'device log shows one hand'));
    expect(appealDecisionRefusal(thread, bob.wallet)).to.equal('no_open_appeal');
    expect(appealState(thread).decided?.action).to.equal('appeal_dismissed');
  });
});

describe('POST /appeals and the appeal decisions', () => {
  function world(members: Key[] = [alice, bob]) {
    const calls: string[] = [];
    const log = new MemoryDecisionLog();
    const now = { t: T0 };
    const deps = { registry: registryOf(...members), actions: actions(calls), log, now: () => now.t };
    return { calls, log, now, deps };
  }

  it('a forfeit through the service is LOGGED even though the chain call cannot land here (202)', async () => {
    const w = world();
    const res = await handleReviewRoute(w.deps, 'POST', '/decisions', reviewerRow(alice, 'forfeit', T0));
    expect(res.status).to.equal(202);
    expect(res.body).to.deep.include({ recorded: true, landed: false });
    const rows = await w.log.listFor(POOL, player.wallet);
    expect(rows.map((r) => r.action)).to.deep.equal(['forfeit']);
  });

  it('the affected player lodges within the window; anyone else is refused with the uniform 401', async () => {
    const w = world();
    await handleReviewRoute(w.deps, 'POST', '/decisions', reviewerRow(alice, 'forfeit', T0));
    w.now.t = T0 + 2 * DAY;

    const forged = await handleReviewRoute(w.deps, 'POST', '/appeals', appealBody(stranger, w.now.t));
    expect(forged.status).to.equal(401);
    const stale = await handleReviewRoute(w.deps, 'POST', '/appeals', appealBody(player, w.now.t - 10 * 60 * 1000));
    expect(stale.status).to.equal(401);

    const ok = await handleReviewRoute(w.deps, 'POST', '/appeals', appealBody(player, w.now.t));
    expect(ok.status).to.equal(204);
    const again = await handleReviewRoute(w.deps, 'POST', '/appeals', appealBody(player, w.now.t + 1000));
    expect(again.status).to.equal(409);
    expect(again.body).to.deep.equal({ error: 'already_lodged' });

    const state = await handleReviewRoute(w.deps, 'GET', `/appeals?pool=${POOL}&player=${player.wallet}`, null);
    expect(state.status).to.equal(200);
    expect((state.body as { lodged: Decision | null }).lodged?.action).to.equal('appeal_lodged');
    expect(w.calls).to.deep.equal([], 'an appeal takes no chain action');
  });

  it('after seven days the lodge is refused with window_closed', async () => {
    const w = world();
    await handleReviewRoute(w.deps, 'POST', '/decisions', reviewerRow(alice, 'forfeit', T0));
    w.now.t = T0 + 7 * DAY + 1000;
    const late = await handleReviewRoute(w.deps, 'POST', '/appeals', appealBody(player, w.now.t));
    expect(late.status).to.equal(409);
    expect(late.body).to.deep.equal({ error: 'window_closed' });
  });

  it('nothing to appeal: a wallet with no upheld flag gets 409, malformed grounds get 400', async () => {
    const w = world();
    const none = await handleReviewRoute(w.deps, 'POST', '/appeals', appealBody(player, T0));
    expect(none.status).to.equal(409);
    expect(none.body).to.deep.equal({ error: 'nothing_to_appeal' });
    const empty = await handleReviewRoute(w.deps, 'POST', '/appeals', appealBody(player, T0, '   '));
    expect(empty.status).to.equal(400);
    expect((await handleReviewRoute(w.deps, 'PUT', '/appeals', null)).status).to.equal(405);
  });

  it('the appeal is decided by a different reviewer; the upholding reviewer is refused; a non-member 401s', async () => {
    const w = world();
    await handleReviewRoute(w.deps, 'POST', '/decisions', reviewerRow(alice, 'forfeit', T0));
    w.now.t = T0 + DAY;
    expect((await handleReviewRoute(w.deps, 'POST', '/appeals', appealBody(player, w.now.t))).status).to.equal(204);
    w.now.t = T0 + 3 * DAY;

    const same = await handleReviewRoute(w.deps, 'POST', '/decisions', reviewerRow(alice, 'appeal_upheld', w.now.t, 'on reflection'));
    expect(same.status).to.equal(409);
    expect(same.body).to.deep.equal({ error: 'same_reviewer' });
    const outsider = await handleReviewRoute(w.deps, 'POST', '/decisions', reviewerRow(stranger, 'appeal_upheld', w.now.t));
    expect(outsider.status).to.equal(401);

    const decided = await handleReviewRoute(w.deps, 'POST', '/decisions', reviewerRow(bob, 'appeal_upheld', w.now.t, 'device log shows two hands'));
    expect(decided.status).to.equal(204);
    expect(w.calls).to.deep.equal([], 'an appeal decision takes no chain action');
    const twice = await handleReviewRoute(w.deps, 'POST', '/decisions', reviewerRow(bob, 'appeal_dismissed', w.now.t + 1000));
    expect(twice.status).to.equal(409);
    expect(twice.body).to.deep.equal({ error: 'no_open_appeal' });

    // With ONE member the appeal can be lodged but never decided — the
    // registry blocker the service warns about at boot (audit O24).
    const solo = world([alice]);
    await handleReviewRoute(solo.deps, 'POST', '/decisions', reviewerRow(alice, 'forfeit', T0));
    solo.now.t = T0 + DAY;
    expect((await handleReviewRoute(solo.deps, 'POST', '/appeals', appealBody(player, solo.now.t))).status).to.equal(204);
    expect((await handleReviewRoute(solo.deps, 'POST', '/decisions', reviewerRow(alice, 'appeal_dismissed', solo.now.t))).status).to.equal(409);
  });

  it('every accepted row re-verifies from the log alone; a tampered or misattributed row does not', async () => {
    const w = world();
    w.now.t = T0 - DAY;
    await handleReviewRoute(w.deps, 'POST', '/decisions', reviewerRow(alice, 'flag', T0 - DAY));
    w.now.t = T0;
    await handleReviewRoute(w.deps, 'POST', '/decisions', reviewerRow(alice, 'forfeit', T0));
    w.now.t = T0 + DAY;
    await handleReviewRoute(w.deps, 'POST', '/appeals', appealBody(player, w.now.t));
    w.now.t = T0 + 2 * DAY;
    await handleReviewRoute(w.deps, 'POST', '/decisions', reviewerRow(bob, 'appeal_dismissed', w.now.t));

    const rows = await w.log.listFor(POOL, player.wallet);
    expect(rows.map((r) => r.action)).to.deep.equal(['flag', 'forfeit', 'appeal_lodged', 'appeal_dismissed']);
    for (const r of rows) expect(verifyRow(r, w.deps.registry), r.action).to.equal(true);

    const lodge = rows[2];
    expect(verifyRow({ ...lodge, criterion: lodge.criterion + '!' }, w.deps.registry)).to.equal(false);
    expect(verifyRow({ ...lodge, decidedBy: stranger.wallet }, w.deps.registry)).to.equal(false);
    // A reviewer row signed by someone who has since left the registry no
    // longer verifies as a reviewer's — the registry is part of the check.
    expect(verifyRow(rows[3], registryOf(alice))).to.equal(false);
    // And a lodge can never pass as a reviewer decision, nor vice versa.
    expect(verifyRow({ ...lodge, action: 'clear' }, w.deps.registry)).to.equal(false);
  });
});

describe('the review server’s hygiene (BR-005, wired at Stage E)', () => {
  function send(port: number, method: string, path: string, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('answers the browser preflight for an allowlisted origin, refuses others, rate-limits, and never sends a wildcard', async () => {
    const server = serveReviewApi(
      {
        registry: registryOf(alice),
        actions: actions([]),
        log: new MemoryDecisionLog(),
        hygiene: {
          rateLimit: { enabled: true, requestsPerMinute: 60, burst: 1, retryAfterSeconds: 1 },
          cors: { allowedOrigins: ['https://app.example'], allowMethods: 'GET, POST, OPTIONS', allowHeaders: 'content-type' },
          securityHeadersEnabled: true,
        },
      },
      0
    );
    await new Promise<void>((r) => server.once('listening', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const pre = await send(port, 'OPTIONS', '/decisions', {
        origin: 'https://app.example',
        'access-control-request-method': 'POST',
      });
      expect(pre.status).to.equal(204);
      expect(pre.headers['access-control-allow-origin']).to.equal('https://app.example');

      const other = await send(port, 'GET', '/health', { origin: 'https://evil.example' });
      expect(other.status).to.equal(200);
      expect(other.headers['access-control-allow-origin']).to.equal(undefined, 'no wildcard, no echo');
      expect(other.headers['x-content-type-options']).to.equal('nosniff');

      // The burst (one) is spent by the GET above; the next request is
      // refused with Retry-After. (The preflight never touched the budget —
      // a browser must be able to preflight a client that is over it.)
      const next = await send(port, 'GET', '/health');
      expect(next.status).to.equal(429);
      expect(next.headers['retry-after']).to.equal('1');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('sanity: a server with the default posture is unchanged on the wire (no CORS header at all)', async () => {
    const server = serveReviewApi(
      { registry: registryOf(alice), actions: actions([]), log: new MemoryDecisionLog() },
      0
    );
    await new Promise<void>((r) => server.once('listening', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await send(port, 'GET', '/health', { origin: 'https://app.example' });
      expect(res.status).to.equal(200);
      expect(res.headers['access-control-allow-origin']).to.equal(undefined);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
    void createServer; // keep the import honest if the sanity test is trimmed
  });
});
