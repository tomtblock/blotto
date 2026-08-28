/*
 * The privacy and terms pages (founder direction, 2026-08-28: "Add a
 * privacy policy", "Add terms and conditions").
 *
 * ⚠ STATUS: DRAFT, PENDING COUNSEL. CLAUDE.md is explicit — anything
 * touching the legal characterisation is founder-and-counsel-owned without
 * exception. What is written below is therefore NOT invented legal
 * language: every clause states a MECHANIC this repository actually
 * implements, with the code path it comes from named in a comment. Counsel
 * supplies the operating entity, the retention schedule, liability,
 * governing law and the contact routes — those appear as `NOT_SET` and
 * render as an explicit "not yet set" line rather than a plausible
 * invention (the custody page's rule, applied to legal text).
 *
 * Flip `LEGAL_DRAFT` to false in ONE place once counsel has signed the
 * pages off; the banner disappears and nothing else changes.
 *
 * PID §8.7 applies here like everywhere else: these pages describe
 * mechanics and never assert a category, licence or fairness status.
 */

/** The visible "not reviewed yet" banner. One flag, one place. */
export const LEGAL_DRAFT = true;

/** A value only the founder or counsel can supply. Never guessed. */
export const NOT_SET = '__NOT_SET__' as const;

export interface LegalSection {
  id: string;
  heading: string;
  /** Paragraphs, in order. A NOT_SET entry renders as the missing-value line. */
  body: readonly string[];
  /** Optional bullet facts under the paragraphs. */
  points?: readonly string[];
}

export const LEGAL_COPY = {
  draftBanner:
    'Draft. These pages describe how the product works today and have not yet been reviewed by a lawyer. They are not yet in force.',
  notYetSet: 'not yet set — to be supplied before launch',
  lastUpdated: 'Last updated',
  updated: '28 August 2026',
  privacyTitle: 'Privacy',
  privacyIntro:
    'What personal data Blotto Cup handles, why it is handled, and what you can ask for. This page describes the system as it is built, not as it might be.',
  termsTitle: 'Terms and conditions',
  termsIntro:
    'The terms you accept before entering. Every clause below states something the program or the service actually does; the full mechanics are on the fair play page.',
  bothLink: 'Fair play & availability',
} as const;

/* ------------------------------------------------------------------ */
/* Privacy                                                             */
/* ------------------------------------------------------------------ */

