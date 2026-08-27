/**
 * Detection specs, including the roadmap 4.3 gate: a scripted test pool with two
 * colluding wallets → both flagged, everyone else clean and payable.
 */
import { expect } from 'chai';
import { createHash } from 'crypto';
import {
  MemoryDecisionLog,
  decide,
  detectPool,
  type ReviewActions,
  type RevealedEntry,
} from '../src';

const sha = (s: string) => createHash('sha256').update(s).digest();

/** A plausibly human entry: varied allocations, varied timings. */
function human(i: number): RevealedEntry {
  const battles = Array.from({ length: 7 }, (_, k) => {
    const h = sha(`b:${i}:${k}`);
    const d = [0, 1, 2, 3]
      .map((n) => (h[n * 2] | (h[n * 2 + 1] << 8)) % 101)
      .sort((a, b) => a - b);
    return [d[0], d[1] - d[0], d[2] - d[1], d[3] - d[2], 100 - d[3]];
  });
  const timings = Array.from({ length: 7 }, (_, k) => 3000 + (sha(`t:${i}:${k}`)[0] % 9000) + (k === 0 ? 4000 : 0));
  return {
    player: `H${i}`,
    index: i,
    battles,
    timingsMs: timings,
    deviceHash: sha(`dev:${i}`).toString('hex'),
    ipHash: sha(`ip:${i}`).toString('hex'),
    scoreHalf: 400 + (sha(`s:${i}`)[0] % 100),
  };
}

describe('the R11 gate: two colluders in a sixteen-player pool', () => {
  it('flags exactly the colluders; the other fourteen stay payable', () => {
    const entries = Array.from({ length: 14 }, (_, i) => human(i));
    // The colluders: identical battle sets AND the same device.
    const shared = human(90).battles;
    for (const [idx, name] of [
      [14, 'COLLUDER_A'],
      [15, 'COLLUDER_B'],
    ] as const) {
      entries.push({
        ...human(idx),
        player: name,
        index: idx,
        battles: shared.map((b) => [...b]),
        deviceHash: sha('shared-device').toString('hex'),
      });
    }
    const report = detectPool('POOL', entries, { fullEscrowTier: false });
    expect(report.hardBlocks).to.deep.equal(['COLLUDER_A', 'COLLUDER_B']);
    // Shadow mode logged the evidence for both signals.
    const colluderFindings = report.findings.filter((f) => f.player.startsWith('COLLUDER'));
    const signals = new Set(colluderFindings.map((f) => f.signal));
    expect(signals.has('duplicate_sets')).to.equal(true);
    expect(signals.has('device_ip_correlation')).to.equal(true);
    // Nobody else is blocked or recommended.
    expect(report.reviewRecommended.filter((p) => p.startsWith('H'))).to.deep.equal([]);
  });
});

describe('signal behaviour', () => {
  it('a scripted entry (uniform timings) is logged but NOT hard-blocked alone', () => {
    const entries = Array.from({ length: 8 }, (_, i) => human(i));
    entries.push({ ...human(50), player: 'BOT', timingsMs: Array(7).fill(1500) });
    const report = detectPool('POOL', entries, { fullEscrowTier: false });
    expect(report.hardBlocks).to.deep.equal([]);
    expect(report.findings.some((f) => f.player === 'BOT' && f.signal === 'timing_profile')).to.equal(true);
  });

  it('two independent signals recommend review; one does not', () => {
    const entries = Array.from({ length: 8 }, (_, i) => human(i));
    // Uniform timings AND near-zero entropy (same battle repeated).
    const one = human(60).battles[0];
    entries.push({
      ...human(60),
      player: 'SUSPECT',
      timingsMs: Array(7).fill(1500),
      battles: Array.from({ length: 7 }, () => [...one]),
    });
    const report = detectPool('POOL', entries, { fullEscrowTier: false });
    expect(report.reviewRecommended).to.deep.equal(['SUSPECT']);
    expect(report.hardBlocks).to.deep.equal([]);
  });

  it('the full-escrow tier (admin switch) escalates strong single signals', () => {
    const entries = Array.from({ length: 8 }, (_, i) => human(i));
    const one = human(70).battles[0];
    entries.push({
      ...human(70),
      player: 'LOWENT',
      battles: Array.from({ length: 7 }, () => [...one]),
      timingsMs: Array(7).fill(1500),
    });
    const off = detectPool('POOL', entries, { fullEscrowTier: false });
    expect(off.hardBlocks).to.deep.equal([]);
    const on = detectPool('POOL', entries, { fullEscrowTier: true });
    expect(on.hardBlocks).to.deep.equal(['LOWENT']);
  });

  it('zeroed device hashes never correlate (pre-Phase-4 payloads)', () => {
    const entries = Array.from({ length: 4 }, (_, i) => ({
      ...human(i),
      deviceHash: '0'.repeat(64),
    }));
    const report = detectPool('POOL', entries, { fullEscrowTier: false });
    expect(report.findings.filter((f) => f.signal === 'device_ip_correlation')).to.deep.equal([]);
  });
});

describe('the review decision log (4.4)', () => {
  it('applies the chain action and records the decision', async () => {
    const calls: string[] = [];
    const actions: ReviewActions = {
      async flagEntry(_p, w) {
        calls.push(`flag:${w}`);
      },
      async clearFlag(_p, w) {
        calls.push(`clear:${w}`);
      },
      async releaseEscrow(_p, w) {
        calls.push(`release:${w}`);
      },
      async forfeitEscrow(_p, w) {
        calls.push(`forfeit:${w}`);
      },
    };
    const log = new MemoryDecisionLog();
    await decide(actions, log, {
      pool: 'POOL',
      player: 'W',
      action: 'clear',
      criterion: 'reviewed: timings human on inspection',
      decidedBy: 'founder',
      decidedAt: '2026-08-27T00:00:00Z',
      signature: 'c2ln',
    });
    expect(calls).to.deep.equal(['clear:W']);
    const rows = await log.list('POOL');
    expect(rows.length).to.equal(1);
    expect(rows[0].action).to.equal('clear');
  });
});
