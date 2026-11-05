/* D-B6 rules-tab specs: every displayed number derives from the shared
 * constants, every ratified section is present with a filled body, and the
 * availability list renders from the founder-owned config. */
import { describe, expect, it } from 'vitest';
import {
  LADDER_TABLES,
  MIN_FIELD_BY_CAPACITY,
  POOL_CAPACITIES,
  TIER_ENTRY_LAMPORTS,
  amountForRank,
  prizePoolFor,
} from '@blotto/scoring';
import territories from '@config/territories.json';
import { FIELD_RULES, availability, prizeTables, rulesSections, tierRows } from './rules.config';
import { blockedTerritoryPhrase } from '@/rules/territories';
import { lamportsToSol } from '@/data/format';

describe('tierRows', () => {
  it('one row per configured tier, numbers from the shared table', () => {
    const rows = tierRows();
    expect(rows.length).to.equal(TIER_ENTRY_LAMPORTS.length);
    expect(rows[0].entrySol).to.equal('0.1');
    expect(rows[6].entrySol).to.equal('7.5');
  });
});

/*
 * D-E19 (the Ladder): one prize table per pool size, a column per entry
 * price, every cell the engine's `amountForRank` — the rules page cannot
 * show a prize the program would not pay.
 */
describe('prizeTables', () => {
  const tables = prizeTables();

  it('one table per size, smallest first, each with its minimum field and paid places', () => {
    expect(tables.map((t) => t.capacity)).to.deep.equal([...POOL_CAPACITIES]);
    for (const t of tables) {
      expect(t.minField, `${t.capacity}`).to.equal(MIN_FIELD_BY_CAPACITY[t.capacity as 8 | 16 | 32 | 64]);
      expect(t.paidPlaces, `${t.capacity}`).to.equal(LADDER_TABLES[t.capacity as 8 | 16 | 32 | 64].length);
      expect(t.columns.length).to.equal(TIER_ENTRY_LAMPORTS.length);
      expect(t.heading).to.contain(`${t.capacity} players`);
      expect(t.heading).to.contain(`minimum field ${t.minField}`);
    }
  });

  it('every cell is amountForRank over the published table, and every band is one amount', () => {
    for (const t of tables) {
      const table = LADDER_TABLES[t.capacity as 8 | 16 | 32 | 64];
      // The bands cover every paid place exactly once, in order.
      expect(t.rows[0]!.from).to.equal(1);
      expect(t.rows[t.rows.length - 1]!.to).to.equal(table.length);
      TIER_ENTRY_LAMPORTS.forEach((entry, tier) => {
        for (const r of t.rows) {
          for (let place = r.from; place <= r.to; place++) {
            expect(r.perTier[tier], `${t.capacity} tier ${tier} place ${place}`).to.equal(
              lamportsToSol(amountForRank(table, entry, place).toString())
            );
          }
        }
        expect(t.totals[tier]).to.equal(lamportsToSol(prizePoolFor(table, entry).toString()));
      });
    }
  });

  it('shows the founder\u2019s launch figures at 0.1 SOL', () => {
    // The literals beside the derivation, as the field-size pin below does:
    // the test above proves the page follows the tables; this proves the
    // tables are the ones the founder ruled on 2026-11-04/05.
    const at = (capacity: number) =>
      tables.find((t) => t.capacity === capacity)!.rows.map((r) => [r.from, r.to, r.perTier[0]]);
    expect(at(8)).to.deep.equal([
      [1, 1, '0.3'],
      [2, 2, '0.2'],
    ]);
    expect(at(16)).to.deep.equal([
      [1, 1, '0.5'],
      [2, 2, '0.3'],
      [3, 3, '0.1'],
      [4, 4, '0.1'],
    ]);
    expect(at(32)).to.deep.equal([
      [1, 1, '0.8'],
      [2, 2, '0.4'],
      [3, 3, '0.2'],
      [4, 4, '0.2'],
      [5, 8, '0.1'],
    ]);
    expect(at(64)).to.deep.equal([
      [1, 1, '1.2'],
      [2, 2, '0.6'],
      [3, 3, '0.3'],
      [4, 4, '0.3'],
      [5, 8, '0.2'],
      [9, 16, '0.1'],
    ]);
  });
});

