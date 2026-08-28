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
    // Tier 0: 0.1 SOL entry, 5.12 SOL prize pool, 1.35 SOL first prize.
    expect(rows[0].entrySol).to.equal('0.1');
    expect(rows[0].potSol).to.equal('5.12');
    expect(rows[0].prizesSol[0]).to.equal('1.35');
    expect(rows[0].prizesSol[15]).to.equal('0.135');
    // Tier 6: 7.5 SOL entry, 384 SOL prize pool, 101.25 SOL first prize.
    expect(rows[6].entrySol).to.equal('7.5');
    expect(rows[6].potSol).to.equal('384');
    expect(rows[6].prizesSol[0]).to.equal('101.25');
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

  it('every mechanical body is filled — TODO_COPY only where founder/counsel prose is required', () => {
    for (const s of sections) {
      if (s.id === 'detection') {
        // R4: the criteria wording is founder/counsel prose (Phase 6) —
        // but the review-process appendix (C10) is mechanical and filled.
        expect(s.body).to.contain('TODO_COPY');
        expect(s.kind).to.equal('text');
        if (s.kind === 'text') {
          expect(s.appendix, 'review-process appendix').to.be.a('string');
          expect(s.appendix!).to.not.contain('TODO_COPY');
          expect(s.appendix!.length).to.be.greaterThan(100);
        }
        continue;
      }
      expect(s.body, s.id).to.not.contain('TODO_COPY');
      expect(s.body.length, s.id).to.be.greaterThan(40);
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
  it('renders from config/territories.json, names mapped', () => {
    const a = availability();
    expect(a.allowed).to.deep.equal(['United Kingdom', 'Ireland', 'Germany']);
    expect(a.blocked.length).to.equal(territories.blocked.length);
    expect(a.scheduleVersion).to.equal(territories.version);
  });
});
