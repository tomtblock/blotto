import { expect } from 'chai';
import {
  classifyProvider,
  daemonResults,
  deployLagResult,
  indexerResults,
  laneResult,
  parseTreasury,
  PoolStateClock,
  poolResults,
  providerResult,
  serviceResult,
  siteResult,
  TickMemory,
  tokenExpiryResult,
  treasuryResult,
  type DaemonHealth,
} from '../src/checks';
import { probeProvider } from '../src/collect';
import { CLOCK_SYSVAR } from '../src/solana';
import { byKey, cfg, chainPool, configView, fakeFetch, snapshot, T0 } from './fixtures';

const NOW = Date.parse('2026-10-15T02:10:00Z');
const ok = { status: 200, body: '{"ok":true}', error: null };

describe('service checks', () => {
  it('passes a 2xx and fails a 503 with the reason from its body', () => {
    expect(serviceResult('blotto-packet', ok, cfg, false).status).to.equal('pass');
    const down = serviceResult(
      'blotto-daemon',
      { status: 503, body: '{"ok":false,"error":"no tick completed for 914273ms (budget 900000ms)"}', error: null },
      cfg,
      false
    );
    expect(down.status).to.equal('fail');
    expect(down.detail).to.equal('HTTP 503: no tick completed for 914273ms (budget 900000ms)');
    expect(down.failuresToOpen).to.equal(cfg.services.failuresToAlert['blotto-daemon']);
  });

  it('reads unknown — neither alerting nor clearing — while a backend deploy is running', () => {
    expect(serviceResult('blotto-daemon', { status: null, body: '', error: 'refused' }, cfg, true).status).to.equal('unknown');
  });
});

describe('daemon checks', () => {
  // The body /health served all week of 2026-10-10: 200, ok:true — and two
  // errors on every tick, because the Switchboard seed step threw.
  const switchboardWeek = (at: string): DaemonHealth => ({
    ok: true,
    ready: true,
    settlementSol: '9.196024324',
    lastTick: { at, errors: 2 },
  });

  it('fails tick-errors on the Switchboard-week body that /health called ok', () => {
    const r = byKey(daemonResults(switchboardWeek('2026-10-15T02:09:55Z'), new TickMemory(), NOW, cfg, false), 'daemon:tick-errors');
    expect(r.status).to.equal('fail');
    expect(r.detail).to.match(/2 errors while \/health still reads ok/);
  });

  it('counts each tick once: the same lastTick seen twice is unknown the second time', () => {
    const mem = new TickMemory();
    const body = switchboardWeek('2026-10-15T02:09:55Z');
    expect(byKey(daemonResults(body, mem, NOW, cfg, false), 'daemon:tick-errors').status).to.equal('fail');
    expect(byKey(daemonResults(body, mem, NOW + 60_000, cfg, false), 'daemon:tick-errors').status).to.equal('unknown');
  });

  it('fails tick-stale once the last tick is older than the limit, even with ok:true', () => {
    const old = new Date(NOW - (cfg.daemon.tickStaleSeconds + 60) * 1000).toISOString();
    const r = byKey(daemonResults({ ...switchboardWeek(old), lastTick: { at: old, errors: 0 } }, new TickMemory(), NOW, cfg, false), 'daemon:tick-stale');
    expect(r.status).to.equal('fail');
  });

  it('compares the settlement balance in lamports against the floor, without floats', () => {
    const low = byKey(
      daemonResults({ ...switchboardWeek('2026-10-15T02:09:55Z'), settlementSol: '0.199999999' }, new TickMemory(), NOW, cfg, false),
      'daemon:settlement-sol'
    );
    expect(low.status).to.equal('fail');
    expect(low.detail).to.contain('0.199999999 SOL, under the 0.2 SOL floor');
    const fine = byKey(
      daemonResults({ ...switchboardWeek('2026-10-15T02:09:55Z'), settlementSol: '0.2' }, new TickMemory(), NOW, cfg, false),
      'daemon:settlement-sol'
    );
    expect(fine.status).to.equal('pass');
  });

  it('is unknown while starting (ready:false), so a boot is not an outage', () => {
    for (const r of daemonResults({ ok: true, ready: false, lastTick: null }, new TickMemory(), NOW, cfg, false)) {
      expect(r.status).to.equal('unknown');
    }
  });
});

