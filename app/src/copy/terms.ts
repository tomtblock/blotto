/*
 * THE TERMS OF SERVICE (2026-09-19).
 *
 * WHY THIS FILE EXISTS. There was no terms document. The clickwrap asked
 * every player to accept "the terms" and linked to /rules — so what a
 * player was agreeing to was a description of the game, and the agreement
 * itself did not exist. `config/terms.json` versioned a document that was
 * never written.
 *
 * ── THREE RULES THIS FILE IS WRITTEN UNDER ───────────────────────────────
 *
 * 1. EVERY FACTUAL ASSERTION MATCHES A ROW OF
 *    `docs/compliance/PRODUCT-FACTS.md` OR A CITED FILE.
 *    Anything that could not be matched was taken out rather than softened.
 *    Each section below names its source in a comment, so the next person
 *    can check a clause against the code in one hop.
 *
 * 2. NO NUMBER IS TYPED. Every figure is a function of the shared constant
 *    the program enforces (`@blotto/scoring`), for the reason
 *    `scripts/check-published-numbers.ts` exists: on 2026-09-12 a constant
 *    moved and three hand-typed strings kept the old figure while eleven
 *    self-testing gates reported clean. A terms document carrying a stale
 *    figure would be worse — it is the agreement.
 *
 * 3. NO UNDERTAKING WITHOUT A MECHANISM. Two clauses here needed code
 *    before they could be written truthfully: the refusal clause needed the
 *    wallet blocklist (`backend/packet/src/blocked-wallets.ts`) and the
 *    complaints clause needed the complaints route
 *    (`backend/detection/src/complaints.ts`). Both were built first. The
 *    claims register (`published-claims.test.ts`) fails the build if a
 *    promise here is not pinned to the artefact that keeps it.
 *
 * ── WHAT THIS DOCUMENT IS NOT ────────────────────────────────────────────
 *
 * DRAFT STATUS, recorded here and not on the page: this was drafted by
 * people who are not lawyers. It is a considerable improvement on having
 * none, and it still needs review by counsel before real money moves
 * (register rows R1 and R6). Anything touching PID §8 — the legal
 * characterisation — is founder-and-counsel-owned, which is why §"What this
 * is" asserts no legal category in either direction.
 *
 * VOICE RATIFIED by the founder on 2026-09-22, after reading the rendered
 * pages. The wording below is the published wording, not a proposal, and a
 * change to it is a change to the agreement rather than a tidy-up: it needs
 * the founder again, and `config/terms.json` bumped if the substance moves.
 *
 * WHAT IS STILL OUTSTANDING IS NOT THE VOICE. Counsel has not reviewed the
 * liability cap, the governing-law clause, the refusal clause's enumerated
 * grounds or the retention periods, and the operator is not named. Ratifying
 * how it reads does not ratify that it is sound in law.
 *
 * ── THE OPERATOR IS NOT NAMED YET ────────────────────────────────────────
 *
 * No company exists, so the counterparty, its addresses, the governing law
 * and the jurisdiction all render "not yet set" from `config/operator.json`,
 * and `scripts/check-operator-identity.ts` refuses a mainnet deploy while
 * that is so. The gap is visible on purpose.
 */

import {
  DEFAULT_FILL_DEADLINE_SECS,
  MIN_SEATS,
  REVIEW_WINDOW_SECS,
  ESCROW_AUTO_RELEASE_SECS,
} from '@blotto/scoring';
import {
  COMPLAINT_ACKNOWLEDGE_WORKING_DAYS,
  COMPLAINT_RESOLVE_DAYS,
} from '@blotto/detection/complaints';

/** Small display integers from the shared mirrors of the program constants. */
const MIN_FIELD = Number(MIN_SEATS);
const FILL_HOURS = Number(DEFAULT_FILL_DEADLINE_SECS / 3600n);
const REVIEW_HOURS = Number(REVIEW_WINDOW_SECS / 3600n);
const RELEASE_DAYS = Number(ESCROW_AUTO_RELEASE_SECS / 86400n);

/** The minimum age. Not a program constant — a founder-owned published rule. */
const MIN_AGE = 18;

export interface TermsSection {
  /** Stable anchor: the tile's hash, and the id a link inside the site uses. */
  id: string;
  heading: string;
  /** One paragraph per entry. */
  body: string[];
  /** Rendered as a list under the body, when the clause enumerates. */
  points?: string[];
  /** True where the section renders values from config/operator.json. */
  operator?: 'identity' | 'law';
}

