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
import { CAPACITY, MIN_SEATS } from '@blotto/scoring';
import { COPY } from './index';
import { MIN_FIELD, FULL_FIELD } from '@/app/fair-play/fair-play.config';

const minSeats = Number(MIN_SEATS);
const capacity = Number(CAPACITY);

/** Every superseded field size that has appeared in published copy. */
const SUPERSEDED = [52, 32];

describe('the field size in player-facing copy', () => {
  it('states the live minimum on the success screen, the screen shown after payment', () => {
    const sealed = COPY.pool.checkBack(minSeats);
    expect(sealed).to.contain(`at least ${minSeats}`);
    for (const stale of SUPERSEDED) {
      expect(sealed, `sealed panel still names the superseded floor ${stale}`).to.not.contain(
        String(stale),
      );
    }
  });

  it('states the live minimum in the landing page how-it-works steps', () => {
    const steps = COPY.howItWorks.steps(minSeats);
    const bodies = steps.map((s) => s.body).join(' ');
    expect(bodies).to.contain(`at least ${minSeats} seated`);
    // The old string spelled it out, so the digits alone would not have caught it.
    expect(bodies).to.not.contain('fifty-two');
    for (const stale of SUPERSEDED) {
      expect(bodies, `landing steps still name the superseded floor ${stale}`).to.not.contain(
        String(stale),
      );
    }
  });

  it('heads the fair-play skill table with the field sizes the study is measured at', () => {
    // The numbers under these headings come from fair-play.config.ts, which
    // derives them. The headings are what was wrong: 40-seat evidence under a
    // "52 seats" label. Pin the label to the same source as the data.
    expect(MIN_FIELD).to.equal(minSeats);
    expect(FULL_FIELD).to.equal(capacity);
    expect(COPY.fairPlay.skillHeadings.min(MIN_FIELD)).to.equal(`First place, ${minSeats} seats`);
    expect(COPY.fairPlay.skillHeadings.full(FULL_FIELD)).to.equal(`First place, ${capacity} seats`);
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
    walk(COPY.howItWorks.steps(minSeats));
    walk(COPY.pool.checkBack(minSeats));

    const offenders = rendered.filter((s) => /\b52\b/.test(s) || /fifty-two/i.test(s));
    expect(offenders, `copy naming a superseded field size: ${offenders.join(' | ')}`).to.deep.equal(
      [],
    );
  });
});
