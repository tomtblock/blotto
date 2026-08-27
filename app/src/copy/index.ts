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
      { id: 'field', heading: 'Identical-field scoring', body: 'TODO_COPY(rules.field)' },
      { id: 'allocation', heading: 'Allocation rules', body: 'TODO_COPY(rules.allocation)' },
      { id: 'timer', heading: 'The 15-second timer and lock-current', body: 'TODO_COPY(rules.timer)' },
      { id: 'detection', heading: 'Detection criteria', body: 'TODO_COPY(rules.detection)' },
      { id: 'language', heading: 'Language audit', body: 'TODO_COPY(rules.language)' },
    ],
  },
} as const;