describe('FIELD_RULES', () => {
  it('carries the shared minimum fields and timings, never hand-typed', () => {
    for (const z of FIELD_RULES.sizes) {
      expect(z.minField, `${z.capacity}`).to.equal(MIN_FIELD_BY_CAPACITY[z.capacity as 8 | 16 | 32 | 64]);
    }
    // D-E19 (founder ruling 2026-11-04): 5 / 10 / 20 / 40 — each size's
    // break-even field. The literals are kept beside the mirror deliberately
    // — the assertion above proves the page follows the shared constant, and
    // this one proves the shared constant is the number the founder ratified.
    expect(FIELD_RULES.sizes.map((z) => [z.capacity, z.minField])).to.deep.equal([
      [8, 5],
      [16, 10],
      [32, 20],
      [64, 40],
    ]);
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
    // The board's buzzer rule (app/src/battle/board/spread.ts): one clock,
    // unplaced points spread evenly over unlocked battles, an untouched easy
    // battle is 20 in each stat; the effect is stated as performance, never
    // as a chance.
    expect(byId.get('battle-timer')!.body).to.contain('One clock runs for the whole board');
    expect(byId.get('battle-timer')!.body).to.contain('spread evenly across the stats of every battle you have not locked in');
    expect(byId.get('battle-timer')!.body).to.contain('20 points in each');
    expect(byId.get('battle-timer')!.body).to.contain('three stats to two');
    expect(byId.get('battle-timer')!.body).to.not.match(/chance/i);
    // D3-B under D-E19 + addendum ruling 3: a tie shares the places it
    // occupies, across the paid line too, remainder to the lowest entry
    // number; a forfeited share stays with the pool's players, never us.
    const ties = byId.get('ties')!.body;
    expect(ties).to.contain('share equally the prizes of the places they occupy together');
    expect(ties).to.contain('A tie that reaches past the last paid place');
    expect(ties).to.contain('lowest entry number');
    expect(ties).to.contain(
      'If a flag is upheld, the withheld prize stays in the pool\u2019s prize vault and can only ever be paid to other players of the same pool; it never goes to the operator.'
    );
    expect(ties).to.contain('It is never returned to us.');
    expect(ties).to.not.match(/returns to us/i);
    // The one-place rule is gone, not restated.
    expect(ties).to.not.match(/ranked first, they are paid|nobody ranked below first/i);
    const prizes = byId.get('prizes')!;
    expect(prizes.kind).to.equal('prizes');
    expect(prizes.body).to.contain('fixed prizes to its highest places');
    expect(prizes.body).to.contain('never by how many players entered');
    expect(prizes.body).to.not.match(/\d+\s*[×x]/); // no multiple, ever
    expect(prizes.body).to.not.contain('%');
    expect(prizes.body).to.not.match(/\bpot\b|winner takes|\bseat|\bc[a]sh|\bchance/i);
    if (prizes.kind === 'prizes') expect(prizes.tables.length).to.equal(POOL_CAPACITIES.length);
    expect(byId.get('randomness')!.body).to.contain('class');
    expect(byId.get('randomness')!.body).to.contain('does not affect any stat');
    // D-E4 (option A) under D-E19: each size's minimum field and the one
    // clock, from the shared constants — 12 hours; no go-timer, no 72 hours.
    for (const z of FIELD_RULES.sizes) {
      expect(byId.get('field-size')!.body).to.contain(`${z.minField} players in a pool of ${z.capacity}`);
      expect(byId.get('how-to-enter')!.body).to.contain(String(z.capacity));
    }
    expect(byId.get('field-size')!.body).to.contain(`up to ${FIELD_RULES.fillDeadlineHours} hours`);
    expect(byId.get('field-size')!.body).to.contain('Nobody decides when a pool runs');
    expect(byId.get('field-size')!.body).to.not.match(/\bseat/i);
    expect(byId.get('refund')!.body).to.contain(`${FIELD_RULES.fillDeadlineHours} hours after it opened`);
    expect(byId.get('refund')!.body).to.contain('fewer players than its minimum field');
    expect(byId.get('how-to-enter')!.body).to.contain('at least its minimum field');
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
  // fifteen, so the same source produces a capped form rather than a second
  // hand-typed one.
  it('names every territory when uncapped, and ends with "and"', () => {
    const phrase = blockedTerritoryPhrase();
    const names = availability().blocked;
    expect(phrase).to.include('India');
    // The join, not today's schedule. This read `and Singapore` until `US` was
    // added on 2026-09-21 and pushed Singapore off the end — the assertion was
    // about the "and", and pinning it to whichever territory happened to sort
    // last made a founder-owned config edit look like a code failure.
    expect(phrase).to.include(`and ${names[names.length - 1]}`);
    for (const name of names) expect(phrase, name).to.include(name);
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
