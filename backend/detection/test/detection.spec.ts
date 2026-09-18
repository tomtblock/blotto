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
  duplicateSets,
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
    // `ipHash` left this fixture on 2026-09-16 with the field itself: no
    // IP-derived value reaches detection (founder ruling 2026-09-15).
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
      // The two reads the state preconditions run on (audit B-25). `decide`
      // itself never calls them — the route does, before it calls `decide` —
      // but they are part of the one seam so that no wiring can exist with
      // the write half and not the read half.
      async poolState() {
        return 'Scored';
      },
      async entryState() {
        return { flagged: true, settled: false, forfeited: false, sanctionsHold: false, escrowLamports: 0n };
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

/**
 * The product's own default must not look like collusion (DRIFT §H13).
 *
 * The even split is what every battle screen opens at AND what every unlocked
 * battle becomes when the ninety-second run clock expires. Two players who run
 * out of time therefore submit byte-identical sets having chosen nothing. This
 * was observed on the first devnet pool where two humans played: both timed
 * out, and the old code called it "exact 35-byte duplicate", severity `strong`
 * — the only severity this signal treats as conclusive on its own.
 */
describe('timed-out players are not colluders', () => {
  const EVEN_SPLIT = [20, 20, 20, 20, 20];

  /** A player whose run clock expired before they locked anything in. */
  const timedOut = (i: number): RevealedEntry => ({
    player: `T${i}`,
    index: i,
    battles: Array.from({ length: 7 }, () => [...EVEN_SPLIT]),
    timingsMs: Array.from({ length: 7 }, () => 12_000),
    deviceHash: sha(`dev:timeout:${i}`).toString('hex'),
    scoreHalf: 267,
  });

  it('two players who both ran out of time raise NO duplicate_sets finding', () => {
    const entries = [timedOut(1), timedOut(2), ...Array.from({ length: 10 }, (_, k) => human(k))];
    const dupes = duplicateSets(entries).filter((f) => f.signal === 'duplicate_sets');
    expect(dupes, 'the even split is the product speaking, not the player').to.have.length(0);
  });

  it('still catches genuine multi-accounting: identical CHOSEN allocations', () => {
    const chosen = human(99).battles;
    const seat = (n: number): RevealedEntry => ({
      ...human(n),
      player: `C${n}`,
      battles: chosen.map((b) => [...b]),
    });
    const dupes = duplicateSets([seat(1), seat(2), ...Array.from({ length: 6 }, (_, k) => human(k))]);
    expect(dupes, 'the attack worth detecting is unchanged').to.have.length(2);
    expect(dupes.every((f) => f.severity === 'strong')).to.equal(true);
  });

  it('a partial timeout is judged only on the battles both players chose', () => {
    // Both chose the same first four battles and then ran out of time.
    const chosen = human(7).battles.slice(0, 4);
    const partial = (n: number): RevealedEntry => ({
      ...human(n),
      player: `P${n}`,
      battles: [...chosen.map((b) => [...b]), ...Array.from({ length: 3 }, () => [...EVEN_SPLIT])],
    });
    const dupes = duplicateSets([partial(1), partial(2)]);
    expect(dupes, 'four identical chosen battles is still agreement').to.have.length(2);
    expect(dupes[0].detail).to.contain('4 of 7 chosen battles');
  });

  it('agreement on too few chosen battles is not evidence', () => {
    // Only three battles chosen by both — below MIN_COMPARABLE_BATTLES.
    const chosen = human(8).battles.slice(0, 3);
    const thin = (n: number): RevealedEntry => ({
      ...human(n),
      player: `X${n}`,
      battles: [...chosen.map((b) => [...b]), ...Array.from({ length: 4 }, () => [...EVEN_SPLIT])],
    });
    expect(duplicateSets([thin(1), thin(2)])).to.have.length(0);
  });
});
