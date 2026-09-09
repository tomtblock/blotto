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
    // D-E2 (ratified 2026-09-06): one paid place. Drafts pending founder
    // voice; the substance — one winner, a fixed prize pool, recomputable
    // results — is the register speaking. No multiple, ever (proposal E1
    // §2.5's copy constraint).
    tagline: 'Sixty-four seats. Seven battles. The winner takes the prize pool.',
    metaDescription:
      'Up to sixty-four players enter, each sets seven sealed battles of five stats summing to 100. ' +
      'The player ranked first takes a fixed prize pool, and every result is recomputable from published data.',
    tabs: { play: 'Play', pools: 'Pools', profile: 'Profile' },
    // The honest degraded state: the data service is unreachable, which is
    // NOT the same statement as "no tournament is open".
    liveDataUnavailable: 'Live tournament data is temporarily unavailable.',
    liveDataUnavailableDetail:
      'The data service could not be reached. Refresh in a moment — nothing on-chain is affected.',
  },
  signin: {
    title: 'Sign in',
    subtitle:
      'Sign in with an account and a wallet is made for you, or use a Solana wallet you already have.',
    google: 'Continue with Google',
    apple: 'Continue with Apple',
    twitter: 'Continue with X',
    // The provider modal's own subtitle (capped at 100 characters by the SDK).
    modalMessage: 'Seven sealed battles. The winner takes the prize pool.',
    walletDivider: 'or connect a wallet',
    detected: 'Detected',
    moreWallets: 'More wallets',
    moreWalletsNote: 'Solflare, Backpack, a mobile wallet, or a QR code',
    wallet: 'Connect a wallet',
    // Rendered only in builds without sign-in credentials (previews, local
    // dev) — the buttons would silently do nothing otherwise.
    unavailable:
      'Sign-in is not configured in this preview build. The buttons below are inactive.',
    // The OTHER way sign-in can be off: a credential is present but the
    // provider rejected it. Distinguished from `unavailable` because the two
    // need different fixes, and because a player deserves to know the
    // difference between "not set up yet" and "set up wrongly".
    unavailableRejected:
      'Sign-in is temporarily unavailable. We have been notified — please try again shortly.',
    // What the page says when a sign-in attempt does not complete, by the
    // provider's error code (plus the few this app raises itself). Until
    // 2026-09-08 no failure reached the page at all: the provider hook was
    // called without an error handler, so a switched-off provider or a
    // rejected origin produced a button that did nothing and said nothing.
    // PHASE-N-REVIEW: plain sentences pending the founder's wording.
    errors: {
      exited_auth_flow: 'Sign-in was closed before it finished. Nothing happened.',
      oauth_user_denied: 'The account provider did not give permission, so sign-in stopped.',
      allowlist_rejected:
        'Sign-in is not switched on for this web address yet. We have been notified.',
      disallowed_login_method: 'This sign-in method is not switched on yet.',
      too_many_requests: 'Too many attempts in a short time. Wait a moment and try again.',
      unknown_connect_wallet_error: 'The wallet did not connect. Check it is unlocked and try again.',
      generic_connect_wallet_error: 'The wallet did not connect. Check it is unlocked and try again.',
      exited_link_flow: 'Adding a wallet was closed before it finished.',
      blotto_wallet_not_detected: 'That wallet is no longer detected in this browser.',
      blotto_wallet_no_account: 'The wallet connected but offered no Solana account.',
      blotto_wallet_declined: 'The wallet declined the request. Nothing happened.',
      blotto_wallet_signin_failed: 'The wallet signed in, but the sign-in could not be completed.',
    } as Record<string, string>,
    errorFallback: 'Sign-in did not complete. Try again, or use a different method.',
    signedInAs: 'Signed in as',
    continueLink: 'Go to the arena',
  },
  // The wallet screen (2026-09-08): the one place a player sees what they
  // hold, adds to it, takes it out, or chooses which wallet plays. Every
  // amount shown is bigint-derived; nothing here is a float.
  // PHASE-N-REVIEW: plain sentences pending the founder's wording.
  wallet: {
    title: 'Your wallet',
    signInFirst: 'Sign in to see your wallet.',
    balanceLabel: 'In your wallet now',
    wonLabel: 'Won to date',
    balanceUnavailable: 'Balance could not be read right now.',
    refresh: 'Refresh',
    whichEmbedded: 'Blotto wallet, made at sign-in',
    whichExternal: (name: string) => `${name} wallet`,
    pickerLabel: 'Play and be paid with',
    addSol: 'Add SOL',
    receiveTitle: 'Add SOL to this wallet',
    receiveSubtitle: 'Send SOL from any wallet or exchange to the address shown.',
    faucet: 'Get test SOL',
    faucetNote:
      'This is a test network. SOL here has no value and cannot be bought; a faucet gives it away.',
    send: 'Send SOL',
    sendTitle: 'Send SOL',
    sendTo: 'To (Solana address)',
    sendAmount: 'Amount (SOL)',
    sendMax: 'Max',
    sendConfirm: 'Send',
    sendSending: 'Sending…',
    sendDone: 'Sent.',
    sendSignature: 'Signature',
    sendInvalidAddress: 'That is not a valid Solana address.',
    sendZero: 'Enter an amount above zero.',
    sendTooMuch: 'That is more than this wallet can send after transaction costs.',
    sendNote:
      'Sends go anywhere on Solana: another wallet, or an exchange where SOL can be sold for your currency. A send cannot be reversed.',
    exportTitle: 'Move my wallet to Phantom',
    exportExplain:
      'You will be shown this wallet’s private key on a screen we cannot read. Paste it into Phantom under “Import private key” and this wallet, with everything in it, lives in Phantom from then on. Never share the key with anyone.',
    exportConfirm: 'Show my private key',
    linkTitle: 'Use a different wallet',
    linkExplain:
      'Connect a wallet you already have — Phantom, Solflare, Backpack — to this account. You choose which one plays and is paid.',
    // Shown inside the provider's connect modal.
    linkDescription: 'Connect a wallet to your Blotto account.',
    explorer: 'View on explorer',
  },
  gate: {
    ageAttestation:
      'I confirm I am 18 or older and that entering a paid tournament for prizes is lawful where I live.',
    // D-B4: the versioned clickwrap around the line above. SUBSTANCE FIXED:
    // acceptance is recorded with the wallet's signature and the terms
    // version; the wording of what is being accepted must stay accurate.
    // Founder 2026-09-09: no version number on screen or in the signed
    // statement; the edition is named by its date (the message binds it).
    termsAcceptance:
      'I accept the Blotto Cup terms. My wallet signs this statement once and the acceptance is recorded.',
    // The redesigned gate (2026-09-09): a short lead, a step label per
    // statement, and what the wallet prompt that follows is. PHASE-N-REVIEW.
    gateIntro: 'Two statements, then your wallet signs them once. Signing is free and moves nothing.',
    gateStep: (n: number, of: number) => `Statement ${n} of ${of}`,
    gateConfirmed: 'Confirmed',
    gateSignNote: 'Your wallet will show the statement and ask you to sign it.',
    gateSigning: 'Waiting for your wallet…',
    gateReadTerms: 'Read the rules and terms',
    attestFailed:
      'The confirmation could not be recorded. Check your connection and try again.',
    // Founder 2026-09-09 ("taking ages to load"): a hold names itself when it
    // is slow, and the fail-closed territory panel offers one more look.
    // PHASE-N-REVIEW: drafts.
    slowHold: 'This is taking longer than usual. If it does not move on, reload the page and try again.',
    territoryRecheckNote: 'If your connection dropped during the check, this can show by mistake.',
    territoryRecheck: 'Check again',
    // The pool read's two failure shapes, each with a way on. PHASE-N-REVIEW.
    poolMissingTitle: 'That pool is not here',
    poolMissing: 'No tournament with this address is listed. It may have closed, or the link may be old.',
    poolLoadFailedTitle: 'The pool could not be loaded',
    poolLoadFailed:
      'The tournament data did not arrive. Try again; if it keeps happening, tell us the web address you opened the site from.',
    poolLoadRetry: 'Try again',
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
    // The signed-in-but-cannot-sign state (2026-09-08): a returning player
    // whose wallet did not reconnect used to get a normal-looking screen,
    // play all seven battles, press confirm — and nothing happened,
    // permanently, with no error. Now the play screen holds here instead.
    signerConnecting: 'Connecting your wallet',
    signerMissingTitle: 'Your wallet is not ready',
    signerMissing:
      'This wallet is signed in but cannot sign yet. Reconnect it from your wallet page, or sign out and in again, before entering.',
    signerMissingLink: 'Open your wallet',
  },
  preloader: {
    // First-visit gate only (root route, once). The line is the same
    // brand statement as shell.tagline, lowercased for the pink surface.
    enter: 'Enter',
    skip: 'Skip',
    line: 'sixty-four seats \u00b7 seven battles \u00b7 the winner takes the prize pool',
    // Visually hidden equivalent of the decorative video, for screen readers.
    srIntro: 'Blotto Cup. Sixty-four seats, seven battles, the winner takes the prize pool.',
    dialogLabel: 'Blotto Cup intro',
  },

  pool: {
    // D-E4: the field a pool needs is stated beside the count, always from
    // the shared constant (callers pass MIN_SEATS), never hand-typed.
    entrantsOf: (n: number, minSeats: number) => `${n} / 64 entered · ${minSeats} needed to run`,
    fillDeadline: 'Pool closes for entries in',
    // Prompt v2 §B.6: the tier's cooldown after a pool settles — shown when
    // no pool is open, from the on-chain `tier_next_open_at`. A fixture
    // clock like fillDeadline — calm, never beside a pay control.
    nextPoolIn: 'Next pool opens in',
    // D-E2: the prize is ONE number — the pot — shown as a Stat, with the
    // rule beside it. The per-position table is gone (a one-row table reads
    // as a bug, not a rule).
    prizeLabel: 'Prize pool',
    // SUBSTANCE FIXED (D-E2 + D3-B; wording per the founder's addendum of
    // 2026-09-07): one paid place; a tie for first splits equally.
    prizeRule:
      'The player ranked first receives the full prize pool. If two or more players are ranked first, they are paid an equal share each; an indivisible remainder of a few lamports goes to the eligible player with the lowest entry number.',
    // PID §8.6: displayed ABOVE the enter button, always.
    decisionsFinal:
      'Decisions are final. Once your seven battles are submitted they cannot be changed or withdrawn.',
    // Says the same thing as rules.sealing in one line. It used to say "a key
    // nobody holds", which is not what is built: the key is generated and
    // held by our systems, locked against export until the pool closes.
    sealed:
      'Battles are encrypted on your device to a key our systems hold locked against export until the pool closes; their hash is recorded on-chain at entry.',
    enter: 'Enter this tournament',
    ageTerritoryNote: '18+ only · not available in some territories',
    // Founder 2026-09-09: "It must be super clear to the user that they
    // should check back when the pool has reached 64 and concluded." The
    // size rule is D-E4's (a pool plays at 64, or at its deadline with at
    // least 52). PHASE-N-REVIEW: drafts; the founder owns the words.
    checkBackTitle: 'Now the pool fills',
    checkBack:
      'Your seven battles are sealed. Nothing more to do here. The pool plays when it reaches 64 players, or at its deadline with at least 52 — every battle is then revealed and scored, and the ranking appears on the pool page. Check back then.',
    notifyOptIn: 'Email me when this pool has concluded',
    notifyOptInDone: 'We will email you when a pool you are in has concluded.',
    viewPool: 'Follow this pool',
    viewResults: 'Results and every battle',
    // D-E1 §1.4 (option A): shown on any pool whose on-chain pot differs
    // from the CURRENT launch table — the guarantee the architecture
    // already provides, said out loud instead of read as a cut.
    potFixedAtOpen:
      'This pool\u2019s prize pool was fixed when it opened and is unaffected by later changes.',
    lockedTier: 'Opens when the treasury covers it',
    noOpenPool: 'No tournament is open for entries right now.',
    noOpenPoolDetail:
      'A tier opens once the prize treasury holds its full prize pool, the previous tournament in that tier has paid out or closed, and the tier\u2019s short cooldown has passed.',
    // D-E4 (option A, 2026-09-07): the fill rule in one breath — field
    // size, the one clock, the refund. Numbers come from the shared
    // constants via the caller (12 hours at launch).
    refundRule: (minSeats: number, fillHours: number) =>
      `Entries stay open for up to ${fillHours} hours. The pool runs the moment all 64 seats fill, or when time runs out with at least ${minSeats} players seated. If fewer than ${minSeats} are seated when time runs out, every entry is refunded in full.`,
    // Per-tier lobby (the old handover's §5A remainder, closed 2026-08-28).
    tierEntry: (sol: string) => `${sol} SOL entry`,
    tierPot: (sol: string) => `${sol} SOL prize pool`,
    // D-E2: the first-place share IS the prize pool shown beside it — no
    // second figure, no multiple.
    tierWinner: 'Winner takes the prize pool',
    tierTableLink: 'Full prize tables',
    // E3: the archive strip on the pools tab. Draft pending founder voice
    // review; the substance (settled pools remain browsable, every result
    // recomputable) is the architecture speaking.
    archiveTitle: 'Archive',
    archiveNote: 'Settled tournaments. Every result here is recomputable from published data.',
    // Phase 2 Stage C: the derived RESOLVING badge — the published process
    // ("the tournament enters resolving. Resolving lasts up to 12 hours")
    // made visible on the pool a held share belongs to. Label + countdown
    // label + one-line note. Substance is the rules page's own sentence
    // (the hours come from the shared constant via the caller); wording is
    // a draft pending founder voice review like every line in this file.
    resolving: 'Resolving',
    resolvingEndsIn: 'Resolving ends in',
    resolvingNote: (hours: number) =>
      `Results are published. A prize on this tournament is held while a flag against it is reviewed. If no decision is made within ${hours} hours, the flag is cleared and the prize is paid.`,
  },
  // The landing page's game explainer (founder ask 2026-08-28). Substance
  // must match the rules tab and PRODUCT-FACTS; wording is founder-voiced
  // like all copy — re-voicing rights reserved.
  landing: {
    // Hero voice is a PLACEHOLDER awaiting founder re-voice (brand voice
    // is founder-reserved); everything else on the landing reuses lines
    // already ratified elsewhere in this file.
    heroTitle: 'Make your Blot',
    tryDials: 'Try the dials',
    demoHint: 'Drag a dial — the other four give way. Nothing to sign, nothing to pay: this one is just to feel it.',
    // PHASE-N-REVIEW (2026-09-09): the marquee line on the landing machine.
    demoStatus: 'Practice machine',
    openPoolTitle: 'Open now',
    seatsLabel: 'seats filled',
  },

  howItWorks: {
    title: 'How it works',
    // Founder wording, 2026-09-09 (replaces "Five stats. One hundred points.
    // Where you put them is the whole game.").
    pentagonCaption: 'Spread Your Skill. Outsmart Your Opponent. Best Strategy Wins.',
    steps: [
      {
        title: 'Take a seat',
        body:
          'Pick an open pool and pay the entry — up to sixty-four players per pool. Your character pass is cosmetic art: its look never affects scoring or prizes.',
      },
      {
        title: 'Set seven battles',
        body:
          // PHASE-N-REVIEW: said "fifteen seconds per screen" (R9); the client
          // runs one ninety-second budget for all seven (R9-b, run-clock.ts),
          // and two other strings already say so. Founder may veto.
          'For each battle, split exactly 100 points across Strength, Speed, Heart, Wit and Durability — about ninety seconds for all seven. Your battles are encrypted on your device before you pay; nobody can read them until the pool closes.',
      },
      {
        title: 'Everyone fights everyone',
        body:
          'When the pool runs — all sixty-four seats filled, or at least fifty-two seated when its clock ends — entries are revealed. Your battle one faces every other player’s battle one, and so on through seven. A battle is won by taking three of the five stats.',
      },
      {
        title: 'The winner takes the prize pool',
        body:
          'Ranking is by battles won, then by stats won. The player ranked first is paid the full prize pool automatically — it is funded before entries open. A tie for first splits it exactly.',
      },
      {
        title: 'Check the math yourself',
        body:
          'Everything needed to recompute every score and every payment is published. The Verify page re-runs the whole thing in your browser.',
      },
    ],
    rulesLink: 'Read the full rules',
    verifyLink: 'Verify a result',
    fairPlayLink: 'Fair play',
    // The one-at-a-time carousel (2026-09-09).
    stepOf: (n: number, of: number) => `Step ${n} of ${of}`,
    prevStep: 'Previous step',
    nextStep: 'Next step',
  },
  // The Fair play page (2026-09-08): what keeps the competition fair, who
  // may enter, how to check it. Every sentence describes a MECHANISM; none
  // asserts a status (D-B7). PHASE-N-REVIEW: the founder's working title is
  // different; counsel decides the final one — it is this one key.
  fairPlay: {
    title: 'Fair play',
    intro:
      'What keeps this competition fair, who may enter, and how to check any of it yourself.',
    skillHeading: 'Skill, measured',
    skillIntro:
      'Two hundred pools were played with the same scoring engine that pays every real pool, at both field sizes. The only thing that differed between the players below was how they split their points across the seven battles. A player who leaves every battle on the default even split never placed first — not rarely, never: against any battle that concentrates its points on three stats, an even split takes only the two that were left short, and loses three to two by construction.',
    skillHeadings: { player: 'Player', full: 'First place, 64 seats', min: 'First place, 52 seats' },
    skillRows: {
      uniform: 'Leaves the default split',
      random: 'Splits at random',
      heuristic: 'Follows a plan',
      optimised: 'Follows a tuned plan',
    } as Record<string, string>,
    skillNote:
      'Every figure above is recomputable from the published study inputs, and the engine that scored them is the one that runs on the Verify page in your browser.',
    screeningHeading: 'Every wallet is checked',
    screening:
      'Before an entry is accepted, the wallet is checked against published sanctions lists. Before any prize is paid, every wallet in the payout list is checked again. The lists are refreshed from their publishers several times a day. If a check cannot be answered, the prize is held rather than paid; it is never paid to a wallet nobody checked.',
    ageHeading: 'Adults only',
    availabilityHeading: 'Where you can enter',
    randomnessHeading: 'Nothing random decides a result',
    checkHeading: 'Check it yourself',
    checkIntro:
      'Nothing on this page asks you to take our word for it. Three pages let you look for yourself.',
    checkVerify: 'Recompute any result on the Verify page',
    checkCustody: 'See who holds which keys, and what each cannot do',
    checkRules: 'Read the full rules',
  },
  /** The transaction seam's three player-reachable program refusals (app/src/tx/errors.ts). */
  tx: {
    // PHASE-N-REVIEW: plain sentences pending the founder's wording. Each says
    // what happened and that nothing settled; none invites a blind retry.
    entriesPaused:
      "Entries are paused right now, so this one was not accepted and nothing settled. Try again a little later.",
    poolFull:
      "This pool filled before your entry reached it, so nothing settled. Another pool in this tier opens once this one has been paid out.",
    deadlinePassed:
      "This pool stopped taking entries at its deadline before your entry reached it, so nothing settled.",
  },
  battle: {
    screenOf: (k: number) => `Battle ${k} of 7`,
    evenSplit: 'Even split',
    lockIn: 'Lock in',
    // R9-b (founder addendum 2026-09-07, amending R9): an unlocked battle —
    // the one on screen included — is entered as the even split. The
    // wording is the founder's, verbatim, and goes on the battle screen as
    // well as the rules page.
    timerNote:
      'Lock each battle before its timer ends. Any battle you have not locked when the timer ends \u2014 including the one on your screen \u2014 is entered as an even split of 20 points in each of the five stats.',
    // The effect of the default, stated as how the allocation PERFORMS —
    // never as a chance of anything (the addendum's note for this line).
    timerEffect:
      'The even split is the weakest allocation in the game. Against any allocation that concentrates points on three stats, an even split loses that battle three stats to two, every time. Nothing is decided at random: the even split is simply the shape your entry starts from, and leaving it there is a decision like any other.',
    reviewTitle: 'Your seven battles',
    // The two-step seal (v3 D2): arm, then confirm. §8.6 renders above step 2.
    seal: 'Seal my allocation',
    sealConfirm: 'Confirm — seal and submit',
    sealCancel: 'Go back',
    sealing: 'Sealing your battles…',
    remainingPoints: 'Points to place',
    statNames: ['Strength', 'Speed', 'Heart', 'Wit', 'Durability'] as const,

    /* v4 run (founder brief 2026-09-06), the timer sentence amended by the
     * founder's addendum of 2026-09-07 (R9-b): an unlocked battle is
     * entered as the even split, the one on screen included. */
    approvedTitle: "You're in.",
    begin: 'Make my first Blot',
    ruleNinety:
      'Ninety seconds for all seven battles. Any battle you have not locked when the timer ends \u2014 including the one on your screen \u2014 is entered as an even split of 20 points in each of the five stats.',
    lockBattle: (n: number) => `Lock in battle ${n}`,
    sevenTitle: 'Seven made',
    expiredNote: 'Time ran out \u2014 every battle you had not locked was entered as the even split.',
    montageHeadlineFirst: 'I just made my first Blot.',
    montageHeadlineSeven: 'I just made seven Blots.',
    montageFooter: 'BLOTTO CUP \u00b7 blotto.gg \u00b7 18+ only \u00b7 not available in some territories',
    share: 'Share',
    shareTextFirst: 'I just made my first Blot. Join the battle at blotto.gg',
    shareTextSeven: 'I just made seven Blots. Join the battle at blotto.gg',
    shareFallbackCopied: 'Share line copied — the image downloaded to your device.',
    backSheetLine: 'Leaving locks nothing and loses nothing — your clock keeps running.',
    backStay: 'Stay',
    backLeave: 'Leave',

    /* The machine (founder 2026-09-09): a locked Blot drops out of the
     * chute, its still and its five numbers fill one of seven tiles under
     * the machine, and the seventh lock is the crescendo. PHASE-N-REVIEW:
     * drafts; the founder owns the words. */
    tilesLabel: 'Your seven Blots',
    tileLocked: (n: number, stats: string) => `Battle ${n} locked: ${stats}`,
    tileEmpty: (n: number) => `Battle ${n} — not yet made`,
    crescendo: 'All seven made.',
    crescendoLine: 'Your Blots are in the machine. Seal them to enter the pool.',
  },
  // v3 D3: retention surfaces — mastery and standing only. Factual state
  // changes, never pressure; the do-not-build vocabulary is CI-enforced.
  fixtures: {
    // PHASE-N-REVIEW: the founder asked for a word other than "Fixtures"
    // (2026-09-09); "Prize pools" is the proposal, from the approved lexicon.
    title: 'Prize pools',
    /** Tiers not yet switched on (everything but the launch tier). */
    statusComingSoon: 'Coming soon',
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
    refunding: (id: string) => `Pool #${id} did not reach its minimum field — refunds are open`,
  },
  career: {
    chartTitle: 'Prize record',
    chartNote: 'Prize per tournament, in entry order. Prize finishes in amber.',
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
    // Founder addendum 2026-09-07, ruling 1: the published rule is 12 hours.
    escrowHeld:
      'This prize is held by the program while a flag against it is reviewed against the published criteria. If no decision is made within 12 hours, the flag is cleared and the prize is paid.',
    // The held-row label (was a raw string in results-reveal.tsx until
    // Stage E — every user-facing string lives here).
    heldForReview: 'held for review',
    // Phase 2 Stage E: the appeal route. Substance is the rules page's own
    // sentences (7 days to lodge, a different reviewer, a further 7 days,
    // an upheld appeal after payment honoured from our own funds); wording
    // is a draft pending founder voice review like every line in this file.
    appeal: {
      title: 'Appeal this decision',
      note:
        'A reviewer upheld a flag against your entry and your prize passed to the next eligible player. You may appeal within 7 days. A different reviewer decides the appeal within a further 7 days, and every decision is published in the signed log. If your appeal succeeds, we pay you the full prize ourselves.',
      groundsLabel: 'Your grounds',
      windowNote: (until: string) => `Appeals close ${until ? `at ${until}` : 'seven days after the decision'}. Your wallet signs the appeal; nothing else is submitted.`,
      submit: 'Sign and lodge the appeal',
      lodgedOn: (at: string) => `Your appeal was lodged at ${at}. A different reviewer will decide it within 7 days; the decision is published in the signed log.`,
      upheld: 'Your appeal was upheld. We pay you the full prize ourselves.',
      dismissed: 'Your appeal was dismissed. The decision and its reason are in the signed log.',
      outcome: {
        lodged: 'Lodged.',
        not_configured: 'The review service is not configured in this build.',
        cannot_sign: 'This wallet cannot sign messages, and an appeal must be wallet-signed.',
        declined: 'Signing was declined. Nothing was submitted.',
        refused: 'The signature did not verify as this entry’s wallet.',
        window_closed: 'The appeal window for this decision has closed.',
        already_lodged: 'An appeal is already lodged for this entry.',
        nothing_to_appeal: 'There is no upheld flag on this entry to appeal.',
        failed: 'The review service did not accept the appeal. Try again.',
      } as Record<string, string>,
    },
    // No denominator: a pool runs with 52..64 players (D-E4) and the career
    // row does not carry its field size.
    rank: (r: number) => `Ranked #${r}`,
    // SUBSTANCE FIXED (D3-B, ratified 2026-08-27; substance amended by D-E2,
    // ratified 2026-09-06 — one paid place): the split-pot tie rule.
    tieNote:
      'Tied players \u2014 equal on battles won and on stats won \u2014 share a rank. A tie for first splits the prize pool equally between the tied players, an indivisible remainder of a few lamports to the eligible player with the lowest entry number; no other position is paid. The full ranking with tie labels is recomputable on the Verify page from the published data.',
    // E3 (proposal E1 §4): the verified archive. Drafts pending founder
    // voice review — substance (provenance, recomputability) is the
    // architecture speaking; the wording is the founder's to shape.
    archive: {
      title: 'Full standings',
      note:
        'Served from the published results data and re-checked against the on-chain commitment before anything here is shown. Fetch the same data yourself and recompute it — nothing on this page asks for trust.',
      bundleLink: 'Published data',
      verifyLink: 'Recompute on the Verify page',
      winner: (playerShort: string, amountSol: string) =>
        `Winner: ${playerShort} — ${amountSol} SOL`,
      seat: 'Seat',
      player: 'Player',
      rank: 'Rank',
      /** Battle score across the seven battles; a drawn battle counts half. */
      battleScore: 'Battles won',
      prize: 'Prize',
    },
    // Founder 2026-09-09: "an environment where everyone can view the
    // leaderboard and all battles after, for complete transparency." Fed by
    // the published bundle — the same bytes the Verify page recomputes —
    // and only after the pool is published. PHASE-N-REVIEW: drafts.
    allBattles: {
      title: 'Every battle',
      note:
        'All seven battles of every player, read from the published data after the reveal. Five numbers per battle, in the order Strength · Speed · Heart · Wit · Durability.',
      seat: 'Seat',
      battle: (n: number) => `B${n}`,
      notRevealed: 'not revealed',
      loading: 'Reading the published data…',
      failed: 'The published data could not be read just now. The link above fetches the same file.',
      show: 'Show every battle',
      hide: 'Hide the battles',
    },
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
    poolsEntered: 'Pools entered',
    // D-E2: a paid seat is a first place (or a share of one).
    prizeFinishes: 'Prize finishes',
    totalPrizes: 'Total prizes',
    readOnlyNote: 'Profiles are a read-only record. Nothing here affects any pool.',
    myBlots: 'My Blots',
    myBlotsNote:
      'Every battle you have locked, as its Blot — kept on this device only. Shapes, never numbers.',
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
    // PHASE-N-REVIEW: said "held by a multisig" while the devnet value is a
    // single operator key; the page must describe what is built.
    upgradeAuthorityNote:
      'The only key that can change the program code. Before mainnet it moves to the multisig, so an upgrade requires the stated number of signatures; on devnet today it is a single operator key while the rehearsal runs.',
    thresholdLabel: 'Signatures required',
    timelockLabel: 'Upgrade timelock',
    inventoryHeading: 'Key inventory',
    tableHeadings: { key: 'Key', holder: 'Held by', can: 'Can', cannot: 'Cannot' },
    updatedPrefix: 'Configuration last updated',
    keys: {
      admin: {
        name: 'Admin (multisig)',
        can: 'Open or close tiers, set ceilings, switches and pool timings, rotate the service signers and the keeper, pause new entries, and record that a review upheld a flag.',
        cannot:
          'Move money. No admin instruction transfers a lamport \u2014 an upheld flag leaves the prize in the tournament\u2019s own vault for the next eligible player; pausing never blocks settlement or refunds.',
      },
      keeper: {
        name: 'Keeper',
        can: 'Open the next tournament of a tier once the previous one has paid out or closed and the tier\u2019s cooldown has passed. Nobody else can open a tournament, however long a tier sits idle: if the keeper stops, no new tournament opens and no money is at risk — sealing and refunding a tournament that is already running stay open to anyone, and the admin can rotate the keeper at any time.',
        cannot: 'Enter a tournament, move money, or decide when a tournament runs \u2014 the seat count and the clock do.',
      },
      entrySigner: {
        name: 'Entry signer',
        can: 'Sign entry packets — the per-entry approval that a wallet passed the entry checks.',
        cannot: 'Move money or touch pools. A stolen entry signer could admit entrants, never pay itself.',
      },
      settlementSigner: {
        name: 'Settlement signer',
        can: 'Reveal pool secrets after seal, commit results, run the prize payments the program validates, and pay a forfeited prize onward to the next eligible player against the committed results.',
        cannot:
          'Choose amounts or recipients, or enter a tournament. The program checks every payout list against the pot and the recorded entries, and every onward payment against the committed results; a wrong list is rejected on-chain.',
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
          'Pay themselves. A review decision can only release a held prize to its entrant or record that the flag was upheld \u2014 an upheld prize is paid to the next eligible player, never to us.',
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
    // Strings that carry the field-size numbers are functions of the shared
    // constants (rules.config passes MIN_SEATS and the go-timer) — the D-B6
    // rule that no figure on this page is hand-typed.
    howToEnter: (minSeats: number) =>
      `Sign in, pick an open pool, and confirm the 18+ and terms statements — your wallet signs that confirmation once per terms version. Pay the entry price for the tier. Before an entry is accepted, your wallet is checked against published sanctions lists; every winning wallet is checked again before payment. You then set seven battles, about ninety seconds in total: each battle splits 100 points across five stats. Your battles are encrypted on your device before any payment moves. One entry per wallet per pool; there is no limit across pools. The keys that run the service — the admin, the keeper, the entry signer and the settlement signer — can never enter. A pool has 64 seats and runs with at least ${minSeats} players (see the field-size rule). Decisions are final: a submitted entry cannot be changed or withdrawn (see the refund rule for pools that never reach their minimum field).`,
    priceIntro: (cooldownMinutes: number) =>
      `Seven tiers are configured, each with a fixed prize pool. A tier must be switched on by the operator before pools open in it; at launch only the smallest tier is on. One pool per tier is open at a time, and a new pool of that tier opens ${cooldownMinutes} minutes after the previous one has paid out or closed.`,
    // D-E2 (ratified 2026-09-06): one paid place. No percentage, no multiple.
    prizeIntro:
      'Every pool pays a fixed prize pool, funded from the prize treasury before entries open — the table above shows it per tier beside the entry price, and it is the same whatever size the field turns out to be. The player ranked first receives the whole prize pool; if players tie for first, they split it exactly (see ties). Prizes are paid automatically when results are committed; there is no claim step.',
    // SUBSTANCE FIXED (D3-B): identical-field scoring, exactly as the engine
    // implements it (backend/scoring/src/engine.ts). The timer rule has its
    // own section (battleTimer — R9-b).
    scoring:
      'Every player faces the identical field: your battle 1 is compared against every other entry\u2019s battle 1, and so on for all seven. A battle is won by taking three or more of its five stats; if neither side takes three, it is a draw worth half a win to each. Rankings are ordered by total battles won (a draw counts half), then by total stats won across every comparison. The ordering is fully deterministic: the same sealed battles always produce the same ranking.',
    // R9-b (founder addendum 2026-09-07): the battle timer, the founder's
    // wording verbatim — the rule, then its effect stated as how the
    // allocation performs, never as a chance of anything.
    battleTimer:
      'Lock each battle before its timer ends. Any battle you have not locked when the timer ends \u2014 including the one on your screen \u2014 is entered as an even split of 20 points in each of the five stats. The even split is the weakest allocation in the game. Against any allocation that concentrates points on three stats, an even split loses that battle three stats to two, every time. Nothing is decided at random: the even split is simply the shape your entry starts from, and leaving it there is a decision like any other.',
    // SUBSTANCE FIXED (D3-B; D-E2; the founder's addendum of 2026-09-07,
    // rulings 2 and 3, wording verbatim): ranking, ties, and where a
    // forfeited first-place share goes — always to a player, never to us.
    ties:
      'Players are ranked by battles won, then by total stats won. Players who remain equal on both share a rank. Entry order plays no part in ranking or in deciding who is paid. It determines only where an indivisible remainder of a few lamports falls when a prize cannot be divided exactly. Your entry number is recorded when you enter and is visible to you before the tournament closes. No random process is used at any stage of ranking or payment. ' +
      'If two or more players are ranked first, they are paid an equal share of the prize pool each; nobody ranked below first is paid. ' +
      'If a player ranked first is not paid because a flag against them is upheld, their share is divided equally between the remaining eligible players ranked first. If none of the players ranked first is eligible, the whole prize pool passes to the next rank and is divided equally between the eligible players there. Any indivisible remainder goes to the eligible player with the lowest entry number. ' +
      'A prize is always paid to a player. It is never returned to us. ' +
      'Where more than one player shares the rank a prize passes to, we identify that group. The published rule is that they share equally, with any remainder going to the lowest entry number. The results bundle we publish after every tournament lets anyone check that we identified the group correctly.',
    // SUBSTANCE FIXED: randomness scope (PID §8.3/§8.4).
    randomness:
      'Randomness from a Switchboard VRF seed, combined with a later slot hash, decides ONE thing: which character class artwork your pass shows. Class is cosmetic. It does not affect any stat, any battle, any score, any rank, or any prize \u2014 nothing in the scoring path reads it. Scoring and prizes depend only on the sealed battles every player submitted. Every class draw is replayable from published on-chain data.',
    // SUBSTANCE FIXED: the sealing lifecycle (TECH-ARCH §5), the founder's
    // addendum wording of 2026-09-07 (ruling 5) — the key is generated and
    // held by our systems, export-locked; said plainly.
    sealing:
      'Your battles are encrypted on your device before they are submitted. The key that can decrypt them is generated and held by our systems, locked against export, and is not released until the tournament closes and no further entry is possible. Until that moment no battle in the tournament can be read, by us or by anyone else. A hash of your battles is recorded on-chain at entry. When the tournament runs, the pool secret is published on-chain: at that moment everyone\u2019s battles become readable and checkable against the hashes committed at entry, and anyone can re-run the scoring.',
    // D-E4 (ratified 2026-09-06; option A per the founder's ruling of
    // 2026-09-07): the minimum field and the ONE clock, 12 hours at launch.
    // SUBSTANCE FIXED: the seat count and the clock decide when a pool runs
    // \u2014 never the operator; the start and the refund are both permissionless.
    fieldSize: (minSeats: number, fillHours: number) =>
      `A pool has 64 seats and runs with at least ${minSeats} players. Entries stay open for up to ${fillHours} hours from the moment the pool opens. The pool runs the moment the 64th seat fills, or when the ${fillHours} hours end with at least ${minSeats} players seated. Nobody decides when a pool runs; the seat count and the clock do, and anyone can trigger the start once the clock has ended. The prize pool is the same whatever the field size.`,
    refund: (minSeats: number, fillHours: number) =>
      `A pool whose clock runs out with fewer than ${minSeats} players seated \u2014 ${fillHours} hours after it opened \u2014 refunds every entry in full and closes. Your entry payment is held by the program until the pool runs, so the refund never depends on the operator. Anyone can trigger the refund once the deadline passes; no one\u2019s permission is needed.`,
    // D-A1 revised (master prompt v2, 2026-08-27): the pool-opening rule,
    // plus the cooldown (prompt v2 §B.6). SUBSTANCE FIXED: sequential pools
    // + pre-funded fixed pots + the cooldown between them.
    poolOpening: (cooldownMinutes: number) =>
      `Each tier runs one tournament at a time. A tier opens when the prize treasury holds its full prize pool, the previous tournament in that tier has paid out or closed, and ${cooldownMinutes} minutes have passed since. Prize pools are fixed per tier and are funded before entries open.`,
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
      'These signals are computed for every tournament and published with the review log. Nothing is flagged automatically: a flag is a decision by a named reviewer that an entry meets one of the criteria above, ' +
      'and a flag never decides anything by itself \u2014 it only sends the entry to the signed review process below.',
    // C10 + the founder's addendum of 2026-09-07 (ruling 1, wording
    // verbatim): resolving, review and appeal. The published rule is 12
    // hours; the program's seven-day release is the safeguard, not the rule.
    reviewProcess:
      'When a tournament closes, results are published and the tournament enters resolving. Resolving lasts up to 12 hours. ' +
      'During resolving we check the winning wallet against published sanctions lists, as we are required to. Where an entry has been flagged against the integrity criteria published above, a named reviewer decides that flag against those criteria. A flagged prize is held by the program: it is not paid to us and it is not paid to anyone else while the review runs. ' +
      'If no decision is made within 12 hours, the flag is cleared and the prize is paid. Separately, and as a safeguard against our own failure, the program allows anyone at all to release a held prize to the player it belongs to after seven days, without our involvement. ' +
      'You may appeal within 7 days of being notified, and the appeal is decided by a different reviewer within a further 7 days. Every decision is published in a signed log naming the reviewer, the time, and the criterion cited. If an appeal succeeds after the prize has been paid to another player, we pay the appealing player the full prize ourselves. We do not seek to recover a prize already paid.',
    fairPlayLink: 'What keeps this fair, and who may enter',
    headings: {
      howToEnter: 'How to enter',
      price: 'Price and prize pool per tier',
      prizes: 'Who is paid',
      scoring: 'How scoring works',
      battleTimer: 'The battle timer',
      ties: 'Ranking, ties and forfeited prizes',
      randomness: 'What randomness does \u2014 and does not do',
      sealing: 'Sealing: when your battles are encrypted and revealed',
      fieldSize: 'How many players a pool runs with',
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
    },
  },
} as const;