export const PRIVACY_SECTIONS: readonly LegalSection[] = [
  {
    id: 'who',
    heading: 'Who handles your data',
    body: [
      'The operating entity responsible for the personal data described here:',
      NOT_SET,
      'The contact route for privacy questions and requests:',
      NOT_SET,
    ],
  },
  {
    id: 'public',
    heading: 'What is public forever',
    body: [
      'Blotto Cup runs on a public blockchain. The following is written to that chain by the program, is visible to anyone, and cannot be edited or removed by the operator or by us — not on request, not by court order, not ever:',
      'After a pool closes, the sealed battles of every entry in it are published so that any player can recompute the result. Before a pool closes nobody can read them, the operator included.',
    ],
    points: [
      'Your wallet address',
      'That the wallet entered a given pool, and when',
      'The character class drawn for that entry',
      'The result, the ranking and the amount paid',
      'Your seven battles, after the pool closes',
    ],
  },
  {
    id: 'collected',
    heading: 'What is collected, and why',
    body: [
      'Only what an entry needs. Each item below exists for one stated purpose.',
    ],
    points: [
      // src/wallet/privy-bridge.tsx — the sign-in provider owns the account.
      'Sign-in identity. Signing in with Google, Apple or X passes that account to our sign-in provider, which creates a wallet for you. We receive the wallet address. Connecting your own wallet instead shares no account at all.',
      // backend/packet/src/service.ts — geo lookup at pre-flight and at entry.
      'Your IP address, at the moment availability is checked and at the moment you enter. It is sent to a location vendor to determine the country or region and whether the connection is a VPN or proxy. This decides eligibility and nothing else.',
      // src/entry/device.ts — 32 random bytes, not a fingerprint.
      'A device marker: 32 random bytes generated in your browser and kept in its local storage, sent with your sealed entry. It is not a fingerprint — it carries no facts about your device, identifies a browser profile only, and clearing site data replaces it.',
      // battle/machine.ts captures timingsMs per screen.
      'How long each of the seven battle screens took, in milliseconds, as one of the published integrity signals.',
      // entry/attestation.ts
      'Your acceptance of these terms: the wallet signature, the version accepted, and when.',
      // shell/notifications.tsx — opt-in only.
      'An email address, only if you switch on notification emails, and only to send updates about pools you entered.',
    ],
  },
  {
    id: 'purposes',
    heading: 'What it is used for',
    body: [
      'Eligibility: confirming age acceptance, the territory schedule, and sanctions screening before an entry is accepted.',
      'Integrity: the five published detection signals, computed after a pool is revealed. A flag never decides anything by itself — it sends the entry to the signed review process described on the fair play page.',
      'Payment: paying prizes and refunds, which the program performs on-chain.',
      'Support and notifications: answering you, and sending the updates you switched on.',
    ],
  },
  {
    id: 'sharing',
    heading: 'Who else sees it',
    body: [
      'Service providers, each for one job, and none of them for their own purposes:',
      'The named providers are listed here once the operating entity is set:',
      NOT_SET,
    ],
    points: [
      'The sign-in and wallet provider (account, embedded wallet)',
      'The location vendor (IP → country or region, VPN or proxy)',
      'The sanctions screening provider (wallet and country)',
      'Hosting, the database host, and the blockchain node provider',
      'The permanent-storage publisher that carries each pool’s published result bundle',
    ],
  },
  {
    id: 'retention',
    heading: 'How long it is kept',
    body: [
      'On-chain data is permanent and outside anyone’s control, as described above.',
      'For everything held off-chain, the retention schedule:',
      NOT_SET,
    ],
  },
  {
    id: 'rights',
    heading: 'Your rights',
    body: [
      'Depending on where you live you can ask for a copy of your personal data, ask for it to be corrected, ask for it to be deleted, object to how it is used, or ask for it in a portable form. We answer every request we can.',
      'One limit is physical, not a policy: data already written to the blockchain cannot be changed or removed by anyone. A deletion request covers what is held off-chain.',
      'The route for making a request, and the supervisory authority you can complain to:',
      NOT_SET,
    ],
  },
  {
    id: 'storage',
    heading: 'Cookies and local storage',
    body: [
      'There is no advertising or cross-site tracking on this site.',
      'Your browser’s local storage holds three things: the device marker described above, your notification choice, and a note that this wallet has accepted the current terms version. The sign-in provider sets its own storage to keep you signed in.',
    ],
  },
  {
    id: 'age',
    heading: 'Age',
    body: [
      'Blotto Cup is for adults 18 and older. Entering requires a signed confirmation of age, recorded per wallet and per terms version. We do not knowingly handle the data of anyone under 18.',
    ],
  },
  {
    id: 'changes',
    heading: 'Changes to this page',
    body: [
      'Changes are versioned and dated. Material changes to what is collected or why are put to you again before your next entry.',
    ],
  },
] as const;

/* ------------------------------------------------------------------ */
/* Terms                                                               */
/* ------------------------------------------------------------------ */

