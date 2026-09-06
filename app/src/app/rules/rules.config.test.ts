/* D-B6 rules-tab specs: every displayed number derives from the shared
 * constants, every ratified section is present with a filled body, and the
 * availability list renders from the founder-owned config. */
import { describe, expect, it } from 'vitest';
import { TIER_ENTRY_LAMPORTS } from '@blotto/scoring';
import territories from '@config/territories.json';
import { availability, rulesSections, tierRows } from './rules.config';

describe('tierRows', () => {
  it('one row per configured tier, numbers from the shared table', () => {
    const rows = tierRows();
    expect(rows.length).to.equal(TIER_ENTRY_LAMPORTS.length);
    // Tier 0 (D-E1): 0.1 SOL entry, 4 SOL prize pool, 1.0546875 SOL first prize.
    expect(rows[0].entrySol).to.equal('0.1');
    expect(rows[0].potSol).to.equal('4');
    expect(rows[0].prizesSol[0]).to.equal('1.0546875');
    expect(rows[0].prizesSol[15]).to.equal('0.10546875');
    // Tier 6: 7.5 SOL entry, 384 SOL prize pool, 101.25 SOL first prize.
    expect(rows[6].entrySol).to.equal('7.5');
    expect(rows[6].potSol).to.equal('300');
    expect(rows[6].prizesSol[0]).to.equal('79.1015625');
  });

  it('sixteen paid positions per tier', () => {
    for (const row of tierRows()) expect(row.prizesSol.length).to.equal(16);
  });
});

describe('rulesSections', () => {
  const sections = rulesSections();
  const ids = sections.map((s) => s.id);

  it('carries every ratified topic, in reading order', () => {
    expect(ids).to.deep.equal([
      'how-to-enter',
      'price',
      'prizes',
      'scoring',
      'ties',
      'randomness',
      'sealing',
      'refund',
      'pool-opening',
      'verify',
      'availability',
      'age',
      'responsible-play',
      'detection',
    ]);
  });

  it('every body is filled — no TODO_COPY anywhere (v3 D-UI-3)', () => {
    for (const s of sections) {
      expect(s.body, s.id).to.not.contain('TODO_COPY');
      expect(s.body.length, s.id).to.be.greaterThan(40);
      if (s.id === 'detection' && s.kind === 'text') {
        // The five-signal criteria statement (from the detection code) plus
        // the mechanical review-process appendix (C10). PHASE-D2-REVIEW:
        // founder/counsel may re-voice; substance must match the code.
        expect(s.body).to.contain('signals');
        expect(s.appendix, 'review-process appendix').to.be.a('string');
        expect(s.appendix!).to.not.contain('TODO_COPY');
        expect(s.appendix!.length).to.be.greaterThan(100);
      }
    }
  });

  it('the substance-fixed paragraphs state what the code enforces', () => {
    const byId = new Map(sections.map((s) => [s.id, s]));
    expect(byId.get('scoring')!.body).to.contain('three or more of its five stats');
    expect(byId.get('ties')!.body).to.contain('split the combined prize');
    expect(byId.get('ties')!.body).to.contain('entered the pool earliest');
    expect(byId.get('randomness')!.body).to.contain('class');
    expect(byId.get('randomness')!.body).to.contain('does not affect any stat');
    expect(byId.get('refund')!.body).to.contain('72 hours');
    const verify = byId.get('verify')!;
    expect(verify.kind).to.equal('verify');
    if (verify.kind === 'verify') expect(verify.href).to.equal('/verify');
  });
});

describe('availability', () => {
  it('renders from config/territories.json, names mapped (block-list posture, 2026-08-28)', () => {
    const a = availability();
    expect(a.posture).to.equal('block-list');
    expect(a.allowed).to.deep.equal([]);
    expect(a.blocked).to.deep.equal(['Belgium', 'Australia']);
    expect(a.blocked.length).to.equal(territories.blocked.length);
    expect(a.scheduleVersion).to.equal(territories.version);
  });
});