describe('pool checks, on the chain clock', () => {
  const ages = new Map<string, number>();

  it('passes the live shape: two open pools, each with its pass collection', () => {
    for (const r of poolResults(snapshot(), ages, null, cfg)) expect(r.status, r.key).to.equal('pass');
  });

  it('fails not-enterable for an open pool with no pass collection once past the launch grace (the 2026-10-10 outage)', () => {
    const snap = snapshot(T0 + BigInt(cfg.chain.passCollectionGraceSeconds) + 1n, [
      chainPool({ id: 101n, openedAt: T0, fillDeadline: T0 + 24_000n, mode: 1 }, { hasPassCollection: false }),
    ]);
    const r = byKey(poolResults(snap, ages, null, cfg), 'pools:not-enterable');
    expect(r.status).to.equal('fail');
    expect(r.severity).to.equal('critical');
    expect(r.detail).to.equal('pool 101 (hard): no pass collection');
  });

  it('gives a pool its launch grace before calling a missing collection a failure', () => {
    const snap = snapshot(T0 + 30n, [chainPool({ id: 101n, openedAt: T0, fillDeadline: T0 + 24_000n }, { hasPassCollection: false })]);
    expect(byKey(poolResults(snap, ages, null, cfg), 'pools:not-enterable').status).to.equal('pass');
  });

  it('fails not-enterable when entries are paused, or a vault holds less than its pot', () => {
    const paused = snapshot(undefined, undefined, configView({ paused: true }));
    expect(byKey(poolResults(paused, ages, null, cfg), 'pools:not-enterable').detail).to.contain('paused');
    const short = snapshot(T0 + 600n, [chainPool({ id: 100n, openedAt: T0, fillDeadline: T0 + 24_000n }, { vaultLamports: 1n })]);
    expect(byKey(poolResults(short, ages, null, cfg), 'pools:not-enterable').detail).to.contain('less than its pot');
  });

  it('fails past-deadline for an Open pool beyond its deadline plus slack', () => {
    const snap = snapshot(T0 + 24_000n + BigInt(cfg.chain.fillDeadlineSlackSeconds) + 60n);
    expect(byKey(poolResults(snap, ages, null, cfg), 'pools:past-deadline').status).to.equal('fail');
  });

  it('fails stuck for a pool Sealed longer than its limit, by the watcher clock', () => {
    const sealed = chainPool({ id: 100n, state: 'Sealed', openedAt: T0, fillDeadline: T0 + 100n });
    const clock = new PoolStateClock();
    clock.observe([sealed.pool], NOW);
    const later = clock.observe([sealed.pool], NOW + (cfg.chain.sealedMaxMinutes + 1) * 60_000);
    const r = byKey(poolResults(snapshot(T0 + 600n, [sealed]), later, null, cfg), 'pools:stuck');
    expect(r.status).to.equal('fail');
    expect(r.detail).to.match(/pool 100 \(easy\): Sealed for \d+ min/);
  });

  it('fails none-open for an enabled tier with no live pool past its open time — unless the treasury is short', () => {
    const idle = snapshot(T0 + 10_000n, [], configView({ easyActive: 0n, hardActive: 0n, tierNextOpenAt: T0 }));
    expect(byKey(poolResults(idle, ages, null, cfg), 'pools:none-open').status).to.equal('fail');
    const short = { policySource: 'chain', short: [{ tier: 0, shortByLamports: 5n }] };
    expect(byKey(poolResults(idle, ages, short, cfg), 'pools:none-open').status).to.equal('pass');
  });

  it('is unknown when the chain could not be read', () => {
    for (const r of poolResults(null, ages, null, cfg)) expect(r.status).to.equal('unknown');
  });
});

