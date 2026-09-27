/*
 * THE PRIVACY NOTICE (2026-09-19).
 *
 * WHY THIS FILE EXISTS. There was no privacy notice and no /privacy route.
 * The inventory that should have produced one was taken on 2026-09-15 and
 * found, in its own words, "a privacy notice, a DPIA, and any retention
 * rule" missing altogether. This is the notice; the DPIA and the ratified
 * retention periods are still the founder's and counsel's.
 *
 * ── THE SOURCE IS THE INVENTORY, NOT ASSUMPTION ──────────────────────────
 *
 * Every line below is drafted from `docs/compliance/DATA-INVENTORY.md`
 * — §1 for what is held and what is not, §2 for what was minimised, §3
 * for retention (which periods code enforces and which are applied by hand). Where
 * this notice states a fact, a comment names the row it comes from. Nothing
 * here was written from memory of how the system probably works.
 *
 * ── THE ONE THING THIS NOTICE MUST NOT GET WRONG ─────────────────────────
 *
 * THE PERMANENCE DISCLOSURE. The results bundle goes to permanent storage
 * and carries every battle, salt, wallet, rank and amount. It cannot be
 * edited or deleted by anyone, including us. That is not a regrettable
 * side effect — it is the mechanism by which a player can recompute their
 * own result without trusting us — and it has to be said BEFORE a player
 * enters, not in an erasure clause afterwards. Two things are deliberately
 * NOT in it: the per-screen timings and the per-pool device marker (bundle
 * version 2, audit B-31).
 *
 * ── AUTOMATED DECISIONS ──────────────────────────────────────────────────
 *
 * Detection profiles entries and a decision can withhold a prize, which
 * engages the automated-decision rules. The safeguards those rules require
 * are meaningful human review and an effective opportunity to contest the
 * outcome. Both exist and both are stated plainly: the daemon flags
 * nothing (`backend/reveal/src/main.ts` — the `detect` hook returns
 * nothing), a person decides against published criteria, and the
 * complaints route is the way to contest it.
 *
 * ── RETENTION IS A POLICY, NOT YET A MECHANISM ───────────────────────────
 *
 * Nothing in the code deletes anything today except the fifteen-minute
 * location cache. §3 of the inventory sets the rules; they are adopted
 * here as the PUBLISHED periods and marked as policy rather than as a
 * mechanism, in those words, because publishing a period nothing enforces
 * as though it were enforced is the defect this repository keeps catching.
 *
 * DRAFT STATUS, recorded here and not on the page: drafted by people who
 * are not lawyers, and needing counsel's review before real money moves
 * (register rows R1 and R6).
 *
 * VOICE AND RETENTION PERIODS RATIFIED by the founder on 2026-09-22, after
 * reading the rendered page. The periods below are the published policy
 * rather than a proposal — which is exactly why each one still says, in
 * those words, that it is applied by hand and not enforced by code. What
 * counsel has not reviewed is whether the periods are the RIGHT ones; that
 * is a separate question from whether we publish them.
 */

import { COMPLAINT_RESOLVE_DAYS } from '@blotto/detection/complaints';
import { ESCROW_AUTO_RELEASE_SECS, REVIEW_WINDOW_SECS } from '@blotto/scoring';

const REVIEW_HOURS = Number(REVIEW_WINDOW_SECS / 3600n);
const RELEASE_DAYS = Number(ESCROW_AUTO_RELEASE_SECS / 86400n);
/** The geo cache's lifetime — backend/packet/src/geo-cache.ts. */
const GEO_CACHE_MINUTES = 15;

export interface PrivacySection {
  id: string;
  heading: string;
  body: string[];
  points?: string[];
  /** Rows of "what is held" — the inventory table, as a list. */
  held?: { what: string; why: string; kept: string }[];
  operator?: 'controller' | 'authority';
}