export const TERMS_SECTIONS: readonly LegalSection[] = [
  {
    id: 'parties',
    heading: 'Who these terms are with',
    body: ['The operating entity you are contracting with:', NOT_SET],
  },
  {
    id: 'eligibility',
    heading: 'Who can enter',
    body: [
      'You must be 18 or older, and entering a paid tournament for prizes must be lawful where you are. You confirm both with a wallet signature before your first entry, and again whenever the terms version changes.',
      'Entry is not available from the territories on the published schedule, and where the service cannot determine your location, entry is not available. Wallets and countries are screened against sanctions before an entry is accepted.',
    ],
  },
  {
    id: 'entry',
    heading: 'What an entry is',
    body: [
      'A pool holds exactly 64 entries at one fixed price. You set seven battles, each splitting exactly 100 points across five stats. Your battles are encrypted on your device before any payment moves, and a hash of them is recorded on-chain with your entry.',
      'Decisions are final. Once your seven battles are submitted they cannot be changed or withdrawn. If the timer on a battle screen runs out, that battle locks exactly what the pentagon shows at that moment — nothing is ever chosen for you.',
    ],
  },
  {
    id: 'prizes',
    heading: 'Prizes',
    body: [
      'Every pool pays from a prize pool that is funded before entries open. The top 16 positions are paid on the published table, in exact 1024ths of that pool. Prizes are paid automatically by the program when results are committed; there is no claim step.',
      'Ties are settled by the published rule: players equal on battles won and stats won share a rank and split the combined prize of the positions they occupy, evenly.',
      'You are responsible for any taxes that apply to prizes you receive.',
    ],
  },
  {
    id: 'refunds',
    heading: 'Refunds',
    body: [
      'If a pool does not reach 64 entries within 72 hours, every entry in it is refunded in full, including the platform share. Your entry payment is held by the program until the pool fills, so the refund does not depend on the operator: once the deadline passes, anyone can trigger it and no one’s permission is needed.',
      'Outside that rule, an accepted entry is not refundable — see “What an entry is”.',
    ],
  },
  {
    id: 'integrity',
    heading: 'Integrity and review',
    body: [
      'Five published signals are computed over data every player can see once a pool is revealed. No single soft signal flags an entry — a flag needs two independent signals — with two exceptions that are conclusive on their own: exactly identical battle sets, and two entries from the same device.',
      'A flagged prize share is not paid out. It is held by the program while a named member of the operating multisig reviews the entry against the published criteria, and every decision is recorded in a public log signed by the reviewer who made it. A cleared share is released to the player in full; an upheld one is forfeited.',
      'Entering the same pool more than once, sharing an allocation set with another entrant, or automating entries are the behaviours these signals exist to catch.',
    ],
  },
  {
    id: 'pass',
    heading: 'The character pass',
    body: [
      'Each entry mints a character pass to your wallet. It is permanently non-transferable: there is no instruction in the program that can unfreeze it.',
      'Class is cosmetic. It affects no stat, no battle, no score, no ranking and no prize, and nothing in the scoring path reads it. Randomness from a Switchboard VRF seed, combined with a later slot hash, decides which class artwork your pass shows and nothing else. No value is promised for a pass.',
    ],
  },
  {
    id: 'money',
    heading: 'Where your entry goes',
    body: [
      'Every entry splits at the program level: 80% to the prize treasury, 20% to the operator. The 20% is taken only when a pool fills; a pool that refunds returns it.',
      'Funds are held by the on-chain program, whose address is published on the fair play page. Prize and refund payments are made by the program itself.',
    ],
  },
  {
    id: 'availability',
    heading: 'Availability',
    body: [
      'The service may be paused for new entries at any time. Pausing never blocks settlement or refunds for pools that have already been entered: those paths do not depend on the operator.',
      'One pool per tier is open at a time. A tier opens when the prize treasury holds its full prize pool and the previous tournament in that tier has paid out.',
    ],
  },
  {
    id: 'your-side',
    heading: 'Your responsibilities',
    body: [
      'Keep your wallet and its recovery method safe. Transactions signed by your wallet are treated as yours, and a lost wallet cannot be restored by us.',
      'Enter only with funds you can afford to spend, set your own limits before you start, and step away when it stops being enjoyable.',
    ],
  },
  {
    id: 'liability',
    heading: 'Liability, disclaimers and dispute resolution',
    body: [
      'The limits of liability, the disclaimers, the governing law and the process for resolving a dispute:',
      NOT_SET,
    ],
  },
  {
    id: 'changes',
    heading: 'Changes to these terms',
    body: [
      'These terms are versioned. When the version changes, you accept the new version with a wallet signature before your next entry, and the acceptance is recorded with that signature and the version number. Changes never apply retroactively to an entry already sealed.',
    ],
  },
  {
    id: 'contact',
    heading: 'Contact',
    body: ['How to reach the operator:', NOT_SET],
  },
] as const;
