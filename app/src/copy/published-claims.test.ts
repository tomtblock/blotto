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
 *
 * ── WHAT 2026-09-19 CHANGED HERE ─────────────────────────────────────────
 *
 * 1. THREE SURFACES, NOT ONE. The terms of service and the privacy notice
 *    are new, and both are almost entirely first-person. `publishedCopy()`
 *    now builds from all three, so the catch-all below reads them. It would
 *    have been easy to leave them invisible to this suite — the copy source
 *    was `rulesSections()` alone, and a standalone page is not in it — and
 *    that would have been the same defect the compliance review of
 *    2026-09-16 found five times, committed deliberately.
 *
 * 2. A SECOND KIND OF ROW. A terms document contains undertakings no code
 *    can keep: a liability cap, a governing-law clause, a statement that we
 *    do not undertake uninterrupted availability, a retention period
 *    nothing yet enforces. Those are not operational promises with a
 *    missing mechanism — there is no mechanism to build. Forcing them to
 *    name a proof path would mean pointing at a file that does not prove
 *    them, which is worse than saying so. So a row is one of two kinds:
 *
 *      `mechanism`    kept by code. MUST name a proof path that exists.
 *      `undertaking`  a term of the agreement, or a published policy. MUST
 *                     name its basis, and MUST NOT appear on the rules page.
 *
 *    That last condition is load-bearing: it stops an operational promise
 *    being reclassified as an "undertaking" to escape needing a mechanism.
 *    The rules page describes what the system DOES, so anything it says
 *    needs code behind it. The type also makes a mechanism row with no
 *    proof unrepresentable, which is stronger than the `proof: null` check
 *    it replaces.
 *
 * 3. THE REVIEWER ROWS WENT. 'You may appeal within 7 days', 'Every
 *    decision is published in a signed log naming the reviewer' and 'we pay
 *    the appealing player the full prize ourselves' described the
 *    named-reviewer apparatus, which left the player-facing product on
 *    2026-09-19 because it could not keep them (audit O24 — the registry
 *    holds one person). Their replacements are registered against the same
 *    proof paths, which remain valid, plus the new complaints route.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REVIEW_WINDOW_SECS } from '@blotto/scoring';
import {
  COMPLAINT_ACKNOWLEDGE_WORKING_DAYS,
  COMPLAINT_RESOLVE_DAYS,
} from '@blotto/detection/complaint-windows';
import { COPY } from './index';
import { rulesSections } from '@/app/rules/rules.config';

const REPO = join(__dirname, '../../..');

interface Base {
  /** A phrase that appears verbatim in published copy. */
  readonly phrase: string;
  /** What we are undertaking to do. */
  readonly commitment: string;
}

/** A promise kept by code. The proof path is required, and must exist. */
interface Mechanism extends Base {
  readonly kind: 'mechanism';
  /** Repo-relative path of the thing that makes it true. */
  readonly proof: string;
}

/**
 * A term of the agreement, or a published policy, that no code keeps.
 *
 * `basis` says what makes it keepable and who owns it. These rows may only
 * appear on the terms page and the privacy notice — never on the rules
 * page, which describes what the system does.
 */
interface Undertaking extends Base {
  readonly kind: 'undertaking';
  readonly basis: string;
}

type Promised = Mechanism | Undertaking;

/* ── THE RULES PAGE ─────────────────────────────────────────────────────── */