describe('treasury and indexer checks', () => {
  const treasuryBody = (status: string, source = 'chain') =>
    JSON.stringify({ policy_source: source, tiers: [{ tier: 0, status, short_by_lamports: status === 'short' ? '1500000000' : '0' }] });

  it('reads a short tier off /treasury', () => {
    const t = parseTreasury({ status: 200, body: treasuryBody('short'), error: null });
    const r = treasuryResult(t);
    expect(r.status).to.equal('fail');
    expect(r.detail).to.equal('tier 0 short by 1.5 SOL');
  });

  it('fails behind on a newest-pool gap and on an entrant-count gap', () => {
    const snap = snapshot(T0 + 600n, [chainPool({ id: 101n, openedAt: T0, fillDeadline: T0 + 24_000n, entrants: 3 })]);
    const t = parseTreasury({ status: 200, body: treasuryBody('open'), error: null });
    const r = byKey(indexerResults(snap, [{ id: 100n, entrants: 0, state: 'Open' }, { id: 101n, entrants: 1, state: 'Open' }], t, cfg), 'indexer:behind');
    expect(r.status).to.equal('fail');
    expect(r.detail).to.contain('pool 101: 3 entrants on chain, 1 indexed');
    expect(r.failuresToOpen).to.equal(cfg.indexer.lagPolls);
  });

  it('fails chain-read when /treasury fell back to the ledger', () => {
    const t = parseTreasury({ status: 200, body: treasuryBody('open', 'ledger'), error: null });
    expect(byKey(indexerResults(null, null, t, cfg), 'indexer:chain-read').status).to.equal('fail');
  });
});

describe('the RPC provider check', () => {
  // PHASE-N-REVIEW: constructed in the shape Helius answers a spent allowance
  // with; the daemon's 2026-10-11 log kept only web3.js's wrapping
  // ("429 Too Many Requests: … max usage reached"), not the raw body.
  const spent = { ok: false, status: 429, body: '{"jsonrpc":"2.0","error":{"code":-32429,"message":"max usage reached"},"id":1}', error: null };

  it('reads "max usage" as a spent allowance and alerts on the first sighting', () => {
    expect(classifyProvider(spent)).to.equal('creditsSpent');
    const r = providerResult(spent, cfg);
    expect(r.status).to.equal('fail');
    expect(r.failuresToOpen).to.equal(cfg.provider.creditsSpentFailuresToAlert);
    expect(r.facts?.state).to.equal('creditsSpent');
  });

  it('needs a plain rate limit to persist', () => {
    const r = providerResult({ ok: false, status: 429, body: 'Too Many Requests', error: null }, cfg);
    expect(r.failuresToOpen).to.equal(cfg.provider.otherFailuresToAlert);
    expect(classifyProvider({ ok: false, status: 401, body: '', error: null })).to.equal('keyRejected');
    expect(classifyProvider({ ok: false, status: null, body: '', error: 'ENOTFOUND' })).to.equal('unreachable');
  });

  it('names a failed account read, which must persist like any outage', () => {
    const r = providerResult({ ok: false, status: 500, body: 'Internal Server Error', error: null }, cfg);
    expect(r.status).to.equal('fail');
    expect(r.detail).to.equal('an account read failed: HTTP 500');
    expect(r.failuresToOpen).to.equal(cfg.provider.otherFailuresToAlert);
    const empty = providerResult({ ok: false, status: 200, body: '', error: 'answered without the Clock sysvar, which always exists' }, cfg);
    expect(empty.detail).to.contain('without the Clock sysvar');
    expect(providerResult({ ok: true, status: 200, body: '', error: null }, cfg).detail).to.equal('an account read answered');
  });
});