export const TERMS = {
  title: 'Terms of service',
  /** Shown under the title. Says what the document is, and its two gaps. */
  intro:
    'These terms are the agreement between you and the operator of Blotto Cup. They apply when you accept them, which your wallet is asked to do before your first entry and again whenever these terms change.',
  /** The version line, from config/terms.json via the page. */
  versionLine: (version: number, updated: string) =>
    `Version ${version}, ${updated}. Accepting these terms is recorded against your wallet and against this version.`,
  /** The one honest line about the unnamed operator, shown when any value is unset. */
  operatorUnsetNote:
    'The operating entity is not yet incorporated, so the entries below that name it read “not yet set”. Nothing is hidden by that: no real-money tournament runs until they are filled in.',
  /** The tiles' group name (V3: a tile per section, or the whole document). */
  tilesLabel: 'Sections of the terms',
  /** Short tile labels, by section id — the headings stay the document's. */
  tiles: {
    'who-we-are': 'Who we are',
    eligibility: 'Who may enter',
    'what-this-is': 'The service',
    'entry-and-payment': 'Entering',
    'rules-as-published': 'Rules as published',
    prizes: 'Prizes',
    refunds: 'Refunds',
    integrity: 'Integrity',
    refusal: 'Refusal',
    liability: 'Liability',
    'blockchain-risk': 'Network risks',
    'two-residuals': 'Disclosures',
    availability: 'Availability',
    tax: 'Tax',
    changes: 'Changes',
    complaints: 'Complaints',
    law: 'Law',
    general: 'The rest',
  } as Record<string, string>,

  sections: [
    {
      id: 'who-we-are',
      heading: 'Who you are agreeing with',
      operator: 'identity',
      body: [
        'Blotto Cup is operated by the entity named below. Where a value reads “not yet set”, the operating entity does not exist yet and no real-money tournament runs until it does.',
      ],
    },
    {
      // PRODUCT-FACTS §5 (age, territory, sanctions at entry) and §1 (who
      // may enter). Every limb here is enforced by code today:
      // backend/packet/src/service.ts runs all five checks on every entry,
      // and the program refuses the four service keys itself
      // (instructions/register.rs, ServiceKeyCannotEnter).
      id: 'eligibility',
      heading: 'Who may enter',
      body: ['You may enter only if all of the following are true.'],
      points: [
        `You are ${MIN_AGE} or over. Your wallet signs a confirmation of this, and the confirmation is recorded against your wallet and the version of these terms you accepted.`,
        'You are not in a territory where Blotto Cup is unavailable. The list is published on the rules page, and where your location cannot be determined, entry is refused.',
        'Your address is not on a published sanctions list. Every address is screened before an entry is accepted, and again before a prize is paid.',
        'You are not using one of the four service keys — the admin, keeper, entry-signing and settlement keys. The program refuses them itself.',
        'One entry per address per tournament. There is no limit across tournaments.',
      ],
    },
    {
      // Deliberately describes the MECHANISM and asserts no legal category
      // in either direction (brief §4.3). PID §8 is founder-and-counsel's
      // and this document does not pre-empt it. Facts: PRODUCT-FACTS §1
      // (scoring, battles, stats) and §3 (the only random draw).
      //
      // Version 5 (founder 2026-09-27): the hard board. A tournament plays
      // one of two placing rules, recorded on it when it opens (Pool.mode);
      // the first paragraph now states both, and that the rule is shown
      // before entry. The scoring paragraph is unchanged because the
      // scoring rule is mode-blind (compareBattle).
      id: 'what-this-is',
      heading: 'What the service is',
      body: [
        'Blotto Cup runs tournaments. Up to sixty-four players pay a fixed entry for a tournament, and each player sets seven battles of five attributes under the placing rule that tournament was opened with: in an easy tournament, 100 points split across the five attributes in each battle; in a hard tournament, 700 points placed anywhere across the seven battles, any attribute from 0 to 700. Which rule a tournament plays is shown before you enter and cannot change once it has opened. Those seven decisions are encrypted on your own device before you pay, and the program records only a fingerprint of them.',
        'When the tournament closes, every entry is scored against every other entry by a published rule: for each of the seven battles, the entry that takes at least three of the five attributes wins it, and an equal split is a draw worth half a win to each. Players are ranked by battles won, then by attributes won. The player ranked first is paid the prize.',
        'Nothing in the path from your entry to the payment is decided by chance. The one random draw in the product chooses which character artwork your pass shows, and no class value is read anywhere in the scoring, ranking, prize or tiebreak path.',
        'These terms describe what the service does and how it decides. They do not assert what the service is in law, in either direction.',
      ],
    },
    {
      // PRODUCT-FACTS §2 (prize payment, no claim step) and PID §8.6
      // (decisions are final), which the entry screens state before payment.
      id: 'entry-and-payment',
      heading: 'Entering and paying',
      body: [
        'Each tier has one fixed entry price, published on the rules page. You pay it to the program, not to us: your entry payment is held by the program until the tournament runs.',
        'Decisions are final. Once your seven battles are submitted they cannot be changed or withdrawn, and neither can your entry. That is a property of the mechanism rather than a policy — your battles are encrypted before you pay and the program holds only their fingerprint, so there is nothing for anyone to edit.',
      ],
    },
    {
      // PRODUCT-FACTS §1: Pool.min_seats is written at open, so a later
      // change to the constant cannot move the floor under players who
      // already entered. R7-b (founder ruling 2026-09-13).
      id: 'rules-as-published',
      heading: 'The rules that apply are the ones published when you entered',
      body: [
        `Each tournament carries its own minimum field and its own deadline, recorded on it when it opens. A later change to either cannot move them for a tournament you have already entered: the numbers you were shown are the numbers your tournament plays by. Tournaments opened under the current rules run with at least ${MIN_FIELD} players and close to entries ${FILL_HOURS} hours after opening.`,
      ],
    },
    {
      // PRODUCT-FACTS §2: fixed pots funded before entries open; one paid
      // place (D-E2); the ties rule (D3-B); automatic payment (R10).
      id: 'prizes',
      heading: 'Prizes',
      body: [
        'Each tier has one fixed prize, published on the rules page. It is moved into the tournament’s own account from our treasury before entries open, so a tournament’s ability to pay never depends on how many people entered it. The prize is the same whether the field is the minimum or a full sixty-four.',
        'One place is paid: the player ranked first takes the whole prize. Players equal on both ranking criteria share a rank, and a tie for first splits the prize equally between them, with an indivisible remainder of a few lamports going to the eligible player with the lowest entry number. No other position is paid.',
        'Prizes are paid automatically when results are committed. There is no claim step and no action you need to take.',
      ],
    },
    {
      // PRODUCT-FACTS §1 (fill deadline) and §2 (a refunding pool returns
      // entries in full); instructions/refund.rs — trigger_refund is
      // permissionless and refuses at or above the floor.
      id: 'refunds',
      heading: 'Refunds',
      body: [
        `A tournament whose deadline passes with fewer than its minimum field refunds every entry in full and closes. Anyone can trigger that refund once the deadline has passed — it does not need our permission and it does not depend on us being available.`,
      ],
    },
    {
      // PRODUCT-FACTS §5 (detection is manual) and §2 (held prizes; the
      // 12-hour published rule; the seven-day permissionless release);
      // instructions/escrow.rs. The five signals are on the rules page.
      id: 'integrity',
      heading: 'Integrity, and a prize that is held',
      body: [
        // PHASE-N-REVIEW (2026-09-19): says "recorded in a log anyone can
        // read", NOT "published with the review record" — the wording the
        // rules page has carried since before this change. The five signals'
        // VALUES are not published: `GET /detection` serves the report to an
        // operator token and to nobody else (`backend/detection/src/server.ts`;
        // ruling D-E9). What IS public is `GET /decisions?pool=`, which needs
        // no token and returns every decision on a pool with the criterion
        // cited. The agreement must not assert the stronger thing. The rules
        // page's own sentence is founder-owned language and is flagged for
        // the founder rather than changed here.
        'Five signals are computed over every tournament. Nothing is flagged automatically: a flag is a decision taken by a person that an entry meets one of the criteria published on the rules page, and a flag by itself decides nothing — it holds the prize while the decision is made. Every decision and the criterion cited are recorded in a log anyone can read.',
        `A held prize stays in the tournament’s own account. It is not paid to us and it is not paid to anyone else while the decision is open. If no decision is made within ${REVIEW_HOURS} hours, the flag is cleared and the prize is paid. As a safeguard against our own failure, the program lets anyone at all release a held prize to the player it belongs to after ${RELEASE_DAYS} days, without our involvement.`,
        'Where a flag is upheld, the prize passes to the next eligible player in the same tournament. It is never kept by us: the program has no instruction that can move it to us, and no instruction that can take back a prize already paid.',
        'You may challenge a decision through our complaints route, and we will tell you which criterion was cited.',
      ],
    },
    {
      // THE REFUSAL CLAUSE. Wording per the brief §4.5, which is drafted to
      // be ENFORCEABLE: enumerated grounds, reasons given, and a challenge
      // route. Consumer Rights Act 2015 Schedule 2 paragraph 16 lists as
      // potentially unfair a term giving the trader the right to decide
      // whether its own service conforms, or the exclusive right to
      // interpret the contract; under section 62 an unfair term is NOT
      // BINDING on the consumer. So "at our discretion", "in our sole
      // judgement" and "based on our opinion" would protect nothing and
      // hand a regulator an obvious finding. Do not soften this to
      // discretion.
      //
      // Both halves are mechanised: the refusal is
      // backend/packet/src/blocked-wallets.ts (the ground recorded per
      // address in config/blocked-wallets.README.md, CI-enforced), and the
      // withheld prize is instructions/escrow.rs. The final paragraph is
      // the most valuable part of the clause and is already true in the
      // program — CI asserts the vault's exit set.
      id: 'refusal',
      heading: 'Refusing entry and withholding a prize',
      body: [
        'We may refuse to accept an entry from an address, or withhold a prize that has not yet been paid, where we determine on reasonable grounds that: the integrity criteria published in the rules have been met; the address is one of several controlled by the same person in a single tournament; entry was made from a territory where the service is not available, or by a person under 18, or by an address on a published sanctions list; or these terms have otherwise been breached.',
        'Where we do either, we will tell you which ground we relied on. You may challenge the decision through our complaints route, and a decision on that challenge will be made by someone other than whoever made the original one wherever that is possible.',
        'A prize we withhold is never kept by us. It passes to the next eligible player in the same tournament. We cannot recover a prize that has already been paid, and we will not try to.',
      ],
    },
    {
      // Capped at the entry fee for the affected tournament, with the
      // carve-outs that cannot lawfully be excluded stated expressly
      // (brief §4.3). Nothing here is a mechanism — it is an allocation of
      // risk, and it is the clause counsel will look at first.
      id: 'liability',
      heading: 'Our liability to you',
      body: [
        'Our total liability to you in connection with a tournament is limited to the entry fee you paid for that tournament.',
        'That limit does not apply to — and nothing in these terms excludes or limits — our liability for death or personal injury caused by our negligence, for fraud or fraudulent misrepresentation, or for anything else that cannot lawfully be excluded or limited. If any part of this clause is unenforceable, the rest of it still applies.',
      ],
    },
    {
      // Facts: the program runs on Solana and settlement depends on the
      // network being usable. "Your keys are yours" is the provider model
      // (D-08): an embedded wallet's key is held by the provider for the
      // player, and we cannot recover it and cannot reverse a transaction.
      id: 'blockchain-risk',
      heading: 'Risks that are not ours to control',
      body: [
        'Blotto Cup runs on Solana. A network halt, congestion, a fee spike or a transaction that fails to land are outside our control, and a tournament’s timing can be affected by them. Where that delays a settlement, the program’s own safeguards still apply — the refund at the deadline and the release of a held prize both remain available to anyone.',
        'Your wallet and its keys are yours. We cannot recover a key you have lost, we cannot move funds out of your wallet, and we cannot reverse a transaction once it has been confirmed. Nobody can.',
      ],
    },
    {
      // THE TWO DISCLOSED RESIDUALS. Both verified against the branch on
      // 2026-09-19 before being written here; disclosing them is safer than
      // not, and a reader can check both in one hop.
      //
      //  1. backend/reveal/src/crank.ts says in capitals that nothing in the
      //     codebase pays the lost-ciphertext refund; the remedy is one
      //     manual admin transaction per affected player, and the alert plus
      //     the published bundle's `scored_as_all_losses` list are the
      //     ledger. Recorded under "Disclosed residuals" in
      //     docs/compliance/SAFEGUARDS.md.
      //
      //  2. THE BRIEF NAMED THE WRONG KEY, and this is the corrected form.
      //     It said a permanently lost SETTLEMENT key would leave a sealed
      //     tournament's funds with no on-chain route out. That is not true
      //     on this branch: `set_settlement_signer` (admin-gated,
      //     instructions/admin.rs) rotates it, so settlement resumes. The
      //     real residual is the POOL SEALING key: the entries are encrypted
      //     to it, nothing can rotate it, and `trigger_refund` requires
      //     PoolState::Open (instructions/refund.rs), so a sealed tournament
      //     cannot be refunded either. PRODUCT-FACTS §1 states it in those
      //     terms under "Who opens pools".
      id: 'two-residuals',
      heading: 'Two things we disclose rather than discover',
      body: [
        'Where an entry’s encrypted battles cannot be read at the reveal, that entry is scored as all losses and its entry fee is refunded. That refund is made by hand, by us, rather than by the program: the tournament’s published data lists every entry it applies to, so you can check whether yours is one, but no code pays it.',
        'Each tournament is encrypted to a key of its own, held in our custody and unreadable by anyone — including us — until the tournament closes. Nothing can replace that key. If one were permanently lost after its tournament had closed to entries, that tournament could not be revealed, settled or refunded, and its funds would have no route out. This is why the key’s custody is disclosed in full on the keys page.',
      ],
    },
    {
      id: 'availability',
      heading: 'Availability',
      body: [
        'We do not undertake that the service will be available without interruption. We may suspend it, or stop offering it altogether. A tournament that is already open plays out under the rules it opened with: pausing new entries is the only thing a suspension does to the program, and it can never strand money — settlement and refunds keep working while entries are paused.',
      ],
    },
    {
      id: 'tax',
      heading: 'Tax',
      body: [
        'A prize may be taxable where you live. Working out what you owe, and paying it, is yours to do. We do not give tax advice and nothing here is any.',
      ],
    },
    {
      // Already true: packet issuance requires an attestation at the
      // CURRENT terms version (backend/packet/src/service.ts), so bumping
      // config/terms.json re-prompts every wallet before its next entry.
      id: 'changes',
      heading: 'Changes to these terms',
      body: [
        'When these terms change, the new version is published here and your wallet is asked to accept it before your next entry. An entry already made stands under the version you accepted when you made it; an acceptance of an older version does not let you enter again until you have accepted the current one. That is enforced by the entry service, not left to us to remember.',
      ],
    },
    {
      id: 'complaints',
      heading: 'Complaints and disputes',
      body: [
        `If something has gone wrong — a decision you want looked at again, a payment problem, the site, or anything about your own data — our complaints route is how you tell us. We will acknowledge a complaint within ${COMPLAINT_ACKNOWLEDGE_WORKING_DAYS} working days and answer it within ${COMPLAINT_RESOLVE_DAYS} days. A person reads every complaint; no software decides one.`,
        'Nothing in this clause takes away any right you have to go to a court or to a regulator instead.',
      ],
    },
    {
      id: 'law',
      heading: 'Governing law and jurisdiction',
      operator: 'law',
      body: [
        'These terms, and any dispute arising out of them, are governed by the law named below, and the courts named below have jurisdiction. Nothing here removes a protection the law where you live gives you and does not allow to be removed by agreement.',
      ],
    },
    {
      id: 'general',
      heading: 'The rest',
      body: [
        'If any part of these terms is found to be unenforceable, the rest of them still apply, and the unenforceable part applies as far as it lawfully can.',
        'These terms, the rules published on the rules page and the fair-play page, and the privacy notice, are the whole of the agreement between you and us about Blotto Cup. Where the rules page and these terms describe the same thing, they are meant to say the same thing; if they ever differ, tell us through the complaints route and we will correct whichever is wrong.',
      ],
    },
  ] as readonly TermsSection[],

  /** Labels for the operator identity rows. */
  identityLabels: {
    legalName: 'Operator',
    companyNumber: 'Company number',
    registeredAddress: 'Registered address',
    noticeAddress: 'Address for notices',
    governingLaw: 'Governing law',
    jurisdiction: 'Courts with jurisdiction',
  },
} as const;