const RULES_PROMISES: readonly Promised[] = [
  {
    kind: 'mechanism',
    phrase: 'the pool enters resolving',
    commitment: 'A settled pool occupies a named "resolving" state before prizes are final.',
    // Derived, not stored (Phase 2 Stage C): the read API computes it from
    // held shares and REVIEW_WINDOW_SECS, and both pool pages render it.
    // No PoolState variant was added — the copy describes a process the
    // operator runs, not a guarantee the chain enforces.
    proof: 'backend/indexer/src/read-api.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'your wallet is checked against published sanctions lists',
    commitment: 'Every entrant is screened against sanctions lists before an entry is accepted.',
    // Stage B: the packet service screens every entrant through the shared
    // wiring and refuses the packet on a failed screening. Disclosed on the
    // rules page and the Fair play page from 2026-09-08; it had been true
    // and unstated.
    proof: 'backend/packet/src/sanctions-wiring.ts',
  },
  {
    kind: 'mechanism',
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
    kind: 'mechanism',
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
    kind: 'mechanism',
    phrase: 'You may challenge a decision through our complaints route',
    commitment: 'A route exists to contest a decision, and a person answers it.',
    // REPLACES 'You may appeal within 7 days' (2026-09-19). That sentence
    // promised the appeal was "decided by a different reviewer within a
    // further 7 days", and the founder-owned registry holds one person, so
    // no appeal could be decided at all (audit O24) — a published right
    // nobody could exercise. The named-reviewer apparatus is out of the
    // product and the route is now POST /complaints, which a person reads
    // and answers within the published windows. The seven-day lodge
    // deadline is deliberately NOT published any more: the complaints
    // route imposes none, and a window nothing enforces is what this
    // register exists to catch. `appeals.ts` and its log are untouched and
    // still hold every row already written.
    proof: 'backend/detection/src/complaints.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'we will tell you which criterion was cited',
    commitment: 'A player who challenges a decision is told the ground relied on.',
    // The record it comes from: every decision row carries the criterion,
    // and the challenge is answered from that row. The terms' refusal
    // clause makes the same undertaking for a refused entry, where the
    // ground is recorded in config/blocked-wallets.README.md.
    proof: 'backend/detection/src/log-pg.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'the same device behind multiple entries in one pool',
    commitment:
      'Entries sharing one device inside a pool are correlated and surfaced to the person deciding.',
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
    kind: 'mechanism',
    phrase: 'do not seek to recover a prize already paid',
    commitment: 'A paid prize is never clawed back.',
    // Lower-cased 2026-09-19: the sentence it ends used to be its own
    // ("We do not seek..."), and now joins the one before it. Same
    // undertaking, same proof; a register phrase is matched as a substring,
    // so the capital was the only thing that changed.
    // Structural, and the strongest promise on this list: there is no
    // instruction that can take lamports back from a player's wallet, and the
    // standing-rules check fails the build if one is ever added.
    proof: 'scripts/check-standing-rules.sh',
  },
  {
    kind: 'mechanism',
    phrase: 'we pay you the full prize ourselves',
    commitment:
      'A successful challenge after payment is honoured by the operator out of its own funds.',
    // The phrase lost the word "appealing" with the appeal (2026-09-19);
    // the undertaking is unchanged and is the same money.
    // An undertaking about what the company does with its own money, not a
    // mechanism: the program has no route to reverse a completed payment and
    // deliberately never will. Its proof is the treasury it is paid from.
    proof: 'programs/blotto_cup/src/instructions/treasury.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'Every decision and the criterion cited are recorded',
    commitment: 'Review decisions and the criterion each cited are appended to a signed log.',
    // REPLACES 'Every decision is published in a signed log naming the
    // reviewer' (2026-09-19). The log is unchanged — append-only, every row
    // signed, every row re-verifiable from the row alone plus the registry
    // (`appeals.ts::verifyRow`). What is no longer promised to a player is
    // a NAME in it: the named-reviewer apparatus is out of the product, and
    // the disclosure that matters is the decision and the criterion.
    proof: 'backend/detection/src/log-pg.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'A flagged prize is held by the program',
    commitment: 'A flagged share stays in the pool vault rather than being paid or taken.',
    proof: 'programs/blotto_cup/src/instructions/escrow.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'the program allows anyone at all to release a held prize',
    commitment: 'After the safeguard window any signer can release a held share to its player.',
    proof: 'programs/blotto_cup/src/instructions/escrow.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'Nothing is flagged automatically',
    commitment: 'No automated signal flags an entry; a flag is a decision taken by a person.',
    proof: 'backend/reveal/src/main.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'anyone can trigger the start once the clock has ended',
    commitment: 'Sealing at the deadline is permissionless.',
    proof: 'programs/blotto_cup/src/instructions/seal.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'Anyone can trigger the refund once the deadline passes',
    commitment: 'The refund fork is permissionless.',
    proof: 'programs/blotto_cup/src/instructions/refund.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'The key that can decrypt them is generated and held by our systems',
    commitment: 'The pool secret is operator-generated, export-locked until the pool closes.',
    proof: 'backend/sealing/src/custody.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'can be read, by us or by anyone else',
    commitment: 'Not even the operator can read a sealed battle before the tournament closes.',
    // The same mechanism as the promise above, stated from our side: the
    // export policy is a TYPE every custody implementation must honour, and
    // it refuses the pool secret until the pool is sealed or past its fill
    // deadline. Sealing is a property, not a promise — this line is the
    // property said out loud.
    proof: 'backend/sealing/src/custody.ts',
  },
  {
    kind: 'mechanism',
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
    kind: 'mechanism',
    phrase: 'we identify that group',
    commitment: 'The operator names the players a passed-on prize is divided between.',
    // No judgement is involved: `rankOrder` shares a rank only when battles
    // won AND stats won are equal, and `assignPrizes` splits the pot equally
    // across that group with the indivisible remainder going to the lowest
    // entry index. The crank pays from that same computation.
    proof: 'backend/scoring/src/engine.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'The results bundle we publish after every pool',
    commitment:
      'A bundle is published for every settled tournament, carrying what a player needs to check the group we identified.',
    // Tradeoff order #3, made concrete: the bundle carries every entry's
    // revealed battles and every player's score, rank and amount, so a
    // reader recomputes the shared rank rather than taking our word for it.
    // The verify page does exactly that in the browser.
    proof: 'backend/reveal/src/bundle.ts',
  },
];


