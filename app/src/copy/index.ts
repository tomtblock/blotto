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
      'I confirm I am 18 or older and that entering a paid tournament for prizes is lawful where I live.',
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
    // C9: the balance pre-flight — shown BEFORE the timed session starts,
    // never after battles are allocated.
    balanceInsufficient: (needSol: string, haveSol: string) =>
      `Entering this pool takes about ${needSol} SOL (entry price plus transaction costs). This wallet holds ${haveSol} SOL.`,
    balanceUnavailable:
      'Your wallet balance could not be checked. Entry stays closed until it can be.',
    balanceRetry: 'Check again',
    topUp: 'Add SOL',
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
  reveal: {
    // PID §3 class names, ladder order 0..4. Cosmetic: artwork labels,
    // read by nothing in any scoring or prize path.
    classNames: ['Goblin', 'Knight', 'Wizard', 'Dragon', 'Titan'] as const,
    cardTitle: 'Your character pass',
    cardSeat: (n: number) => `Seat ${n + 1} of 64`,
    cardDone: 'TODO_COPY: Continue',
    stalled:
      'Confirmation is taking longer than usual. Your entry is submitted and nothing further is needed — results appear on the pool page once the network confirms.',
    stalledDismiss: 'TODO_COPY: Back to the pool',
    failedRetry: 'TODO_COPY: Try again',
    failedDismiss: 'TODO_COPY: Back',
  },
  rules: {
    // D-B6 (ratified 2026-08-27): the rules tab, plain language, one section
    // per topic. Everything MECHANICAL is stated in full and derives its
    // numbers from rules.config.ts (which imports the shared tier constants
    // — no hand-typed figures). Paragraphs marked SUBSTANCE FIXED state what
    // the code enforces and must stay factually identical to it; Phase 6 may
    // re-phrase with the substance intact.
    title: 'Rules',
    howToEnter:
      'Sign in, pick an open pool, and confirm the 18+ and terms statements — your wallet signs that confirmation once per terms version. Pay the entry price for the tier. You then set seven battles, about ninety seconds in total: each battle splits 100 points across five stats. Your battles are encrypted on your device before any payment moves, and the pool fills to exactly 64 players. Decisions are final: a submitted entry cannot be changed or withdrawn (see the refund rule for pools that never fill).',
    priceIntro:
      'Seven tiers are configured. A tier must be switched on by the operator before pools open in it; at launch only the smallest tier is on. One pool per tier is open at a time, and a new pool of that tier can open the moment one fills.',
    prizeIntro:
      'Every pool pays from a prize pool equal to 80% of its 64 entries; the remaining 20% is the platform share, taken only when a pool fills (a pool that refunds returns it). The top 16 positions are paid on the published table below — exact 1024ths of the prize pool, so the amounts divide with no residue. Prizes are paid automatically when results are committed; there is no claim step.',
    // SUBSTANCE FIXED (D3-B): identical-field scoring, exactly as the engine
    // implements it (backend/scoring/src/engine.ts). Includes the R9
    // lock-current disclosure.
    scoring:
      'Every player faces the identical field: your battle 1 is compared against every other entry\u2019s battle 1, and so on for all seven. A battle is won by taking three or more of its five stats; if neither side takes three, it is a draw worth half a win to each. Rankings are ordered by total battles won (a draw counts half), then by total stats won across every comparison. The ordering is fully deterministic: the same sealed battles always produce the same ranking. If the timer on a battle screen runs out, the battle locks exactly what the pentagon shows at that moment \u2014 nothing is ever chosen for you.',
    // SUBSTANCE FIXED (D3-B): the split-pot tie rule.
    ties:
      'Two players are tied when their battles won AND stats won are both equal. Tied players share the same rank and split the combined prize of the positions their group occupies, evenly. If the split leaves an indivisible remainder of a few lamports, it goes to the tied player who entered the pool earliest. Every tied player with a nonzero share is paid \u2014 a tie across the 16th position can mean more than 16 players are paid. Seat order never decides who ranks above whom or who is paid.',
    // SUBSTANCE FIXED: randomness scope (PID §8.3/§8.4).
    randomness:
      'Randomness from a Switchboard VRF seed, combined with a later slot hash, decides ONE thing: which character class artwork your pass shows. Class is cosmetic. It does not affect any stat, any battle, any score, any rank, or any prize \u2014 nothing in the scoring path reads it. Scoring and prizes depend only on the sealed battles every player submitted. Every class draw is replayable from published on-chain data.',
    // SUBSTANCE FIXED: the sealing lifecycle (TECH-ARCH §5).
    sealing:
      'Your seven battles are encrypted on your device, before payment, to a pool key that nobody \u2014 the operator included \u2014 can open while the pool is filling. A hash of your battles is recorded on-chain at entry. When the pool fills, the pool secret is published on-chain: at that moment everyone\u2019s battles become readable and checkable against the hashes committed at entry, and anyone can re-run the scoring.',
    refund:
      'A pool that does not reach 64 entries within 72 hours refunds every entry in full \u2014 including the platform share \u2014 and closes. Anyone can trigger the refund once the deadline passes; no one\u2019s permission is needed.',
    verify:
      'Every number a player is paid is recomputable by that player. The Verify page decrypts the published battles with the revealed pool secret, re-runs the same scoring engine in your browser, rebuilds the results tree, and compares it against what was committed on-chain. Nothing on that page trusts the operator.',
    verifyLink: 'Open the Verify page',
    availabilityIntro:
      'Blotto Cup is available only in the territories below. Where the service cannot determine your location, entry is not available.',
    availabilityBlocked: 'Explicitly unavailable:',
    age:
      'Blotto Cup is for adults 18 and older. Entering requires a signed confirmation of age and acceptance of the terms, recorded per wallet and per terms version.',
    responsiblePlay:
      'Entries are final and outcomes depend on how every player in the pool allocated. Enter only with funds you can afford to spend, set your own limits before you start, and step away when it stops being enjoyable.',
    // R4 requires the rules to state the detection criteria; the criteria
    // wording is founder/counsel prose (Phase 6) — the one section where a
    // placeholder is correct. C10 adds the review-process appendix here.
    detection: 'TODO_COPY(rules.detection)',
    // C10: the review PROCESS is mechanical and stated now; the criteria
    // wording above stays founder/counsel prose (R4).
    reviewProcess:
      'How review works: before any prize is paid, an entry that meets a published criterion can be flagged. A flagged share is not paid out — it is held by the program, in the same vault, while a named member of the operating multisig reviews the entry against the published criteria. Every decision is recorded in a public log signed by the reviewer who made it: what was decided, when, and which criterion it cited. A cleared share is released to the player in full; an upheld one is forfeited. Nothing about review is discretionary money movement — the program only ever releases to the entrant or forfeits to the operator, and the signed log shows which happened and why.',
    headings: {
      howToEnter: 'How to enter',
      price: 'Price per tier',
      prizes: 'Prize pool and payout table',
      scoring: 'How scoring works',
      ties: 'How ties are resolved',
      randomness: 'What randomness does \u2014 and does not do',
      sealing: 'Sealing: when your battles are encrypted and revealed',
      refund: 'Refund and closing rule',
      verify: 'How to verify a result',
      availability: 'Where Blotto Cup is available',
      age: '18+',
      responsiblePlay: 'Playing responsibly',
      detection: 'Detection and review',
    },
    tableHeadings: {
      tier: 'Tier',
      entry: 'Entry (SOL)',
      pot: 'Prize pool (SOL)',
      position: 'Position',
      prize: 'Prize (SOL)',
    },
  },
} as const;
