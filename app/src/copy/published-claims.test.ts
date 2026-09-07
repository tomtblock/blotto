/*
 * THE PUBLISHED-CLAIMS REGISTER.
 *
 * CONTRIBUTING.md's rule is that a surface which cannot prove the claim it
 * makes must not make it. The rules page makes several operational promises —
 * things we say we DO, not things the program enforces — and on 2026-09-07 an
 * audit found two of them running ahead of the code: the terms wording the
 * founder ratified was shipped in the same pass as the copy, before the
 * mechanism it describes was built.
 *
 * This suite is the tripwire that stops that happening silently again. Every
 * operational promise in the published copy is listed below with the artefact
 * that proves it. A promise whose proof is `null` is a KNOWN GAP: it is
 * declared here, it appears in the audit's Open Items, and it is on the Road
 * to Mainnet checklist. The test fails when
 *
 *   - a promise is made and is not on this list (someone added a claim
 *     without deciding whether we can keep it), or
 *   - a promise on this list has a proof path that does not exist (the
 *     implementation was removed or moved and the claim outlived it), or
 *   - the known-gap set changes shape without this file being updated.
 *
 * It does NOT assert that a claim is honoured at runtime — no unit test can.
 * It asserts that somebody decided, in writing, that we can honour it.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY } from './index';
import { rulesSections } from '@/app/rules/rules.config';

const REPO = join(__dirname, '../../..');

interface Promised {
  /** A phrase that appears verbatim in published copy. */
  readonly phrase: string;
  /** What we are undertaking to do. */
  readonly commitment: string;
  /**
   * Repo-relative path of the thing that makes it true, or `null` when
   * nothing does yet. `null` is a declared gap, not an excuse.
   */
  readonly proof: string | null;
  /** For a gap: what closes it. */
  readonly gate?: string;
}

const PROMISES: readonly Promised[] = [
  {
    phrase: 'the tournament enters resolving',
    commitment: 'A settled pool occupies a named "resolving" state before prizes are final.',
    proof: null,
    gate: 'Phase 2 — the Resolving state. No such pool state exists; PoolState is Open, Sealed, Scored, Paid, Refunding, Closed.',
  },
  {
    phrase: 'we check the winning wallet against published sanctions lists',
    commitment: 'The winning wallet is screened against sanctions lists before payment.',
    proof: null,
    // Screening exists and runs at ENTRY (backend/sanctions, wired in the
    // packet service since Stage B): a listed wallet never holds a seat. The
    // published sentence is about the WINNER at resolving, which needs an
    // on-chain hold the program does not have — Stage F, founder-gated.
    gate: 'Phase 2 Stage F — the winner check at resolving. Entry screening is live (backend/packet/src/sanctions-wiring.ts); the resolving-time check needs a sanctions hold that both paths of release_escrow refuse.',
  },
  {
    phrase: 'If no decision is made within 12 hours, the flag is cleared and the prize is paid',
    commitment: 'An undecided flag is cleared and paid at the 12-hour mark.',
    proof: null,
    gate: 'Phase 2 — the daemon-side 12-hour commitment. The program has only the seven-day permissionless release, which is the safeguard and is published as such.',
  },
  {
    phrase: 'You may appeal within 7 days',
    commitment: 'An appeal route exists and a different reviewer decides it.',
    proof: null,
    gate: 'Phase 2 — the appeal flow. The review service records decisions but has no appeal path.',
  },
  {
    phrase: 'We do not seek to recover a prize already paid',
    commitment: 'A paid prize is never clawed back.',
    // Structural, and the strongest promise on this list: there is no
    // instruction that can take lamports back from a player's wallet, and the
    // standing-rules check fails the build if one is ever added.
    proof: 'scripts/check-standing-rules.sh',
  },
  {
    phrase: 'we pay the appealing player the full prize ourselves',
    commitment:
      'A successful appeal after payment is honoured by the operator out of its own funds.',
    // An undertaking about what the company does with its own money, not a
    // mechanism: the program has no route to reverse a completed payment and
    // deliberately never will. Its proof is the treasury it is paid from.
    proof: 'programs/blotto_cup/src/instructions/treasury.rs',
  },
  {
    phrase: 'Every decision is published in a signed log naming the reviewer',
    commitment: 'Review decisions are appended to a signed, reviewer-attributed log.',
    proof: 'backend/detection/src/log-pg.ts',
  },
  {
    phrase: 'A flagged prize is held by the program',
    commitment: 'A flagged share stays in the pool vault rather than being paid or taken.',
    proof: 'programs/blotto_cup/src/instructions/escrow.rs',
  },
  {
    phrase: 'the program allows anyone at all to release a held prize',
    commitment: 'After the safeguard window any signer can release a held share to its player.',
    proof: 'programs/blotto_cup/src/instructions/escrow.rs',
  },
  {
    phrase: 'Nothing is flagged automatically',
    commitment: 'No automated signal flags an entry; a flag is a named reviewer’s decision.',
    proof: 'backend/reveal/src/main.ts',
  },
  {
    phrase: 'anyone can trigger the start once the clock has ended',
    commitment: 'Sealing at the deadline is permissionless.',
    proof: 'programs/blotto_cup/src/instructions/seal.rs',
  },
  {
    phrase: 'Anyone can trigger the refund once the deadline passes',
    commitment: 'The refund fork is permissionless.',
    proof: 'programs/blotto_cup/src/instructions/refund.rs',
  },
  {
    phrase: 'The key that can decrypt them is generated and held by our systems',
    commitment: 'The pool secret is operator-generated, export-locked until the pool closes.',
    proof: 'backend/sealing/src/custody.ts',
  },
];