/* ── THE TERMS OF SERVICE (2026-09-19) ──────────────────────────────────── */

const TERMS_PROMISES: readonly Promised[] = [
  {
    kind: 'mechanism',
    phrase: 'your entry payment is held by the program until the tournament runs',
    commitment: 'An entry fee goes to the program, not to the operator.',
    proof: 'programs/blotto_cup/src/instructions/register.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'from our treasury before entries open',
    commitment: 'The prize is funded before a tournament takes its first entry.',
    proof: 'programs/blotto_cup/src/instructions/open_pool.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'it does not need our permission and it does not depend on us being available',
    commitment: 'The refund at the deadline is permissionless.',
    proof: 'programs/blotto_cup/src/instructions/refund.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'It is not paid to us and it is not paid to anyone else while the decision is open',
    commitment: 'A held prize stays in the pool vault while a decision is open.',
    proof: 'programs/blotto_cup/src/instructions/escrow.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'As a safeguard against our own failure',
    commitment: 'Anyone may release a held prize to its player after the safeguard window.',
    proof: 'programs/blotto_cup/src/instructions/escrow.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'It is never kept by us',
    commitment: 'A forfeited prize never reaches the operator.',
    proof: 'scripts/check-standing-rules.sh',
  },
  {
    kind: 'mechanism',
    phrase:
      'We may refuse to accept an entry from an address, or withhold a prize that has not yet been paid',
    commitment: 'A mechanism exists to refuse an entry from an address, and to withhold a prize.',
    // THE REFUSAL CLAUSE, and the reason the wallet blocklist was built
    // before the clause was written (brief §0.6). The withheld-prize half
    // is the escrow path, registered above; the refusal half is this list,
    // consulted at packet issuance beside the territory and sanctions
    // checks and answering the same generic rejection.
    proof: 'backend/packet/src/blocked-wallets.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'we will tell you which ground we relied on',
    commitment: 'The enumerated ground relied on for a refusal is recorded, per address.',
    // Keepable only because it is recorded when the decision is taken:
    // config/blocked-wallets.README.md carries one row per address with the
    // ground and the date, and this check fails the build when an address
    // is listed without one, or cites a ground the terms do not enumerate.
    proof: 'scripts/check-blocked-wallets.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'made by someone other than whoever made the original one wherever that is possible',
    commitment:
      'Whose key answered a challenge is recorded, so whether a different person answered it is ' +
      'checkable against the original decision rather than taken on trust.',
    // Deliberately "wherever that is possible" rather than a rule. The
    // previous wording — "decided by a different reviewer" — WAS a rule,
    // enforced by a check that refused the upholding reviewer, and with one
    // person in the registry it made the right unexercisable (audit O24).
    //
    // NOTHING ENFORCES THE DIFFERENCE NOW, so the record is the mechanism,
    // and this row names the file that keeps it: `answeredRow` requires a
    // `decidedBy` on every operator row and migration 0024 carries the
    // column, while the original decision's own decider is already in the
    // review log. Comparing the two says whether the undertaking was kept on
    // any given complaint.
    //
    // PHASE-N-REVIEW (2026-09-19): this row first pointed at complaints.ts
    // on the strength of "a route whose record shows who answered" — and the
    // record did not. The row passed because this register only checks that
    // a proof file EXISTS, which is worth remembering about every row here:
    // the file existing is not the promise being kept. The field was added
    // when the line-by-line read against PRODUCT-FACTS caught it.
    proof: 'backend/detection/src/complaints.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'A prize we withhold is never kept by us',
    commitment: 'A withheld prize passes to the next eligible player, never to the operator.',
    proof: 'programs/blotto_cup/src/instructions/escrow.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'We cannot recover a prize that has already been paid, and we will not try to',
    commitment: 'No instruction can take a paid prize back, and none will be added.',
    proof: 'scripts/check-standing-rules.sh',
  },
  {
    kind: 'mechanism',
    phrase: 'We cannot recover a key you have lost, we cannot move funds out of your wallet',
    commitment: 'The operator cannot move a player’s funds or reverse a confirmed transaction.',
    // The program's exit set is asserted in CI: there is no instruction that
    // can take lamports from a player's wallet, and no path from a vault to
    // the operator. The rest is a property of the chain.
    proof: 'scripts/check-standing-rules.sh',
  },
  {
    kind: 'mechanism',
    phrase: 'That refund is made by hand, by us, rather than by the program',
    commitment:
      'The lost-ciphertext refund is disclosed as a manual payment, because no code pays it.',
    // The file says so in capitals: "The published rule says that player's
    // entry fee is refunded. NOTHING IN THIS CODEBASE PAYS IT." Recorded
    // under "Disclosed residuals" in docs/compliance/SAFEGUARDS.md. Disclosing it is the whole
    // point of the row — the claim and the code agree BECAUSE the claim
    // says the code does not do it.
    proof: 'backend/reveal/src/crank.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'held in our custody and unreadable by anyone',
    commitment: 'A pool key is export-locked in operator custody until the pool closes.',
    proof: 'backend/sealing/src/custody.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'We may suspend it, or stop offering it altogether',
    commitment:
      'Pausing blocks new entries only: settlement and refunds keep working, so a suspension can never strand money.',
    proof: 'programs/blotto_cup/src/instructions/admin.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'That is enforced by the entry service, not left to us to remember',
    commitment:
      'Issuance requires an acceptance record at the CURRENT terms version, so a new version re-prompts every wallet.',
    proof: 'backend/packet/src/service.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'our complaints route is how you tell us',
    commitment: 'A complaints route exists and reaches a person.',
    proof: 'backend/detection/src/complaints.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'We will acknowledge a complaint within',
    commitment:
      'A complaint is acknowledged within the published window (five working days at this version).',
    // The FIGURE is COMPLAINT_ACKNOWLEDGE_WORKING_DAYS and the copy reads
    // it rather than typing it; the test below pins the rendered sentence
    // to the constant. A window one person can meet while a pool is
    // running — a window we miss is worse than one we never published.
    proof: 'backend/detection/src/complaint-windows.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'working days and answer it within',
    commitment:
      'A complaint is answered within the published window (thirty days at this version).',
    proof: 'backend/detection/src/complaint-windows.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'tell us through the complaints route and we will correct whichever is wrong',
    commitment: 'A contradiction between the published surfaces can be reported, and is corrected.',
    proof: 'backend/detection/src/complaints.ts',
  },
  // ── The undertakings. No mechanism exists, and none could: these are
  // terms of the agreement, and the document is the artefact. Each names
  // its basis, and none of them may appear on the rules page.
  {
    kind: 'undertaking',
    phrase: 'Our total liability to you in connection with a tournament is limited to the entry fee',
    commitment: 'Liability is capped at the entry fee paid for the affected tournament.',
    basis:
      'A term of the agreement, not a mechanism. Founder-and-counsel-owned: it is the clause counsel will look at first, and the cap is deliberately the one number a player can check against their own receipt.',
  },
  {
    kind: 'undertaking',
    phrase: 'our liability for death or personal injury caused by our negligence',
    commitment:
      'Liability that cannot lawfully be excluded is expressly not excluded, whatever the cap says.',
    basis:
      'A term of the agreement. Stated expressly because a cap written without it risks being unenforceable in its entirety; founder-and-counsel-owned.',
  },
  {
    kind: 'undertaking',
    phrase: 'are outside our control',
    commitment: 'Network conditions are disclosed as outside the operator’s control.',
    basis:
      'A statement of fact about a public blockchain, and an allocation of risk. The program’s own safeguards — the permissionless refund and the permissionless release — are what limit the cost of a delay, and both are registered as mechanisms above.',
  },
  {
    kind: 'undertaking',
    phrase: 'We do not undertake that the service will be available without interruption',
    commitment: 'No availability undertaking is given.',
    basis:
      'A term of the agreement, and the honest one: there is no uptime mechanism to point at, and promising availability we cannot measure would be the defect this register exists to catch.',
  },
  {
    kind: 'undertaking',
    phrase: 'We do not give tax advice',
    commitment: 'Tax is the player’s own responsibility.',
    basis: 'A term of the agreement. Nothing in the product computes, withholds or reports tax.',
  },
  {
    kind: 'undertaking',
    phrase: 'are the whole of the agreement between you and us',
    commitment: 'The published surfaces named are the whole agreement.',
    basis: 'A term of the agreement; founder-and-counsel-owned.',
  },
];

