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

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REVIEW_WINDOW_SECS } from '@blotto/scoring';
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
    // Derived, not stored (Phase 2 Stage C): the read API computes it from
    // held shares and REVIEW_WINDOW_SECS, and both pool pages render it.
    // No PoolState variant was added — the copy describes a process the
    // operator runs, not a guarantee the chain enforces.
    proof: 'backend/indexer/src/read-api.ts',
  },
  {
    phrase: 'your wallet is checked against published sanctions lists',
    commitment: 'Every entrant is screened against sanctions lists before an entry is accepted.',
    // Stage B: the packet service screens every entrant through the shared
    // wiring and refuses the packet on a failed screening. Disclosed on the
    // rules page and the Fair play page from 2026-09-08; it had been true
    // and unstated.
    proof: 'backend/packet/src/sanctions-wiring.ts',
  },
  {
    phrase: 'we check the winning wallet against published sanctions lists',
    commitment: 'The winning wallet is screened against sanctions lists before payment.',
    // Fully operational at both ends (Stage F). At ENTRY the packet service
    // screens every entrant (Stage B). At RESOLVING the crank screens every
    // wallet in the committed payout list and places an on-chain
    // `sanctions_hold` on any it must not pay: `pay_prizes` then escrows
    // that share instead of sending it, both paths of `release_escrow`
    // refuse to let it out, and a held entry can receive no next-place
    // portion either. A screening that cannot answer holds too — the one
    // outcome the promise forbids is paying a wallet nobody checked.
    proof: 'backend/reveal/src/winner-screening.ts',
  },
  {
    phrase: 'If no decision is made within 12 hours, the flag is cleared and the prize is paid',
    commitment: 'An undecided flag is cleared and paid at the 12-hour mark.',
    // The daemon's review clock (Phase 2 Stage D): a settled, flagged,
    // still-escrowed, not-forfeited share is released to its player once
    // REVIEW_WINDOW_SECS has passed since the on-chain escrowed_at. The
    // flag BIT stays set — clear_flag refuses a settled entry by design —
    // so "cleared" is loose by one word; the outcome is exactly as
    // published. The program's own seven-day permissionless release
    // remains the safeguard behind it.
    proof: 'backend/reveal/src/daemon.ts',
  },
  {
    phrase: 'You may appeal within 7 days',
    commitment: 'An appeal route exists and a different reviewer decides it.',
    // Phase 2 Stage E: POST /appeals (player-signed, within seven days of
    // the upheld flag) and appeal decisions refused to the reviewer who
    // upheld the flag, all in the one signed log; the form is on the
    // results page for the affected wallet. The second reviewer the rule
    // needs is a founder-owned registry entry (audit O24).
    proof: 'backend/detection/src/appeals.ts',
  },
  {
    phrase: 'the same device behind multiple entries in one pool',
    commitment:
      'Entries sharing one device inside a pool are correlated and surfaced to the reviewer.',
    // NARROWED 2026-09-16, and listed here so the narrowing is load-bearing
    // rather than a one-off edit. The sentence read "the same device or
    // network origin" while the daemon passed `ipHash: ''` for every entry:
    // `deviceIpCorrelation` skips an empty key, so the network half
    // correlated nothing and never could. The device half is real, runs on
    // the sealed device hash, and is the HARD-BLOCK half under R11.
    //
    // Widening this sentence again requires the hashed-IP capture at
    // ciphertext submission, which is a privacy decision as well as a build:
    // it puts a network identifier into the detection pipeline. Until then
    // the claim stays the size of the code.
    proof: 'backend/detection/src/signals.ts',
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
  {
    phrase: 'no battle in the tournament can be read, by us or by anyone else',
    commitment: 'Not even the operator can read a sealed battle before the tournament closes.',
    // The same mechanism as the promise above, stated from our side: the
    // export policy is a TYPE every custody implementation must honour, and
    // it refuses the pool secret until the pool is sealed or past its fill
    // deadline. Sealing is a property, not a promise — this line is the
    // property said out loud.
    proof: 'backend/sealing/src/custody.ts',
  },
  {
    phrase: 'It is never returned to us',
    commitment: 'A forfeited first-place share is never taken by the operator.',
    // The founder's ruling of 2026-09-07: `forfeit_escrow` moves nothing, an
    // upheld flag leaves the share in its own pool vault, and the only
    // lamport exits are pay_prizes, release_escrow, pay_next_place and
    // refund. The standing-rules check asserts that exact exit set — and
    // that escrow.rs cannot address the treasury — so a route back to us
    // fails the build.
    proof: 'scripts/check-standing-rules.sh',
  },
  {
    phrase: 'we identify that group',
    commitment: 'The operator names the players a passed-on prize is divided between.',
    // No judgement is involved: `rankOrder` shares a rank only when battles
    // won AND stats won are equal, and `assignPrizes` splits the pot equally
    // across that group with the indivisible remainder going to the lowest
    // entry index. The crank pays from that same computation.
    proof: 'backend/scoring/src/engine.ts',
  },
  {
    phrase: 'The results bundle we publish after every tournament',
    commitment:
      'A bundle is published for every settled tournament, carrying what a player needs to check the group we identified.',
    // Tradeoff order #3, made concrete: the bundle carries every entry's
    // revealed battles and every player's score, rank and amount, so a
    // reader recomputes the shared rank rather than taking our word for it.
    // The verify page does exactly that in the browser.
    proof: 'backend/reveal/src/bundle.ts',
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

  it('no promise is a declared gap any more', () => {
    // All four the audit recorded now point at a mechanism: resolving at
    // Stage C, the 12-hour clock at D, the appeal at E, and the winner
    // check with its sanctions hold at F. This must never rise without a
    // deliberate edit here — a new `proof: null` means we published
    // something we cannot yet keep.
    const gaps = PROMISES.filter((p) => p.proof === null);
    expect(gaps.map((p) => p.phrase)).toEqual([]);
    for (const g of gaps) {
      expect(g.gate, `gap "${g.phrase}" must name what closes it`).toBeTruthy();
    }
  });

  it('the resolving window the copy states is the constant the code acts on', () => {
    // The founder's sentence says the number in words; the read API's badge
    // (Stage C) and the daemon's release (Stage D) read REVIEW_WINDOW_SECS.
    // If one moves without the other, this is where it shows.
    const hours = Number(REVIEW_WINDOW_SECS / 3600n);
    expect(COPY.rules.reviewProcess).toContain(`Resolving lasts up to ${hours} hours`);
    expect(COPY.rules.reviewProcess).toContain(`If no decision is made within ${hours} hours`);
    expect(COPY.pool.resolvingNote(hours)).toContain(`within ${hours} hours`);
  });

  it('no operational "we" promise on the rules page is unregistered', () => {
    // Operational promises are not confined to the review appendix — the
    // ties section makes three of its own. Every sentence of the RENDERED
    // page that says what WE do must be covered by a registered phrase, so
    // a new promise cannot be added anywhere on it without landing here.
    const sentences = copy
      .split(/(?<=\.)\s+/)
      .map((s) => s.trim())
      .filter((s) => /\b(we|us|our)\b/i.test(s));
    expect(sentences.length, 'the rules page should still make operational promises').toBeGreaterThan(0);
    const registered = PROMISES.map((p) => p.phrase.toLowerCase());
    for (const s of sentences) {
      const covered = registered.some((phrase) => s.toLowerCase().includes(phrase));
      expect(covered, `unregistered promise: "${s}"`).toBe(true);
    }
  });
});
