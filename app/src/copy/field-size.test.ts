/*
 * THE FIELD-SIZE PIN.
 *
 * R7-b moved the minimum field 52 -> 40 on 2026-09-12. The program changed,
 * `rules.config.ts` changed (it already derived its number), and three
 * player-facing strings did not:
 *
 *   - the LANDING PAGE's how-it-works step 3 ("at least fifty-two seated"),
 *   - the SEALED PANEL, which a player reads immediately AFTER paying, and
 *   - the FAIR PLAY skill table's second column heading, which read
 *     "First place, 52 seats" over data computed at 40.
 *
 * All three survived a copy edit made on 2026-09-15, three days after the
 * rule changed, because nothing compared the words on the screen to the
 * constant they describe. `check-mirrors.py` pins Rust constants to
 * TypeScript ones; `scripts/check-published-numbers.ts` is the structural
 * gate that now covers copy. This suite is the per-string pin beneath it.
 *
 * PID 8.6 is why these three matter more than a typo: the fill deadline and
 * the refund rule must be stated accurately, and stated BEFORE payment.
 */

import { describe, expect, it } from 'vitest';
import { MIN_FIELD_BY_CAPACITY, POOL_CAPACITIES, LADDER_TABLES } from '@blotto/scoring';
import { COPY } from './index';
import { LAUNCH_SIZES } from '@/data/prizes';

/*
 * D-E19 (the Ladder, 2026-11-04): there is no one minimum field any more —
 * each size carries its own (5 / 10 / 20 / 40 for 8 / 16 / 32 / 64), and a
 * live pool's is its own record. So the pins below run over EVERY size, and
 * the strings that describe one pool take that pool's numbers as arguments.
 *
 * 32 left the superseded list on the same day: it was PID v0.5's minimum
 * field and is now a pool size, so "32 players" is a true sentence. 52
 * (D-E4's floor) has never been a size or a floor since, and stays banned.
 *
 * The fair-play heading pin that lived here moved with its page: the Fair
 * play page and its copy keys are re-cut per pool size by their own owner
 * (app/src/app/fair-play/), and the blunt sweep at the foot of this file
 * still covers every string they render.
 */
const SUPERSEDED = [52];

describe('the field size in player-facing copy', () => {
  it('states the POOL\u2019s own size and floor on the success screen, the screen shown after payment', () => {
    for (const capacity of POOL_CAPACITIES) {
      const minSeats = MIN_FIELD_BY_CAPACITY[capacity];
      const sealed = COPY.pool.checkBack(capacity, minSeats);
      expect(sealed, `pool of ${capacity}`).to.contain(`at least ${minSeats}`);
      expect(sealed, `pool of ${capacity}`).to.contain(`${capacity} players`);
      for (const stale of SUPERSEDED) {
        expect(sealed, `sealed panel names the superseded floor ${stale}`).to.not.contain(String(stale));
      }
    }
  });

  it('states every size and its own floor in the landing page how-it-works steps', () => {
    const bodies = COPY.howItWorks.steps(LAUNCH_SIZES)
      .map((s) => s.body)
      .join(' ');
    for (const capacity of POOL_CAPACITIES) {
      expect(bodies).to.contain(`${MIN_FIELD_BY_CAPACITY[capacity]} of ${capacity}`);
      expect(bodies).to.contain(`${LADDER_TABLES[capacity].length} in a pool of ${capacity}`);
    }
    // The old strings spelled it out, so the digits alone would not have caught it.
    expect(bodies).to.not.contain('fifty-two');
    expect(bodies).to.not.match(/sixty-four seats/i);
    for (const stale of SUPERSEDED) {
      expect(bodies, `landing steps name the superseded floor ${stale}`).to.not.match(new RegExp(`\\b${stale}\\b`));
    }
  });

  it('describes a pool by its own numbers on the entry rail and the pools tab, never a typed 64', () => {
    const points = COPY.pool.aboutPoints({ prizeSentence: 'x', capacity: 16, minSeats: 10, fillHours: 12 }).join(' ');
    expect(points).to.contain('16 players have entered');
    expect(points).to.contain('at least 10');
    expect(points).to.not.contain('64');
    expect(COPY.pool.entrantsOf(5, 8, 5)).to.equal('5 / 8 entered \u00b7 5 needed to run');
    expect(COPY.pool.refundRule(32, 20, 12)).to.contain('fewer than 20');
  });

  it('carries no superseded field size anywhere a player can read one', () => {
    // A blunt sweep over every rendered string in the module, so a new one
    // cannot appear in a surface this file does not know about yet.
    const rendered: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === 'string') rendered.push(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(COPY);
    walk(COPY.howItWorks.steps(LAUNCH_SIZES));
    for (const capacity of POOL_CAPACITIES) {
      walk(COPY.pool.checkBack(capacity, MIN_FIELD_BY_CAPACITY[capacity]));
    }

    const offenders = rendered.filter((s) => /\b52\b/.test(s) || /fifty-two/i.test(s));
    expect(offenders, `copy naming a superseded field size: ${offenders.join(' | ')}`).to.deep.equal(
      [],
    );
  });

  it('never says seats, a single winner, or sixty-four seats where it describes a pool (D-E19)', () => {
    const rendered: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === 'string') rendered.push(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(COPY);
    walk(COPY.howItWorks.steps(LAUNCH_SIZES));
    const stale = rendered.filter((s) =>
      /sixty[- ]four seats|winner takes|takes the (whole|full) prize pool|of 64 seats|\/ 64 entered/i.test(s),
    );
    expect(stale, `superseded one-place wording: ${stale.join(' | ')}`).to.deep.equal([]);
  });
});