/* ── THE PRIVACY NOTICE (2026-09-19) ────────────────────────────────────── */

const PRIVACY_PROMISES: readonly Promised[] = [
  {
    kind: 'mechanism',
    phrase: 'what you can ask us to do about it',
    commitment: 'A route exists to exercise a data right, and it reaches a person.',
    proof: 'backend/detection/src/complaints.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'It is short because we hold very little',
    commitment: 'The inventory behind this notice is the one taken on 2026-09-15.',
    // Drafted from the inventory rather than from assumption, which is what
    // makes the list checkable: every row of "what we hold" traces to §1 of
    // that report.
    proof: 'docs/compliance/DATA-INVENTORY.md',
  },
  {
    kind: 'mechanism',
    phrase: 'Everything we hold is tied to a wallet address rather than to a person',
    commitment: 'Nothing held identifies a player except their own address.',
    proof: 'docs/compliance/DATA-INVENTORY.md',
  },
  {
    kind: 'mechanism',
    phrase: 'We hold one only where you asked for the single message',
    commitment: 'An email address is held only under a per-pool opt-in the wallet signed.',
    proof: 'backend/packet/src/notify-pool.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'Otherwise the sign-in provider holds any email and our own stores never see one',
    commitment: 'The product’s own stores hold no email except an opt-in address.',
    proof: 'backend/packet/src/notify.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'We delete it in the same statement that records the send',
    commitment: 'The opt-in address is deleted in the statement that records the send.',
    proof: 'backend/packet/src/stores-pg.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'we keep the verdict and two octets of the network address, never the whole of it',
    commitment: 'No full network address reaches a durable record.',
    proof: 'backend/_shared/src/short.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'We run no analytics and no error-tracking script of any kind',
    commitment: 'No analytics or error-tracking script is loaded by the app.',
    // The inventory's finding, and checkable by reading the layout: there
    // is no third-party script in the app at all.
    proof: 'app/src/app/layout.tsx',
  },
  {
    kind: 'mechanism',
    phrase: 'We do not ask for, and have nowhere to put, any of the following',
    commitment: 'No name, date of birth, document, phone number or postal address is collected.',
    proof: 'docs/compliance/DATA-INVENTORY.md',
  },
  {
    kind: 'mechanism',
    phrase: 'we do not record when you were born',
    commitment: 'Age is a signed confirmation; no date of birth is stored.',
    proof: 'backend/packet/src/attestations.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'we publish its full results to permanent storage',
    commitment:
      'A results bundle carrying every battle, salt, wallet, rank and amount is published permanently.',
    // THE PERMANENCE DISCLOSURE, stated before entry because it cannot be
    // undone afterwards — and it is the mechanism by which a player
    // recomputes their own result rather than trusting us.
    proof: 'backend/reveal/src/publisher-irys.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'it is what makes the outcome checkable rather than a matter of trusting us',
    commitment: 'The published file is sufficient to recompute the whole result.',
    proof: 'app/src/verify/logic.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'That is a legitimate interest of ours and of every honest entrant',
    commitment: 'The integrity signals exist to stop one hand running several entries.',
    proof: 'backend/detection/src/signals.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'without our involvement',
    commitment: 'The safeguard release needs nobody’s permission.',
    proof: 'programs/blotto_cup/src/instructions/escrow.rs',
  },
  {
    kind: 'mechanism',
    phrase: 'You can ask us for a copy of what we hold about your address',
    commitment: 'Access, correction, objection and erasure can be asked for, and are answered.',
    proof: 'backend/detection/src/complaints.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'What we can erase is what we hold off the chain, and we will',
    commitment: 'Off-chain data is erasable on request; chain and published records are not.',
    // The honest caveat is the point of the row: nothing can erase a chain
    // record or a published bundle, and the notice says so in the same
    // breath rather than in a footnote.
    proof: 'backend/reveal/src/publisher-irys.ts',
  },
  {
    kind: 'mechanism',
    phrase: 'If you are not satisfied with how we have handled your data',
    commitment: 'A supervisory authority can be complained to, and is named once it is known.',
    proof: 'config/operator.json',
  },
  {
    kind: 'mechanism',
    phrase: 'You do not have to complain to us first',
    commitment: 'Using the complaints route is not a precondition of any other remedy.',
    proof: 'backend/detection/src/complaints.ts',
  },
  // ── The undertakings.
  {
    kind: 'undertaking',
    phrase: 'These periods are our published policy',
    commitment:
      'The retention periods are policy applied by hand, not periods any code enforces — except the location cache and the opt-in address.',
    basis:
      'Adopted from §8 of the data-minimisation report as the published periods, and marked as policy in those words. Nothing in the code deletes anything on a schedule today; publishing a period as though it were enforced is the defect this register exists to catch, so the notice says which two ARE enforced and that the rest are applied by hand. Founder-and-counsel-owned, and PHASE-N-REVIEW until ratified.',
  },
  {
    kind: 'undertaking',
    phrase: 'each period is a rule we apply by hand',
    commitment: 'The unenforced retention periods are stated as manual, not automatic.',
    basis:
      'The same disclosure from the other side. Building the deletion path is the work that turns this row into a mechanism row.',
  },
];