/**
 * Everything the rules page actually renders, as one searchable body of text.
 * Built from `rulesSections()` rather than from `COPY.rules` directly, because
 * several bodies are functions of the shared constants and only the rendered
 * section carries their final wording.
 */
function publishedCopy(): string {
  return rulesSections()
    .map((s) => `${s.heading}\n${s.body}\n${s.kind === 'text' ? (s.appendix ?? '') : ''}`)
    .join('\n');
}

describe('published claims are registered', () => {
  const copy = publishedCopy();

  it('every registered promise still appears in the copy', () => {
    // A promise that has left the copy should leave this register too —
    // otherwise the known-gap list overstates what we owe.
    for (const p of PROMISES) {
      expect(copy.includes(p.phrase), `no longer published: "${p.phrase}"`).toBe(true);
    }
  });

  it('every promise with a proof points at a file that exists', () => {
    for (const p of PROMISES) {
      if (p.proof === null) continue;
      expect(existsSync(join(REPO, p.proof)), `${p.proof} (proof for "${p.phrase}")`).toBe(true);
    }
  });

  it('the known gaps are exactly the four the audit recorded', () => {
    // Tightening this list is the point. When Phase 2 lands, its promise
    // moves from `proof: null` to a real path and this number drops. It must
    // never rise without a deliberate edit here.
    const gaps = PROMISES.filter((p) => p.proof === null);
    expect(gaps.map((p) => p.phrase).sort()).toEqual(
      [
        'If no decision is made within 12 hours, the flag is cleared and the prize is paid',
        'We check the winning wallet against published sanctions lists'.toLowerCase(),
        'You may appeal within 7 days',
        'the tournament enters resolving',
      ].sort()
    );
    for (const g of gaps) {
      expect(g.gate, `gap "${g.phrase}" must name what closes it`).toBeTruthy();
    }
  });

  it('no operational "we" promise in the review copy is unregistered', () => {
    // The review appendix is where operational promises collect. Every
    // sentence of it that says what WE do must be covered by a registered
    // phrase, so a new promise cannot be added without landing here.
    const appendix = COPY.rules.reviewProcess;
    const sentences = appendix
      .split(/(?<=\.)\s+/)
      .map((s) => s.trim())
      .filter((s) => /\b(we|us|our)\b/i.test(s));
    expect(sentences.length, 'the review copy should still make operational promises').toBeGreaterThan(0);
    const registered = PROMISES.map((p) => p.phrase.toLowerCase());
    for (const s of sentences) {
      const covered = registered.some((phrase) => s.toLowerCase().includes(phrase));
      expect(covered, `unregistered promise: "${s}"`).toBe(true);
    }
  });
});