export const PRIVACY = {
  title: 'Privacy notice',
  intro:
    'What Blotto Cup holds about you, why, how long, and what you can ask us to do about it. It is short because we hold very little: no name, no date of birth, no documents, no phone number and no address.',
  updatedLine: (updated: string) => `Last updated ${updated}.`,
  operatorUnsetNote:
    'The operating entity is not yet incorporated, so the entries below that name the controller read “not yet set”. No real-money tournament runs until they are filled in.',
  /** The tab strip's accessible name (V2: one section at a time, or the whole notice). */
  tabsLabel: 'Sections of the privacy notice',
  /** Short tab labels, by section id — the headings stay the document's. */
  tabs: {
    controller: 'Who holds it',
    'what-we-hold': 'What we hold',
    'what-we-never-hold': 'Never held',
    'what-is-published': 'What is public',
    'device-marker': 'Device marker',
    'why-and-basis': 'Why we hold it',
    'automated-decisions': 'Decisions',
    retention: 'How long',
    'your-rights': 'Your rights',
    authority: 'Authority',
    contact: 'Contact',
  } as Record<string, string>,
  /** The draft-period marker, used on every retention row. */
  policyNote:
    'These periods are our published policy. Except for the location cache, they are not yet enforced by code: nothing in the system deletes anything automatically, and until that is built each period is a rule we apply by hand.',

  sections: [
    {
      id: 'controller',
      heading: 'Who holds your data',
      operator: 'controller',
      body: [
        'The entity named below is the controller of the data described in this notice. Where a value reads “not yet set”, the operating entity does not exist yet.',
      ],
    },
    {
      // Inventory §1, "Held, and where it goes" — every row. The two
      // 2026-09-16 corrections are carried: the sealed boxes have no public
      // reader, and the read API serves no ciphertext at all.
      id: 'what-we-hold',
      heading: 'What we hold',
      body: [
        'Everything we hold is tied to a wallet address rather than to a person: we never ask for your name, and nothing in this list identifies you unless your address does.',
      ],
      held: [
        {
          what: 'Your wallet address',
          why: 'It is how the program knows whose entry, whose prize and whose refund. It is on the chain, in the operator\u2019s own records of the chain, and in the published results.',
          kept: 'Permanently. It is on a public blockchain and in published results; nobody can remove it, the operator included.',
        },
        {
          what: 'Your email address, where there is one at all',
          why: 'We hold one only where you asked for the single message that tells you a tournament has finished. Otherwise the sign-in provider holds any email and our own stores never see one.',
          kept: 'Until the message is sent. We delete it in the same statement that records the send.',
        },
        {
          what: 'A location verdict when an entry is authorised',
          why: 'To apply the published territory rules. Your address is sent to the location provider; we keep the verdict and two octets of the network address, never the whole of it.',
          kept: `The verdict rides with the entry authorisation. The full address is held in memory for ${GEO_CACHE_MINUTES} minutes so a second entry does not cost a second lookup, and is never written to a column or a log line.`,
        },
        {
          what: 'Your confirmation of age and of these terms, and its signature',
          why: 'The program requires a recorded confirmation at the current terms version before it will authorise an entry.',
          kept: 'While the address can still enter. It is the evidence that the confirmation was given.',
        },
        {
          what: 'Your encrypted entry',
          why: 'Your seven battles, a random salt, how long you spent on each battle, and a marker derived for that tournament from your device. All of it is encrypted on your device before you pay, and no battle in the tournament can be read, by us or by anyone else, until the tournament closes.',
          kept: 'See the retention section. Nothing in the product serves it to anyone: the read interface has no route that returns an encrypted entry, before or after the reveal.',
        },
        {
          what: 'Detection reports',
          why: 'The five published signals, computed over every tournament, naming the addresses a signal fired on. Seen by the operator and by nobody else.',
          kept: 'See the retention section.',
        },
        {
          what: 'Decisions, and complaints',
          why: 'A decision about a flagged entry, with the criterion cited, in an append-only record. A complaint, with what you wrote and whether your wallet signed it.',
          kept: 'A decision is permanent by design: it is the record the operator can be checked against. A complaint: see the retention section.',
        },
      ],
      points: [
        'We run no analytics and no error-tracking script of any kind. Nothing on these pages reports your behaviour to anyone.',
        'The random salt that goes into your entry’s fingerprint is discarded by your own browser the moment the fingerprint is computed.',
      ],
    },
    {
      // Inventory §1 "Held by nothing of ours".
      id: 'what-we-never-hold',
      heading: 'What we never hold',
      body: ['We do not ask for, and have nowhere to put, any of the following.'],
      points: [
        'Your name.',
        'Your date of birth. You confirm you are over eighteen; we do not record when you were born.',
        'Identity documents of any kind. There is no identity check at entry and none at payment.',
        'Your phone number.',
        'Your postal address.',
        'Your full network address in any durable record. Two octets survive, in logs and in the record a sanctions refusal leaves.',
      ],
    },
    {
      // THE PERMANENCE DISCLOSURE, stated before entry (brief §4.4).
      // Sources: PRODUCT-FACTS §4 (what is published at reveal),
      // backend/reveal/src/bundle.ts (version 2), inventory §1.
      id: 'what-is-published',
      heading: 'What becomes public, permanently, when you enter',
      body: [
        'This is the most important thing in this notice, and it is said here rather than in the section about deleting things.',
        'When a tournament closes, we publish its full results to permanent storage. That published file carries, for every entry in the tournament: the seven battles as they were played, the salt that was sealed with them, the player’s wallet address, the rank, and the amount paid. It is the file anyone can use to recompute the whole result and check it against what the program committed to — that is why it exists, and it is what makes the outcome checkable rather than a matter of trusting us.',
        'It cannot be edited and it cannot be deleted by anyone, including the operator. If that is not acceptable to you, do not enter.',
        'Two things are deliberately kept out of it: how long you spent on each battle, and the marker derived from your device. Those reach the operator’s own detection process and are published nowhere.',
      ],
    },
    {
      // Inventory §1 and PRODUCT-FACTS §6, "Why the device marker in
      // particular": the published marker of bundle version 1 was stable
      // across pools, so it linked a player's entries. Version 2 does not
      // carry it, and the marker itself is derived per pool.
      id: 'device-marker',
      heading: 'Why the device marker is different for every tournament',
      body: [
        'One of the five integrity signals looks for the same device behind more than one entry in a single tournament. For that, a marker is derived from your device and sealed with your entry.',
        'It is derived freshly for each tournament, so the marker in one tournament cannot be matched against the marker in another. Your entries cannot be linked across tournaments, by anyone, the operator included — the signal works inside one tournament, which is the only place it needs to.',
      ],
    },
    {
      id: 'why-and-basis',
      heading: 'Why we hold it, and on what basis',
      body: ['Three reasons cover everything in this notice.'],
      points: [
        'To do what you have paid for — authorise your entry, run the tournament, score it and pay the prize. That is the agreement these terms record.',
        'Because the law requires it. Screening every address against published sanctions lists, and keeping the record of a refusal, is an obligation rather than a choice.',
        'Because the competition has to be fair to the other players. The five integrity signals and the decisions taken on them exist so that a tournament cannot be won by running several entries from one hand. That is a legitimate interest of ours and of every honest entrant.',
      ],
    },
    {
      // The automated-decision safeguards, stated plainly (brief §4.4).
      id: 'automated-decisions',
      heading: 'Decisions about you, and who takes them',
      body: [
        'Detection profiles entries: it computes the five published signals over a whole tournament and reports which entries a signal fired on. A decision that follows can withhold a prize, which is a decision with a real effect on you.',
        'No decision to withhold a prize is taken by software alone. The detection process flags nothing at all — it reports, and a person decides, against the criteria published on the rules page, and the decision and the criterion cited are recorded.',
        `If no decision is taken within ${REVIEW_HOURS} hours, the flag is cleared and the prize is paid; after ${RELEASE_DAYS} days anyone at all can release a held prize to the player it belongs to, without our involvement.`,
        'You may challenge a decision through our complaints route, and a person will answer it. That is not a formality: it is the point of having a route at all.',
      ],
    },
    {
      // Inventory §3: the retention rules, adopted here as the published
      // policy and marked as policy. Only the geo cache is enforced.
      id: 'retention',
      heading: 'How long we keep it',
      body: [
        'Two of these are enforced by code. The rest are policy, applied by hand until the code that enforces them is built — said plainly, because a period nobody enforces is not a protection.',
      ],
      points: [
        `Your full network address: ${GEO_CACHE_MINUTES} minutes, in memory, then gone. Enforced by code.`,
        'An email address given for a tournament-finished message: we delete it in the same statement that records the send. Enforced by code.',
        'Your encrypted entry, and the detection report for its tournament: until that tournament’s challenge window has closed and every decision on it is final. Policy.',
        'Your confirmation of age and terms: while your address can still enter. Policy.',
        'The record of a sanctions refusal: the period the obligation requires, which counsel will set. Policy, and not yet a number that can honestly be published as one.',
        `A complaint and what you wrote in it: answered within ${COMPLAINT_RESOLVE_DAYS} days, then kept for a reasonable period afterwards so the answer can be shown. Policy.`,
        'A decision about a flagged entry: permanently. It is the record that lets anyone check the decision against the criterion cited, and removing it would remove your protection along with the operator\u2019s.',
      ],
    },
    {
      // The honest on-chain caveat (brief §4.4). The program has no
      // instruction that can alter or remove a chain record, and the
      // published bundle is on permanent storage.
      id: 'your-rights',
      heading: 'What you can ask us to do',
      body: [
        'You can ask us for a copy of what we hold about your address, to correct it if it is wrong, to object to our holding it, or to erase it. You may challenge a decision through our complaints route in the same way, and a person will answer.',
        'One limit is real and is stated rather than glossed: what is on the blockchain, and what is in a published results file, cannot be erased by anyone — not by you, not by the operator, not by a court order, because no mechanism exists that could do it. The records are held by every copy of the network and by permanent storage. What we can erase is what we hold off the chain, and we will.',
        'An erasure request does not take back an entry you have made or a result that has been published, and it does not affect a prize you are owed.',
      ],
    },
    {
      id: 'authority',
      heading: 'Complaining to a supervisory authority',
      operator: 'authority',
      body: [
        'If you are not satisfied with how we have handled your data, you can complain to the supervisory authority named below. You do not have to complain to us first. The complaints route is usually quicker, and a person reads it.',
      ],
    },
    {
      id: 'contact',
      heading: 'How to reach us',
      body: [
        'Every route in this notice is the same one: the complaints page, linked from the foot of every page of this site. A person reads what arrives, and for anything that asks for an outcome to be changed your wallet signs the request, which is what proves it is yours.',
      ],
    },
  ] as readonly PrivacySection[],

  /** Labels for the controller rows. */
  controllerLabels: {
    legalName: 'Controller',
    companyNumber: 'Company number',
    registeredAddress: 'Registered address',
    noticeAddress: 'Address for data requests',
    supervisoryAuthority: 'Supervisory authority',
  },
  /** Column headings for the "what we hold" rows. */
  heldHeadings: { what: 'What', why: 'Why', kept: 'How long' },
} as const;