const PROMISES: readonly Promised[] = [...RULES_PROMISES, ...TERMS_PROMISES, ...PRIVACY_PROMISES];

/**
 * Everything the RULES page renders, as one searchable body of text. Built
 * from `rulesSections()` rather than from `COPY.rules` directly, because
 * several bodies are functions of the shared constants and only the rendered
 * section carries their final wording.
 */
function rulesCopy(): string {
  return rulesSections()
    .map((s) => `${s.heading}\n${s.body}\n${s.kind === 'text' ? (s.appendix ?? '') : ''}`)
    .join('\n');
}

/**
 * Everything the TERMS page and the PRIVACY notice render as prose.
 *
 * HEADINGS ARE EXCLUDED, deliberately. A heading is a label for a clause —
 * "Our liability to you", "What we hold", "How to reach us" — and
 * registering a label as a promise would fill this register with rows that
 * undertake nothing, which is how a tripwire becomes noise. The clause's
 * own sentences carry the promises, and every one of them is registered
 * above. The rules page keeps its headings in its copy source, unchanged,
 * because its headings contain no first person and it costs nothing.
 *
 * Every other rendered string is here: the intros, the bodies, the bullet
 * points, the inventory rows of "what we hold", and the two operator notes.
 */
function documentCopy(): string {
  const lines: string[] = [];
  const t = COPY.terms;
  lines.push(t.intro, t.operatorUnsetNote);
  for (const s of t.sections) {
    lines.push(...s.body);
    if (s.points) lines.push(...s.points);
  }
  const p = COPY.privacy;
  lines.push(p.intro, p.operatorUnsetNote, p.policyNote);
  for (const s of p.sections) {
    lines.push(...s.body);
    if (s.points) lines.push(...s.points);
    if (s.held) for (const row of s.held) lines.push(row.what, row.why, row.kept);
  }
  return lines.join('\n');
}
/** Every player-facing surface this register covers. */
function publishedCopy(): string {
  return `${rulesCopy()}\n${documentCopy()}`;
}

