/*
 * The copy module (roadmap Phase 3 preamble): EVERY user-facing string goes
 * through here, and this file is the surface the Phase 6 language audit
 * reads. PID §8.7 is enforced by CI (`scripts/check-language.sh`) over this
 * file like everything else — the approved vocabulary is entry · pass ·
 * character · battle · stat · allocation · tournament · prize pool ·
 * ranking.
 *
 * Strings marked TODO_COPY are placeholders awaiting the founder's voice
 * (brand voice is founder-reserved); strings WITHOUT the marker are
 * statements with legal weight whose substance is fixed by the PID —
 * "decisions are final" (§8.6), the sealing wording (TECH-ARCH §5), the R9
 * timeout disclosure — and only their phrasing may change in Phase 6, with
 * the substance intact.
 */

export const COPY = {
  shell: {
    title: 'TODO_COPY: Blotto Cup',
    tagline: 'TODO_COPY: Sixty-four players. Seven battles. Top sixteen paid.',
  },
  gate: {
    ageAttestation:
      'I confirm I am 18 or older and that entering skill tournaments for prizes is lawful where I live.',
    // D-B4: the versioned clickwrap around the line above. SUBSTANCE FIXED:
    // acceptance is recorded with the wallet's signature and the terms
    // version; the wording of what is being accepted must stay accurate.
    termsAcceptance: (version: number) =>
      `I accept the terms (version ${version}). My wallet signs this statement and the acceptance is recorded.`,
    attestFailed:
      'The confirmation could not be recorded. Check your connection and try again.',
    ageConfirm: 'TODO_COPY: Confirm',
    territoryBlocked:
      'Blotto Cup is not available in your region. Entries cannot be accepted from your location.',
  },
  pool: {
    entrantsOf: (n: number) => `${n} / 64 entered`,
    fillDeadline: 'Pool closes for entries in',
    prizeTableTitle: 'Prize pool — top 16 paid',
    // PID §8.6: displayed ABOVE the enter button, always.
    decisionsFinal:
      'Decisions are final. Once your seven battles are submitted they cannot be changed or withdrawn.',
    sealed:
      'Battles are encrypted to a key nobody holds until the pool closes, and their hash is recorded on-chain at entry.',
    enter: 'TODO_COPY: Enter this pool',
    refundRule:
      'If the pool does not reach 64 entries within 72 hours, every entry is refunded in full — including the platform share.',
  },
  battle: {
    screenOf: (k: number) => `Battle ${k} of 7`,
    evenSplit: 'Even split',
    lockIn: 'Lock in',
    // R9's disclosure — the rules page carries the long form.
    timerNote: 'When the timer ends, the battle locks in exactly what the pentagon shows.',
    reviewTitle: 'TODO_COPY: Review your seven battles',
    confirm: 'TODO_COPY: Submit entry',
    statNames: ['Strength', 'Speed', 'Heart', 'Wit', 'Durability'] as const,
  },
  results: {
    paidAutomatically:
      'Prizes are paid automatically when results are committed. No claim step.',
    escrowHeld:
      'This prize share is held pending review. It will be released or withheld per the published detection criteria.',
    rank: (r: number) => `Ranked #${r} of 64`,
    // SUBSTANCE FIXED (D3-B, ratified 2026-08-27): the split-pot tie rule.
    tieNote:
      'Tied players — equal on battles won and on stats won — share a rank and split the combined prize of the positions they occupy evenly. The full ranking with tie labels is recomputable on the Verify page from the published data.',
  },
  verify: {
    title: 'TODO_COPY: Verify a pool',
    explainer:
      'Recompute the whole result yourself: decrypt every sealed battle with the revealed pool secret, score the identical field, rebuild the results tree, and compare it to what was committed on-chain. Nothing here trusts the operator.',
    match: 'Recomputed root matches the on-chain commitment.',
    mismatch: 'RECOMPUTED ROOT DOES NOT MATCH — the published data does not reproduce the on-chain result.',
  },
  profile: {
    title: 'TODO_COPY: Profile',
    lifetime: 'TODO_COPY: Lifetime record',
    readOnlyNote: 'Profiles are a read-only record. Nothing here affects any pool.',
  },
  rules: {
    // R4's eight statements — headed sections; Phase 6 fills the bodies.
    sections: [
      { id: 'final', heading: 'Decisions are final', body: 'TODO_COPY(rules.final)' },
      { id: 'fill', heading: 'Fill deadline and refunds', body: 'TODO_COPY(rules.fill)' },
      { id: 'sealing', heading: 'Sealing', body: 'TODO_COPY(rules.sealing)' },
      {
        id: 'field',
        heading: 'Identical-field scoring',
        // SUBSTANCE FIXED (D3-B, ratified 2026-08-27): this paragraph states
        // the ordering and tie rule the engine implements
        // (backend/scoring/src/engine.ts) and must stay factually identical
        // to it — Phase 6 may re-phrase, never re-order. Supersedes the
        // Part 3 wording (seat as final tie-break), which the founder
        // replaced by ratifying D3-B.
        body:
          'Every player faces the identical field: your battle 1 is compared against every other entry\u2019s battle 1, and so on for all seven. A battle is won by taking three or more of its five stats; if neither side takes three, it is a draw worth half a win to each. Rankings are ordered by total battles won (a draw counts half), then by total stats won across every comparison. Players equal on both are tied: they share the same rank and split the combined prize of the positions their group occupies evenly, with any indivisible lamport remainder going to the earliest seat in the tied group. Seat order never decides who ranks above whom or who is paid. The ordering is fully deterministic: the same sealed battles always produce the same ranking.',
      },
      { id: 'allocation', heading: 'Allocation rules', body: 'TODO_COPY(rules.allocation)' },
      { id: 'timer', heading: 'The 15-second timer and lock-current', body: 'TODO_COPY(rules.timer)' },
      { id: 'detection', heading: 'Detection criteria', body: 'TODO_COPY(rules.detection)' },
      { id: 'language', heading: 'Language audit', body: 'TODO_COPY(rules.language)' },
    ],
  },
} as const;
