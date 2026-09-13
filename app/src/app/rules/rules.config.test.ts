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
import { blockedTerritoryPhrase } from '@/rules/territories';

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
  it('carries the shared minimum field and timings, never hand-typed', () => {
    expect(FIELD_RULES.minSeats).to.equal(Number(MIN_SEATS));
    // R7-b (founder instruction 2026-09-12): 40, down from D-E4's 52. The
    // literal is kept beside the mirror deliberately — the assertion above
    // proves the page follows the shared constant, and this one proves the
    // shared constant is the number the founder ratified. Together they
    // catch a drift in either direction; the first alone would pass if both
    // moved by accident.
    expect(FIELD_RULES.minSeats).to.equal(40);
    // Founder ruling 2026-09-07: 12 hours, one clock; five-minute cooldown.
    expect(FIELD_RULES.fillDeadlineHours).to.equal(12);
    expect(FIELD_RULES.cooldownMinutes).to.equal(5);
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
      'battle-timer',
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
    // R9-b: the unlocked battle — the one on screen included — is the even
    // split; the effect is stated as performance, never as a chance.
    expect(byId.get('battle-timer')!.body).to.contain('including the one on your screen');
    expect(byId.get('battle-timer')!.body).to.contain('even split of 20 points');
    expect(byId.get('battle-timer')!.body).to.contain('three stats to two');
    expect(byId.get('battle-timer')!.body).to.not.match(/chance/i);
    // D-E2 + addendum ruling 3: an equal split, remainder to the lowest
    // entry number; a forfeited share passes to players, never to us.
    expect(byId.get('ties')!.body).to.contain('paid an equal share of the prize pool each');
    expect(byId.get('ties')!.body).to.contain('lowest entry number');
    expect(byId.get('ties')!.body).to.contain('nobody ranked below first is paid');
    expect(byId.get('ties')!.body).to.contain('divided equally between the remaining eligible players ranked first');
    expect(byId.get('ties')!.body).to.contain('It is never returned to us.');
    expect(byId.get('ties')!.body).to.not.match(/returns to us/i);
    expect(byId.get('prizes')!.body).to.contain('The player ranked first receives the whole prize pool');
    expect(byId.get('prizes')!.body).to.not.match(/\d+\s*[×x]/); // no multiple, ever
    expect(byId.get('prizes')!.body).to.not.contain('%');
    expect(byId.get('randomness')!.body).to.contain('class');
    expect(byId.get('randomness')!.body).to.contain('does not affect any stat');
    // D-E4 (option A): the minimum field and the one clock, from the shared
    // constants — 12 hours; no go-timer, no 72 hours anywhere.
    expect(byId.get('field-size')!.body).to.contain(`at least ${FIELD_RULES.minSeats} players`);
    expect(byId.get('field-size')!.body).to.contain(`up to ${FIELD_RULES.fillDeadlineHours} hours`);
    expect(byId.get('field-size')!.body).to.contain('Nobody decides when a pool runs');
    expect(byId.get('refund')!.body).to.contain(`${FIELD_RULES.fillDeadlineHours} hours after it opened`);
    expect(byId.get('refund')!.body).to.contain(`fewer than ${FIELD_RULES.minSeats} players`);
    expect(byId.get('how-to-enter')!.body).to.contain(`at least ${FIELD_RULES.minSeats} players`);
    expect(byId.get('how-to-enter')!.body).to.contain('One entry per wallet per pool');
    expect(byId.get('pool-opening')!.body).to.contain(`${FIELD_RULES.cooldownMinutes} minutes`);
    for (const s of sections) {
      expect(s.body, `${s.id} mentions 72 hours`).to.not.contain('72 hours');
      expect(s.body, `${s.id} mentions the go-timer`).to.not.match(/go-timer|go timer/i);
    }
    // Addendum ruling 1: 12 hours is the published review rule; seven days
    // is framed as the safeguard, never the deadline.
    const detection = byId.get('detection')!;
    expect(detection.kind).to.equal('text');
    const appendix = detection.kind === 'text' ? (detection.appendix ?? '') : '';
    expect(appendix).to.contain('Resolving lasts up to 12 hours');
    expect(appendix).to.contain('If no decision is made within 12 hours, the flag is cleared and the prize is paid');
    expect(appendix).to.contain('safeguard against our own failure');
    expect(appendix).to.not.match(/forfeit(ed|s)? to (the operator|us)/i);
    // Ruling 9: manual-only detection — nothing flags automatically.
    expect(detection.body).to.contain('Nothing is flagged automatically');
    const verify = byId.get('verify')!;
    expect(verify.kind).to.equal('verify');
    if (verify.kind === 'verify') expect(verify.href).to.equal('/verify');
  });
});

describe('availability', () => {
  // Rewritten for schedule version 3 (founder instruction 2026-09-12 §3.1);
  // the assertion it replaces pinned the two-territory list of 2026-08-28.
  it('renders from config/territories.json, every code named', () => {
    const a = availability();
    expect(a.posture).to.equal('block-list');
    expect(a.allowed).to.deep.equal([]);
    expect(a.blocked.length).to.equal(territories.blocked.length);
    expect(a.scheduleVersion).to.equal(territories.version);
    expect(a.updated).to.equal(territories.updated);
  });

  // The defect this guards is a player in a blocked territory being told so
  // by a page reading "SG". `territoryName` falls back to the raw code, on
  // purpose — a missing name must never become a missing block — so the
  // fallback has to be unreachable for anything actually in the schedule.
  // `scripts/check-territories.ts` asserts the same thing in CI; this keeps
  // it inside the suite that runs on an app change.
  it('never renders a bare code — every schedule entry has a display name', () => {
    for (const name of availability().blocked) {
      expect(name, `${name} looks like an unmapped code`).to.not.match(
        /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/
      );
    }
  });

  it('names the confirmed PID §9 countries in full', () => {
    const blocked = availability().blocked;
    for (const name of ['India', 'Belgium', 'Australia', 'Singapore', 'Saudi Arabia', 'Hong Kong']) {
      expect(blocked, name).to.include(name);
    }
  });
});

describe('blockedTerritoryPhrase', () => {
  // The block screen names the whole list; an entry surface has no room for
  // fourteen, so the same source produces a capped form rather than a second
  // hand-typed one.
  it('names every territory when uncapped, and ends with "and"', () => {
    const phrase = blockedTerritoryPhrase();
    expect(phrase).to.include('India');
    expect(phrase).to.include('and Singapore');
    for (const name of availability().blocked) expect(phrase, name).to.include(name);
  });

  it('caps at n and counts the rest', () => {
    const phrase = blockedTerritoryPhrase(3);
    const rest = availability().blocked.length - 3;
    expect(phrase).to.equal(
      `${availability().blocked.slice(0, 3).join(', ')} and ${rest} other territories`
    );
  });

  it('says "territory", singular, when exactly one is left over', () => {
    const all = availability().blocked.length;
    expect(blockedTerritoryPhrase(all - 1)).to.match(/ and 1 other territory$/);
  });
});
