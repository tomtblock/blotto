/* D-B6 rules-tab specs: every displayed number derives from the shared
 * constants, every ratified section is present with a filled body, and the
 * availability list renders from the founder-owned config. */
import { describe, expect, it } from 'vitest';
import {
  MIN_SEATS,
  PAID_RANKS,
  TIER_ENTRY_LAMPORTS,
  TIER_POT_LAMPORTS,
  amountForRank,
} from '@blotto/scoring';
import territories from '@config/territories.json';
import { FIELD_RULES, availability, rulesSections, tierRows } from './rules.config';

describe('tierRows', () => {
  it('one row per configured tier, numbers from the shared table', () => {
    const rows = tierRows();
    expect(rows.length).to.equal(TIER_ENTRY_LAMPORTS.length);
    // Tier 0 (D-E1): 0.1 SOL entry, 4 SOL prize pool.
    expect(rows[0].entrySol).to.equal('0.1');
    expect(rows[0].potSol).to.equal('4');
    // Tier 6: 7.5 SOL entry, 300 SOL prize pool.
    expect(rows[6].entrySol).to.equal('7.5');
    expect(rows[6].potSol).to.equal('300');
  });

  it('one paid place (D-E2): the prize pool shown IS the winner’s prize at every tier', () => {
    expect(PAID_RANKS).to.equal(1);
    TIER_POT_LAMPORTS.forEach((pot, tier) => {
      expect(amountForRank(pot, 1), `tier ${tier}`).to.equal(pot);
      expect(amountForRank(pot, 2), `tier ${tier} rank 2`).to.equal(0n);
    });
  });
});

describe('FIELD_RULES', () => {
  it('carries the shared minimum field and go-timer, never hand-typed', () => {
    expect(FIELD_RULES.minSeats).to.equal(Number(MIN_SEATS));
    expect(FIELD_RULES.minSeats).to.equal(52);
    expect(FIELD_RULES.goTimerHours).to.be.greaterThan(0);
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
      'field-size',
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
    // D-E2: one paid place; a tie for first splits the pot (D3-B's rule).
    expect(byId.get('ties')!.body).to.contain('split the prize pool evenly');
    expect(byId.get('ties')!.body).to.contain('entered the pool earliest');
    expect(byId.get('ties')!.body).to.contain('nobody ranked below first is paid');
    expect(byId.get('prizes')!.body).to.contain('The player ranked first receives the whole prize pool');
    expect(byId.get('prizes')!.body).to.not.match(/\d+\s*[×x]/); // no multiple, ever
    expect(byId.get('prizes')!.body).to.not.contain('%');
    expect(byId.get('randomness')!.body).to.contain('class');
    expect(byId.get('randomness')!.body).to.contain('does not affect any stat');
    // D-E4: the minimum field and the go-timer, from the shared constants.
    expect(byId.get('field-size')!.body).to.contain(`at least ${FIELD_RULES.minSeats} players`);
    expect(byId.get('field-size')!.body).to.contain(`${FIELD_RULES.goTimerHours}-hour clock`);
    expect(byId.get('field-size')!.body).to.contain('Nobody decides when a pool runs');
    expect(byId.get('refund')!.body).to.contain('72 hours');
    expect(byId.get('refund')!.body).to.contain(`fewer than ${FIELD_RULES.minSeats} players`);
    expect(byId.get('how-to-enter')!.body).to.contain(`at least ${FIELD_RULES.minSeats} players`);
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