describe('published claims are registered', () => {
  const rules = rulesCopy();
  const documents = documentCopy();
  const copy = publishedCopy();

  it('every registered promise still appears in the copy', () => {
    // A promise that has left the copy should leave this register too —
    // otherwise the register overstates what we owe.
    for (const p of PROMISES) {
      expect(copy.includes(p.phrase), `no longer published: "${p.phrase}"`).toBe(true);
    }
  });

  it('every mechanism points at a file that exists', () => {
    for (const p of PROMISES) {
      if (p.kind !== 'mechanism') continue;
      expect(p.proof.length, `empty proof for "${p.phrase}"`).toBeGreaterThan(0);
      expect(existsSync(join(REPO, p.proof)), `${p.proof} (proof for "${p.phrase}")`).toBe(true);
    }
  });

  it('no promise is a declared gap: every mechanism row names one', () => {
    // The four gaps the 2026-09-07 audit recorded all point at a mechanism
    // now. The TYPE makes a mechanism row without a proof unrepresentable,
    // which is stronger than the runtime check this replaces — but the
    // property is asserted anyway, because a type can be widened by
    // someone who has not read this comment.
    const gaps = PROMISES.filter((p) => p.kind === 'mechanism' && !p.proof);
    expect(gaps.map((p) => p.phrase)).toEqual([]);
  });

  it('an undertaking is never used to excuse an operational promise', () => {
    // THE LOAD-BEARING CONDITION of the two-kind register. The rules page
    // describes what the system DOES, so anything it says needs code behind
    // it; an `undertaking` row exists for a term of the agreement, and if
    // one of its phrases turns up on the rules page then somebody has
    // reclassified an operational promise to escape building a mechanism.
    for (const p of PROMISES) {
      if (p.kind !== 'undertaking') continue;
      expect(p.basis.length, `"${p.phrase}" must name its basis`).toBeGreaterThan(20);
      expect(
        rules.includes(p.phrase),
        `"${p.phrase}" is registered as an undertaking but appears on the RULES page, which ` +
          `describes what the system does — it needs a mechanism, not a basis`
      ).toBe(false);
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
    // And the terms state the same number, from the same constant.
    expect(documents).toContain(`If no decision is made within ${hours} hours`);
  });

  it('the complaint windows the terms publish are the constants the service holds', () => {
    // Registered as two claims (the acknowledgement and the resolution) and
    // rendered from the service's own constants, so the undertaking a player
    // reads cannot drift from the one the operator is working to.
    expect(documents).toContain(
      `acknowledge a complaint within ${COMPLAINT_ACKNOWLEDGE_WORKING_DAYS} working days`
    );
    expect(documents).toContain(`answer it within ${COMPLAINT_RESOLVE_DAYS} days`);
  });

  it('no operational "we" promise on any published surface is unregistered', () => {
    // Operational promises are not confined to the review appendix — the
    // ties section makes three of its own, and the terms and the privacy
    // notice are almost entirely first person. Every sentence of the
    // RENDERED copy that says what WE do must be covered by a registered
    // phrase, so a new promise cannot be added anywhere without landing here.
    const sentences = copy
      .split(/(?<=\.)\s+|\n/)
      .map((s) => s.trim())
      .filter((s) => /\b(we|us|our|ours|ourselves)\b/i.test(s));
    expect(
      sentences.length,
      'the published surfaces should still make operational promises'
    ).toBeGreaterThan(0);
    const registered = PROMISES.map((p) => p.phrase.toLowerCase());
    // EVERY gap in one run, not the first one. A register this size is
    // maintained by adding several rows at once, and a test that stops at
    // the first uncovered sentence turns that into a dozen rebuilds.
    const uncovered = sentences.filter(
      (s) => !registered.some((phrase) => s.toLowerCase().includes(phrase))
    );
    expect(uncovered, `${uncovered.length} unregistered promise(s)`).toEqual([]);
  });

  it('reads all three surfaces, not just the one it could see most easily', () => {
    // The copy source was `rulesSections()` alone until 2026-09-19, so a
    // standalone page was invisible to every assertion above. Leaving the
    // terms and the privacy notice out would have been green for the wrong
    // reason — the defect the compliance review found five times, committed
    // on purpose. This pins the source itself.
    expect(rules).toContain('Detection and review');
    expect(documents).toContain('refuse to accept an entry from an address');
    expect(documents).toContain('permanent storage');
    expect(TERMS_PROMISES.length).toBeGreaterThan(20);
    expect(PRIVACY_PROMISES.length).toBeGreaterThan(15);
  });
});
