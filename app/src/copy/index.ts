/*
 * The copy module (roadmap Phase 3 preamble): EVERY user-facing string goes
 * through here, and this file is the surface the Phase 6 language audit
 * reads. PID §8.7 is enforced by CI (`scripts/check-language.sh`) over this
 * file like everything else — the approved vocabulary is entry · pass ·
 * character · battle · stat · allocation · tournament · prize pool ·
 * ranking.
 *
 * Filled per master prompt v3 D-UI-3 (no TODO_COPY survives to a visible
 * surface). Brand voice remains founder-reserved: the founder may re-voice
 * any string here. Strings whose comment says SUBSTANCE FIXED are statements
 * with legal weight fixed by the PID — "decisions are final" (§8.6), the
 * sealing wording (TECH-ARCH §5), the R9 timeout disclosure — and only their
 * phrasing may change, with the substance intact.
 */

export const COPY = {
  shell: {
    title: 'Blotto Cup',
    tagline: 'Sixty-four players. Seven battles. Top sixteen paid.',
    metaDescription:
      'Sixty-four players enter, each sets seven sealed battles of five stats summing to 100. ' +
      'Top sixteen are paid from a fixed prize pool, and every result is recomputable from published data.',
    tabs: { play: 'Play', pools: 'Pools', profile: 'Profile' },
  },
  signin: {
    title: 'Sign in',
    subtitle:
      'Sign in with an account and a wallet is created for you, or connect a Solana wallet you already use.',
    google: 'Continue with Google',
    apple: 'Continue with Apple',
    twitter: 'Continue with X',
    walletDivider: 'or',
    wallet: 'Connect a wallet',
    // Rendered only in builds without sign-in credentials (previews, local
    // dev) — the buttons would silently do nothing otherwise.
    unavailable:
      'Sign-in is not configured in this preview build. The buttons below are inactive.',
    signedInAs: 'Signed in as',
    continueLink: 'Go to the arena',
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
    ageConfirm: 'Confirm and continue',
    gateTitle: 'Before you enter',
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
    enter: 'Enter this tournament',
    ageTerritoryNote: '18+ only · not available in some territories',
    lockedTier: 'Opens when the treasury covers it',
    noOpenPool: 'No tournament is open for entries right now.',
    noOpenPoolDetail:
      'A tier opens the moment the prize treasury holds its full prize pool and the previous tournament in that tier has paid out.',
    refundRule:
      'If the pool does not reach 64 entries within 72 hours, every entry is refunded in full — including the platform share.',
    // Per-tier lobby (the old handover's §5A remainder, closed 2026-08-28).
    tierEntry: (sol: string) => `${sol} SOL entry`,
    tierPot: (sol: string) => `${sol} SOL prize pool`,
    tierFirst: (sol: string) => `1st place ${sol} SOL`,
    tierTableLink: 'Full prize tables',
  },
  // The landing page's game explainer (founder ask 2026-08-28). Substance
  // must match the rules tab and PRODUCT-FACTS; wording is founder-voiced
  // like all copy — re-voicing rights reserved.
  howItWorks: {
    title: 'How it works',
    pentagonCaption:
      'Five stats. One hundred points. Where you put them is the whole game.',
    steps: [
      {
        title: 'Take a seat',
        body:
          'Pick an open pool and pay the entry — sixty-four players per pool. Your character pass is cosmetic art: its look never affects scoring or prizes.',
      },
      {
        title: 'Set seven battles',
        body:
          'For each battle, split exactly 100 points across Strength, Speed, Heart, Wit and Durability — fifteen seconds per screen. Your battles are encrypted on your device before you pay; nobody can read them until the pool closes.',
      },
      {
        title: 'Everyone fights everyone',
        body:
          'When all sixty-four seats fill, entries are revealed. Your battle one faces every other player’s battle one, and so on through seven. A battle is won by taking three of the five stats.',
      },
      {
        title: 'Top sixteen are paid',
        body:
          'Ranking is by battles won. The top sixteen are paid automatically from a fixed prize pool that is funded before entries open.',
      },
      {
        title: 'Check the math yourself',
        body:
          'Everything needed to recompute every score and every payment is published. The Verify page re-runs the whole thing in your browser.',
      },
    ],
    rulesLink: 'Read the full rules',
    verifyLink: 'Verify a result',
  },
  battle: {
    screenOf: (k: number) => `Battle ${k} of 7`,
    evenSplit: 'Even split',
    lockIn: 'Lock in',
    // R9's disclosure — the rules page carries the long form.
    timerNote: 'When the timer ends, the battle locks in exactly what the pentagon shows.',
    reviewTitle: 'Your seven battles',
    // The two-step seal (v3 D2): arm, then confirm. §8.6 renders above step 2.
    seal: 'Seal my allocation',
    sealConfirm: 'Confirm — seal and submit',
    sealCancel: 'Go back',
    sealing: 'Sealing your battles…',
    remainingPoints: 'Points to place',
    statNames: ['Strength', 'Speed', 'Heart', 'Wit', 'Durability'] as const,
  },
  // v3 D3: retention surfaces — mastery and standing only. Factual state
  // changes, never pressure; the do-not-build vocabulary is CI-enforced.
  fixtures: {
    title: 'Fixtures',
    statusOpen: 'Taking entries',
    statusSettling: 'Settling',
    statusOpenable: 'Covered — opens next',
    statusShort: 'Opens when the treasury covers it',
    shortBy: (sol: string) => `${sol} SOL to go`,
  },
  notify: {
    title: 'Notifications',
    emptyTitle: 'Nothing yet',
    empty:
      'Updates about pools you have entered appear here: sealed, results committed, prizes paid, refunds open.',
    emailLabel: 'Also email me these updates',
    emailNote:
      'Optional. Uses the email on your sign-in; your choice is recorded with your wallet signature and applies until you change it.',
    emailSaved: 'Notification choice recorded',
    emailFailed: 'Your choice could not be recorded. Check your connection and try again.',
    sealed: (id: string) => `Pool #${id} sealed — battles are being revealed`,
    scored: (id: string) => `Pool #${id}: results are committed`,
    paid: (id: string) => `Pool #${id}: prizes are paid`,
    refunding: (id: string) => `Pool #${id} did not fill — refunds are open`,
  },
  career: {
    chartTitle: 'Prize record',
    chartNote: 'Prize per tournament, in entry order. Paid finishes in amber.',
    rivalsTitle: 'Rivals',
    rivalsNote: 'The wallets most often in your pools — public co-entry facts only.',
    sharedPools: (n: string) => `${n} pools together`,
  },
  beatYou: {
    title: 'What finished above you',
    note: 'Decrypted and re-scored in your browser from the revealed pool data. Seats only — no names.',
    headToHead: (w: number, d: number, l: number) => `${w}W · ${d}D · ${l}L against you`,
    unavailable:
      'The sealed battles for this pool are not available to decrypt yet. The Verify page recomputes the full result from the published bundle.',
  },
  share: {
    button: 'Share your result card',
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
    title: 'Verify a pool',
    explainer:
      'Recompute the whole result yourself: decrypt every sealed battle with the revealed pool secret, score the identical field, rebuild the results tree, and compare it to what was committed on-chain. Nothing here trusts the operator.',
    match: 'Recomputed root matches the on-chain commitment.',
    mismatch: 'RECOMPUTED ROOT DOES NOT MATCH — the published data does not reproduce the on-chain result.',
  },
  profile: {
    title: 'Your career',
    lifetime: 'Lifetime record',
    readOnlyNote: 'Profiles are a read-only record. Nothing here affects any pool.',
  },
  custody: {
    // C13: the disclosure page. Everything here describes MECHANICS —
    // what each key can and cannot do is fixed by the program.
    title: 'Who holds which keys',
    intro:
      'Every key this product operates with, what it can do, and what it cannot. Values not yet configured say so explicitly — this page never shows a number that has not been set.',
    notYetSet: 'not yet set',
    programIdLabel: 'Program',
    programIdNote:
      'The on-chain program holding all entry funds. Prize and refund payments are made by the program itself; its instruction set contains no other way for money to leave.',
    upgradeAuthorityLabel: 'Upgrade authority',
    upgradeAuthorityNote:
      'The only key that can change the program code. Held by a multisig: an upgrade requires the stated number of signatures.',
    thresholdLabel: 'Signatures required',
    timelockLabel: 'Upgrade timelock',
    inventoryHeading: 'Key inventory',
    tableHeadings: { key: 'Key', holder: 'Held by', can: 'Can', cannot: 'Cannot' },
    updatedPrefix: 'Configuration last updated',
    keys: {
      admin: {
        name: 'Admin (multisig)',
        can: 'Open or close tiers, set ceilings and switches, rotate the two service signers, pause new entries.',
        cannot:
          'Move money. No admin instruction transfers a lamport; pausing never blocks settlement or refunds.',
      },
      entrySigner: {
        name: 'Entry signer',
        can: 'Sign entry packets — the per-entry approval that a wallet passed the entry checks.',
        cannot: 'Move money or touch pools. A stolen entry signer could admit entrants, never pay itself.',
      },
      settlementSigner: {
        name: 'Settlement signer',
        can: 'Open pools, reveal pool secrets after seal, commit results, run the prize payments the program validates.',
        cannot:
          'Choose amounts or recipients. The program checks every payout list against the pot and the recorded entries; a wrong list is rejected on-chain.',
      },
      poolSealing: {
        name: 'Pool sealing keys (one per pool)',
        holderWhenProvisioned: 'Key custody service (export-locked until seal)',
        can: 'Decrypt the pool’s sealed battles — only exported once the pool is sealed or past its deadline.',
        cannot: 'Be read early. The export rule is enforced by custody; the reveal publishes the key for everyone.',
      },
      platformWallet: {
        name: 'Prize treasury',
        holderNote:
          'Held by the program itself (a derived account \u2014 no private key exists)',
        can: 'Hold pass-sale revenue, fund each tournament\u2019s fixed prize pool before entries open, and pay refunds. The one exit is a multisig-approved withdrawal, and the program blocks any withdrawal that would dip below the published floor: the minimum balance, one further prize pool per idle tier, and every entry payment that could still be refunded.',
        cannot: 'Pay anyone directly, skim an open tournament, or touch the refundable entry payments \u2014 the floor is enforced by the program, not by policy.',
      },
      irysUpload: {
        name: 'Publishing wallet',
        can: 'Pay to publish each pool’s reveal bundle to permanent storage.',
        cannot: 'Alter results. The published bundle is checkable against the on-chain commitment by anyone.',
      },
      reviewers: {
        name: 'Reviewer wallets',
        holderNote: 'Listed in the published reviewer configuration',
        can: 'Sign review decisions on flagged entries; every decision is recorded in a public, signed log.',
        cannot:
          'Pay themselves. A review decision can only release a held share to its entrant or forfeit it to the platform wallet.',
      },
    },
  },
  reveal: {
    // PID §3 class names, ladder order 0..4. Cosmetic: artwork labels,
    // read by nothing in any scoring or prize path.
    classNames: ['Goblin', 'Knight', 'Wizard', 'Dragon', 'Titan'] as const,
    cardTitle: 'Your character pass',
    cardSeat: (n: number) => `Seat ${n + 1} of 64`,
    cardDone: 'Continue',
    stalled:
      'Confirmation is taking longer than usual. Your entry is submitted and nothing further is needed — results appear on the pool page once the network confirms.',
    stalledDismiss: 'Back to the pool',
    failedRetry: 'Try again',
    failedDismiss: 'Back',
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
      'A pool that does not reach 64 entries within 72 hours refunds every entry in full and closes. Your entry payment is held by the program until the pool fills, so the refund never depends on the operator. Anyone can trigger the refund once the deadline passes; no one\u2019s permission is needed.',
    // D-A1 revised (master prompt v2, 2026-08-27): the pool-opening rule.
    // SUBSTANCE FIXED: sequential pools + pre-funded fixed pots.
    poolOpening:
      'Each tier runs one tournament at a time. A tier opens when the prize treasury holds its full prize pool and the previous tournament in that tier has paid out. Prize pools are fixed per tier and are funded before entries open.',
    verify:
      'Every number a player is paid is recomputable by that player. The Verify page decrypts the published battles with the revealed pool secret, re-runs the same scoring engine in your browser, rebuilds the results tree, and compares it against what was committed on-chain. Nothing on that page trusts the operator.',
    verifyLink: 'Open the Verify page',
    availabilityIntro:
      'Blotto Cup is available only in the territories below. Where the service cannot determine your location, entry is not available.',
    // Founder posture 2026-08-28: block-list — everywhere except the listed
    // territories. The fail-closed sentence stays in both variants.
    availabilityIntroBlockList:
      'Blotto Cup is available everywhere except the territories listed below. Where the service cannot determine your location, entry is not available.',
    availabilityBlocked: 'Explicitly unavailable:',
    age:
      'Blotto Cup is for adults 18 and older. Entering requires a signed confirmation of age and acceptance of the terms, recorded per wallet and per terms version.',
    responsiblePlay:
      'Entries are final and outcomes depend on how every player in the pool allocated. Enter only with funds you can afford to spend, set your own limits before you start, and step away when it stops being enjoyable.',
    // R4 requires the rules to state the detection criteria. This states the
    // FIVE IMPLEMENTED SIGNALS (backend/detection/src/signals.ts) and the
    // two-signal rule mechanically — a factual description of what the code
    // does, filled per v3 D-UI-3. PHASE-D2-REVIEW: founder/counsel may
    // re-voice this wording; the substance must stay identical to the code.
    detection:
      'Five published signals are computed over data every player can see once a pool is revealed: ' +
      '(1) allocation patterns — reuse of the same split, uniform round numbers; ' +
      '(2) timing — how the ninety seconds were actually spent, screen by screen; ' +
      '(3) duplicate or near-duplicate battle sets across entries; ' +
      '(4) the same device or network origin behind multiple entries in one pool; ' +
      '(5) a score far outside the field’s distribution. ' +
      'No single soft signal flags an entry — a flag needs two independent signals — with two exceptions ' +
      'that are conclusive on their own: exactly identical battle sets, and two entries from the same device. ' +
      'A flag never decides anything by itself: it only sends the entry to the signed review process below.',
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
      poolOpening: 'When tournaments open',
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