describe('the provider probe', () => {
  const URL_WITH_KEY = 'https://devnet.helius-rpc.example/?api-key=SECRETKEY';
  const clock = { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: { lamports: 1, owner: 'Sysvar1111111111111111111111111111111111111', data: ['', 'base64'] } } };

  it('reads an account, the Clock sysvar, rather than asking for the slot', async () => {
    const { fetchImpl, calls } = fakeFetch([[200, clock]]);
    expect(await probeProvider(URL_WITH_KEY, 1000, fetchImpl)).to.deep.equal({ ok: true, status: 200, body: '', error: null });
    const req = calls[0]!.body as { method: string; params: unknown[] };
    expect(req.method).to.equal('getAccountInfo');
    expect(req.params[0]).to.equal(CLOCK_SYSVAR);
  });

  it('fails on the 2026-10-16 answer: HTTP 500 to an account read', async () => {
    const { fetchImpl } = fakeFetch([[500, 'Internal Server Error']]);
    const p = await probeProvider(URL_WITH_KEY, 1000, fetchImpl);
    expect(p).to.include({ ok: false, status: 500, error: null });
    expect(classifyProvider(p)).to.equal('unreachable');
  });

  it('fails a 200 that carries no account, or a JSON-RPC error, and says which', async () => {
    const none = fakeFetch([[200, { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: null } }]]);
    expect((await probeProvider(URL_WITH_KEY, 1000, none.fetchImpl)).error).to.contain('without the Clock sysvar');
    const rpcErr = fakeFetch([[200, { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } }]]);
    const p = await probeProvider(URL_WITH_KEY, 1000, rpcErr.fetchImpl);
    expect(p.ok).to.equal(false);
    expect(p.error).to.equal('getAccountInfo: -32603 Internal error');
  });

  it('never puts the URL, which carries the API key, into what it reports', async () => {
    const fetchImpl = (async () => {
      throw new Error(`connect ECONNREFUSED ${URL_WITH_KEY}`);
    }) as typeof fetch;
    const p = await probeProvider(URL_WITH_KEY, 1000, fetchImpl);
    expect(p.status).to.equal(null);
    expect(p.error).to.contain('<provider>');
    expect(JSON.stringify(p)).not.to.contain('SECRETKEY');
  });
});

describe('site, lanes and token checks', () => {
  it('fails the site on no answer and passes a 200', () => {
    expect(siteResult('site:alias', 'u', { status: null, body: '', error: 'ETIMEDOUT' }, cfg).status).to.equal('fail');
    expect(siteResult('site:domain', 'u', ok, cfg).status).to.equal('pass');
  });

  it('calls a version lag a failure only past the build window', () => {
    const head = { sha: 'b'.repeat(40), committedAtMs: NOW - 5 * 60_000 };
    expect(deployLagResult('a'.repeat(40), head, NOW, cfg).status).to.equal('pass');
    const old = { ...head, committedAtMs: NOW - (cfg.site.versionLagMinutes + 1) * 60_000 };
    expect(deployLagResult('a'.repeat(40), old, NOW, cfg).status).to.equal('fail');
    expect(deployLagResult(head.sha, old, NOW, cfg).status).to.equal('pass');
  });

  it('names a red deploy-backend run as a failed deploy, critical, cleared by one green run', () => {
    const red = laneResult('deploy-backend.yml', { workflow: 'deploy-backend.yml', name: 'deploy-backend', conclusion: 'failure', url: 'https://github.com/x/runs/1', sha: 'c'.repeat(40) });
    expect(red.title).to.equal('The backend deploy failed');
    expect(red.severity).to.equal('critical');
    expect(red.passesToClear).to.equal(1);
  });

  it('warns about a GitHub token close to expiry', () => {
    const soon = new Date(NOW + 3 * 86_400_000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
    expect(tokenExpiryResult(soon, NOW, cfg).status).to.equal('fail');
    expect(tokenExpiryResult('2027-12-01 00:00:00 UTC', NOW, cfg).status).to.equal('pass');
    expect(tokenExpiryResult(null, NOW, cfg).status).to.equal('unknown');
  });
});
