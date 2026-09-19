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

import { PRIVACY } from './privacy';
import { TERMS } from './terms';

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
    // 2026-09-13 (accessibility baseline): the skip link and the footer
    // landmark, which no page had. PHASE-N-REVIEW: drafts; founder voice.
    skipToContent: 'Skip to content',
    footerNavLabel: 'Rules and fairness',
    footerVerify: 'Verify',
    footerCustody: 'Who holds which keys',
    // The way back from a leaf page (2026-09-13). Every informational page
    // — rules, fair play, verify, custody, a pool, its results — is reached
    // by a link and until now offered no route back but the browser button.
    nav: {
      backToPlay: 'Back to Play',
      backToPools: 'Back to pools',
      backToPool: 'Back to the pool',
      backToHome: 'Back to homepage',
      backToRules: 'Back to the rules',
      backToWallet: 'Back to your wallet',
    },
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
    // The THIRD way (audit 2026-09-11, C-03): the provider never answered.
    // Distinct from the two above because the player can do something about
    // this one — another network, or a reload — and because it clears by
    // itself if the provider turns up. PHASE-N-REVIEW: wording pending the
    // founder's voice, like every line in this file.
    unavailableUnreachable:
      'Sign-in could not be reached. It may be blocked on this network or briefly down — reload to try again. Nothing on-chain is affected.',
    // Shown while the provider is still loading, in place of a row of
    // disabled buttons with no explanation. Same review note as above.
    initializing: 'Connecting to sign-in…',
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
    balanceUnavailable: 'Balance could not be read right now.',
    refresh: 'Refresh',
    whichEmbedded: 'Blotto wallet, made at sign-in',
    whichExternal: (name: string) => `${name} wallet`,
    pickerLabel: 'Play and be paid with',
    addSol: 'Add SOL',
    receiveTitle: 'Add SOL to this wallet',
    receiveSubtitle: 'Send SOL from any wallet or exchange to the address shown.',
    /*
     * D-14 (audit 2026-09-11): the provider's refusal went to the console
     * and the button did nothing a player could see. PHASE-N-REVIEW:
     * drafted, founder may re-voice. SUBSTANCE: say the window did not
     * open, and point at the route that always works — the address above.
     */
    addSolUnavailable:
      'The top-up window did not open. Adding SOL by sending it to the address above works from any wallet or exchange.',
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
    // Shown inside the provider's connect modal.
    linkDescription: 'Connect a wallet to your Blotto account.',
  },
  gate: {
    // 2026-09-13: the "no pool" state used to be three literals inline in
    // play-client.tsx — the only strings on the entry path outside this
    // file. It is also where the header's sign-in used to land every player
    // (return-to.ts); that default is fixed, and this panel now offers the
    // two places a pool can be found rather than one.
    noPoolTitle: 'No pool selected',
    noPool: 'Pick an open tournament to enter. The open pool is on the Play tab; every pool is on the Pools tab.',
    browsePools: 'See all pools',
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
    /*
     * C-13 (audit 2026-09-11): one sentence per reason, because the next
     * step differs. PHASE-N-REVIEW: drafted, founder may re-voice.
     * SUBSTANCE: the two that no retry can fix must not invite one, and a
     * declined prompt is not an error.
     */
    attestErrors: {
      'not-configured':
        'Entry is not available from this build of the site. Nothing was signed and nothing was recorded.',
      'cannot-sign':
        'This wallet cannot sign the confirmation. Connect a different wallet from your wallet page, then come back.',
      declined:
        'The confirmation was not signed. Nothing was recorded — confirm the two statements again when you are ready.',
      cancelled: 'Waiting stopped. Nothing was signed and nothing was recorded.',
      'timed-out':
        'Your wallet did not answer. Open it, check for a pending request, and try again.',
      refused:
        'The confirmation was not accepted. Nothing was recorded \u2014 please try again, and tell us through /complaints if it keeps happening.',
      unreachable:
        'The confirmation could not be recorded. Check your connection and try again.',
    } as const,
    attestCancel: 'Stop waiting',
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
      'The tournament data did not arrive. Try again; if it keeps happening, tell us through /complaints \u2014 include the web address you opened the site from.',
    poolLoadRetry: 'Try again',
    // 2026-09-09: the entry page checks the pool's state and this wallet's
    // existing entry BEFORE the ninety seconds start. PHASE-N-REVIEW.
    poolClosedTitle: 'This pool has closed',
    poolClosed: 'It is no longer taking entries. Another pool in this tier opens once this one has concluded.',
    poolClosedLink: 'See open pools',
    alreadyEnteredTitle: 'You are already in this pool',
    alreadyEntered: (seat: number) =>
      `Seat ${seat} is yours. Your seven battles are sealed and cannot be changed or entered again — one entry per wallet per pool.`,
    alreadyEnteredPool: 'Open the pool page',
    alreadyEnteredResults: 'Results and the leaderboard',
    entriesChecking: 'Checking your entries',
    ageConfirm: 'Confirm and continue',
    gateTitle: 'Before you enter',
    // The Territory line (founder instruction 2026-09-12 §3.3.1). It NAMES
    // the schedule, generated from config/territories.json — a visitor who
    // is refused should be able to see whether their territory is on the
    // list rather than take our word for it.
    //
    // One wording covers both refusals a visitor can hit: a blocked
    // territory, and a location the service could not resolve. That is
    // deliberate on both sides of the seam — the entry service answers every
    // refusal with one shape (`entry_unavailable`), and §3.3.1 says not to
    // tell a visitor their location could not be determined, because that
    // narrates the mechanism rather than stating the rule.
    territoryBlocked: (list: string) =>
      `Not available to residents of ${list}. Access is blocked by location.`,
    territoryBlockedSeeRules: 'The full list is on the rules page.',
    // C9: the balance pre-flight — shown BEFORE the timed session starts,
    // never after battles are allocated.
    balanceInsufficient: (needSol: string, haveSol: string) =>
      `Entering this pool takes about ${needSol} SOL (entry price plus transaction costs). This wallet holds ${haveSol} SOL.`,
    balanceUnavailable:
      'Your wallet balance could not be checked. Entry stays closed until it can be.',
    balanceRetry: 'Check again',
    topUp: 'Add SOL',
    /*
     * D-14 (audit 2026-09-11): the provider's refusal — "Wallet funding is
     * not enabled", its state today — was swallowed into the console, so
     * the button did nothing visible and the balance wall had no way out.
     * PHASE-N-REVIEW: drafted, founder may re-voice. SUBSTANCE: it must say
     * the flow did not open, and point at the route that always works —
     * sending SOL to this wallet's own address.
     */
    topUpUnavailable:
      'The top-up window did not open. You can still add SOL by sending it to this wallet’s address — your wallet page shows it and copies it.',
    topUpWalletPage: 'Open your wallet',
    // The signed-in-but-cannot-sign state (2026-09-08): a returning player
    // whose wallet did not reconnect used to get a normal-looking screen,
    // play all seven battles, press confirm — and nothing happened,
    // permanently, with no error. Now the play screen holds here instead.
    // C-17 / D-13 (audit 2026-09-11): the run survives a reconnect, and a
    // GENUINE account change says so instead of silently restarting.
    // PHASE-N-REVIEW: drafted, founder may re-voice. SUBSTANCE: an entry is
    // made by one wallet, and the player's own work is never discarded
    // without them choosing to.
    walletChangedTitle: 'This browser switched wallets',
    walletChanged:
      'You started this run signed in with a different wallet, and an entry is made by one wallet only. Switch back to that wallet to carry on where you left off, or start again with the wallet you are signed in with now.',
    walletChangedRestart: 'Start again with this wallet',
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
    // PHASE-N-REVIEW (founder 2026-09-16, round two: "more punchy and larger"):
    // the strap is set as display capitals under the film, in three pieces
    // that wrap whole, and "the winner takes" becomes the ratified D-E2 form
    // "Winner takes the prize pool" (pool.tierWinner). Still words, not
    // digits, on the brand surface. Proposal until ratified; alternates in
    // CHANGE-2026-09-16_ui-uplift.md §C.
    line: 'Sixty-four seats \u00b7 Seven battles \u00b7 Winner takes the prize pool',
    // Visually hidden equivalent of the decorative video, for screen readers.
    srIntro: 'Blotto Cup. Sixty-four seats, seven battles, the winner takes the prize pool.',
    dialogLabel: 'Blotto Cup intro',
  },

  pool: {
    // D-E4: the field a pool needs is stated beside the count, always from
    // the shared constant (callers pass MIN_SEATS), never hand-typed.
    entrantsOf: (n: number, minSeats: number) => `${n} / 64 entered · ${minSeats} needed to run`,
    fillDeadline: 'Pool closes for entries in',
    /**
     * What the deadline would do right now (R7-b, founder instruction
     * 2026-09-12 §4.4). The page already shows a countdown beside a seat
     * count; this saves a player knowing the rule and doing the comparison
     * in their head while they decide whether to enter.
     *
     * SUBSTANCE FIXED: both branches state a rule the program enforces, and
     * the refund branch must not soften it — "would refund" is what happens,
     * and a player deciding whether to pay is entitled to it plainly.
     */
    // Founder 2026-09-16 (round two): the pool card no longer renders this —
    // the rule it restated is in pool.aboutPoints directly below the card.
    // Kept because the read API still reports the field it names.
    outcomeIfDeadlineNow: (outcome: 'seal' | 'refund', minSeats: number) =>
      outcome === 'seal'
        ? 'Enough players are seated: if the clock ran out now, this pool would run.'
        : `Not enough players yet: if the clock ran out now, every entry would be refunded in full. ${minSeats} are needed.`,
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
    // 2026-09-13: three literals on the pool page, now here.
    verifyThisPool: 'Verify this pool',
    // PHASE-N-REVIEW (founder 2026-09-16, CHANGE-2026-09-16_ui-uplift.md §A11):
    // the marquee over the pool page's three rule paragraphs, now a neon box
    // on the yellow field. Proposal until ratified.
    aboutHeading: 'How this pool pays',
    // PHASE-N-REVIEW (founder 2026-09-16, round two: "condense the number of
    // words, maybe bullet points, larger"): the four points under that
    // marquee, in place of the three ratified paragraphs prizeRule / sealed /
    // refundRule, which stay as the long forms (sealed is still the sealed
    // panel's line). Substance unchanged: one paid place and a tie for first
    // splits equally (the lamport-remainder rule lives on the Rules page),
    // the key our systems hold locked until the pool closes, the fill clock,
    // the field, the refund. Numbers come from the shared constants via the
    // caller. Proposal until ratified.
    aboutPoints: (minSeats: number, fillHours: number): readonly string[] => [
      'The player ranked first takes the whole prize pool. A tie for first splits it equally.',
      'Your battles are encrypted on your device; the key stays locked in our systems until the pool closes. Only their hash goes on-chain at entry.',
      `Entries stay open for up to ${fillHours} hours. The pool runs the moment all 64 seats fill, or at the deadline with at least ${minSeats} seated.`,
      `Fewer than ${minSeats} seated at the deadline: every entry is refunded in full.`,
    ],
    entryLabel: 'Entry',
    resultsLink: 'Results',
    ageTerritoryNote: '18+ only · not available in some territories',
    // Founder 2026-09-09: "It must be super clear to the user that they
    // should check back when the pool has reached 64 and concluded." The
    // size rule was D-E4's (52) and is now R7-b's (40, 2026-09-12) — this
    // string carried 52 until 2026-09-16 and is the screen a player reads
    // immediately AFTER paying, where PID §8.6 requires the fill deadline
    // and refund rule to be stated accurately. It is a function of the
    // shared constant for that reason, not for tidiness.
    // PHASE-N-REVIEW: drafts; the founder owns the words.
    checkBackTitle: 'Now the pool fills',
    // PHASE-N-REVIEW (founder 2026-09-17, round four, §E): the same rule in
    // two lines, for the column beside the blender.
    checkBackShort: (minSeats: number) =>
      `The pool plays at 64 players, or at its deadline with at least ${minSeats}. Every battle is then revealed and scored, and the ranking appears on the pool page.`,
    checkBack: (minSeats: number) =>
      `Your seven battles are sealed. Nothing more to do here. The pool plays when it reaches 64 players, or at its deadline with at least ${minSeats} — every battle is then revealed and scored, and the ranking appears on the pool page. Check back then.`,
    // D-E11 (founder ruling 2026-09-13): the two email lines that stood here
    // — "Email me when this pool has concluded" and "We will email you when a
    // pool you are in has concluded." — are gone. Nothing in this repository
    // can send an email and there is no provider account, so both were
    // promises a player could check and find false. The opt-in they drove was
    // wallet-signed and stored, which made it worse: the player could show
    // what they agreed to and we could not show we had done it. Cut now,
    // dispatcher later; these lines come back with it.
    viewPool: 'Follow this pool',
    viewResults: 'Results and every battle',
    // D-E1 §1.4 (option A): shown on any pool whose on-chain pot differs
    // from the CURRENT launch table — the guarantee the architecture
    // already provides, said out loud instead of read as a cut.
    potFixedAtOpen:
      'This pool\u2019s prize pool was fixed when it opened and is unaffected by later changes.',
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
    heroTitle: 'Make your Blott',
    tryDials: 'Try the dials',
    // PHASE-N-REVIEW (founder 2026-09-16, CHANGE-2026-09-16_ui-uplift.md §A11):
    // the practice machine now carries the padlocks the run has; one
    // sentence says what they do. Proposal until ratified.
    demoHint:
      'Drag a dial — the other four give way. Press a padlock to hold a stat where it is. Nothing to sign, nothing to pay: this one is just to feel it.',
    // PHASE-N-REVIEW (2026-09-09): the marquee line on the landing machine.
    demoStatus: 'Practice machine',
    openPoolTitle: 'Open now',
  },

  howItWorks: {
    title: 'How it works',
    // Founder wording, 2026-09-09 (replaces "Five stats. One hundred points.
    // Where you put them is the whole game.").
    pentagonCaption: 'Spread Your Skill. Outsmart Your Opponent. Best Strategy Wins.',
    // R7-b (2026-09-12) moved the minimum field 52 -> 40, and step 3 carried
    // the old figure on the LANDING PAGE until 2026-09-16. Like
    // `rules.howToEnter` below, the steps are now a function of the shared
    // constant so the number cannot go stale again; `check-published-numbers`
    // fails the build if a literal comes back.
    steps: (minSeats: number) => [
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
          `When the pool runs — all sixty-four seats filled, or at least ${minSeats} seated when its clock ends — entries are revealed. Your battle one faces every other player’s battle one, and so on through seven. A battle is won by taking three of the five stats.`,
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
    // The two field sizes the study is measured at. Hard-coded until
    // 2026-09-16, when `min` still read "52 seats" over data computed at
    // MIN_SEATS = 40 (fair-play.config.ts derives the number; only the
    // heading was missed). Both are functions of the shared constants now.
    skillHeadings: {
      player: 'Player',
      full: (seats: number) => `First place, ${seats} seats`,
      min: (seats: number) => `First place, ${seats} seats`,
    },
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
    // 2026-09-09: the two refusals the founder met that read as a network fault.
    alreadyEntered:
      "This wallet has already entered this pool, so nothing settled. One entry per wallet per pool is the rule — your seat is held and your battles are sealed. Check the pool page for your entry.",
    poolClosed:
      "This pool is no longer taking entries, so nothing settled. Open pools are listed on the Pools tab.",
    // 2026-09-11 (audit O27): the entry packet is good for sixty seconds, so
    // a wallet approval slower than that is refused on-chain as stale. It
    // used to read as a network fault, with no way to try again.
    packetStale:
      "The approval took longer than an entry allows, so the program declined it. Nothing was entered and nothing was charged. Try again and approve the wallet prompt within a minute.",
    // 2026-09-11 (audit D-12): the entry service DECLINED — an availability
    // or eligibility check, answered before anything was signed. The service
    // deliberately gives no reason (PID §8: the refusal is generic), so
    // neither does this; what it must not do is call a refusal a network
    // fault and offer a retry that can only fail again.
    // PHASE-N-REVIEW (founder 2026-09-16, CHANGE-2026-09-16_ui-uplift.md §A7):
    // the same string also answers the ciphertext store's 409 — one seal per
    // wallet per pool, so a retry after a partial failure is refused before
    // anything is signed (battle-test/LOG.md, 2026-09-16 00:19). The old
    // wording sent that player to the Rules page's eligibility list, which
    // is the wrong explanation. This one is true for both cases and stays
    // generic (PID §8: the refusal gives no reason). Proposal until ratified.
    entryRefused:
      'This entry was not accepted, so nothing was signed and nothing was charged this time. Trying again will not change the answer. If this wallet already made one attempt at this pool, that attempt is the one that stands \u2014 the pool page shows whether a seat was taken, and you can ask us about your own entry through /complaints.',
  },
  battle: {
    screenOf: (k: number) => `Battle ${k} of 7`,
    evenSplit: 'Even split',
    // The effect of the default, stated as how the allocation PERFORMS —
    // never as a chance of anything (the addendum's note for this line).
    timerEffect:
      'The even split is the weakest allocation in the game. Against any allocation that concentrates points on three stats, an even split loses that battle three stats to two, every time. Nothing is decided at random: the even split is simply the shape your entry starts from, and leaving it there is a decision like any other.',
    // The two-step seal (v3 D2): arm, then confirm. §8.6 renders above step 2.
    seal: 'Seal my allocation',
    sealConfirm: 'Confirm — seal and submit',
    sealCancel: 'Go back',
    sealing: 'Sealing your battles…',
    /*
     * NOT HERE, DELIBERATELY (audit 2026-09-11, A-29): a points-remaining
     * counter. This block carried `remainingPoints: 'Points to place'`,
     * unrendered. PID §4.2 is explicit — "the player never does arithmetic
     * and never sees a 'points remaining' counter" — because the counter is
     * what turns a shape into a budgeting puzzle with round targets, and
     * §4.3 quantifies what round targets do to the draw rate. A key that
     * exists is a key someone renders. Also gone: a second copy of the stat
     * names, which are `STAT_NAMES` in `battle/allocation.ts` and must have
     * exactly one definition on the client — they are the fixed stat order
     * the encoding depends on, not decoration.
     */

    /* v4 run (founder brief 2026-09-06), the timer sentence amended by the
     * founder's addendum of 2026-09-07 (R9-b): an unlocked battle is
     * entered as the even split, the one on screen included. */
    approvedTitle: "You're in.",
    begin: 'Make my first Blott',
    ruleNinety:
      'Ninety seconds for all seven battles. Any battle you have not locked when the timer ends \u2014 including the one on your screen \u2014 is entered as an even split of 20 points in each of the five stats.',
    lockBattle: (n: number) => `Lock in battle ${n}`,
    /* Dial locks (founder 2026-09-13): a locked stat keeps its value while
     * the other dials move, and the others share what remains — shown as
     * the dials' RANGE, never as a number (PID §4.2: no points-remaining
     * counter). PHASE-N-REVIEW: drafts; the founder owns the words. */
    lockStat: (name: string, value: number) => `Lock ${name} at ${value}`,
    unlockStat: (name: string) => `Unlock ${name}`,
    lockedStat: (name: string) => `${name} is locked`,
    locksHint: 'A locked stat holds its value. The other dials share what is left.',
    expiredNote: 'Time ran out \u2014 every battle you had not locked was entered as the even split.',
    montageFooter: 'BLOTTO CUP \u00b7 blotto.gg \u00b7 18+ only \u00b7 not available in some territories',
    share: 'Share',
    shareFallbackCopied: 'Share line copied — the image downloaded to your device.',
    // Founder 2026-09-09: "users should be able to share this to X".
    shareX: 'Post on X',
    shareXNote: 'X opened with your line. The image downloaded to your device — attach it to the post.',
    backSheetLine: 'Leaving locks nothing and loses nothing — your clock keeps running.',
    backStay: 'Stay',
    backLeave: 'Leave',

    /* The machine (founder 2026-09-09): a locked Blot drops out of the
     * chute, its still and its five numbers fill one of seven tiles under
     * the machine, and the seventh lock is the crescendo. PHASE-N-REVIEW:
     * drafts; the founder owns the words. */
    // The rendered Blott's accessible one-liner (BlottRaster).
    blottAria: (stats: string) => `Your Blott: ${stats}`,
    tilesLabel: 'Your seven Blotts',
    tileLocked: (n: number, stats: string) => `Battle ${n} locked: ${stats}`,
    tileEmpty: (n: number) => `Battle ${n} — not yet made`,
    // PHASE-N-REVIEW (founder 2026-09-16, CHANGE-2026-09-16_ui-uplift.md §A11):
    // the seal stage's description for assistive tech — the scene is decorative,
    // the sentence says what it shows. Proposal until ratified.
    sealStageAria:
      'Seven Blotts on a conveyor dropping into a blender; the blender runs once your entry is signed.',
    crescendo: 'All seven made.',
    crescendoLine: 'Your Blotts are in the machine. Seal them to enter the pool.',
    // 2026-09-13: what the seal IS, one line, beside the lock. The share
    // that used to sit here moved to the character pass, after the seal is
    // confirmed — see reveal.passShareLine for why.
    sealWhat:
      'Sealing encrypts your seven battles on this device and records their hash on-chain with your entry. Your wallet will ask you to sign once.',
    sealAfter: 'Once sealed, you draw your character pass and can share it.',
  },
  /*
   * The welcome note (2026-09-13; re-voiced 2026-09-14): a short note in the
   * corner of the home page the first time a wallet is signed in, then never
   * again for that wallet. FORMAT borrowed from a reference the founder
   * liked; the WORDS are written to PID §8.7 and are the founder's to
   * re-voice — every line here is a draft.
   *
   * IT IS SIGNED BY THE TEAM, AND NAMES NO INDIVIDUAL (founder instruction
   * 2026-09-14). It was signed with the founder's first name until then.
   * `teamName` is the whole of the signature: there is no person to put a
   * role beside, so the role line is gone rather than re-pointed. Substance
   * is unchanged — what this is, that results are recomputable, and what to
   * do next. No promise this product cannot keep.
   */
  welcome: {
    teamName: 'The Blotto Cup team',
    greeting: 'Welcome to Blotto Cup.',
    paragraphs: [
      "We're the Blotto Cup team. Thank you for joining — we mean that.",
      'Blotto Cup is a competition of judgement: seven sealed battles, five stats to place in each, and the player ranked first takes the whole prize pool. Nothing is decided at random, and every result can be recomputed by anyone from published data.',
      'Pick a pool, make your seven, seal them, and check back when it has played. If anything is unclear, the rules page says it plainly.',
    ],
    justNow: 'Just now',
    dismiss: 'Close',
    cta: 'Find a pool',
  },
  // v3 D3: retention surfaces — mastery and standing only. Factual state
  // changes, never pressure; the do-not-build vocabulary is CI-enforced.
  fixtures: {
    // PHASE-N-REVIEW: the founder asked for a word other than "Fixtures"
    // (2026-09-09); "Prize pools" is the proposal, from the approved lexicon.
    title: 'Prize pools',
    // `statusComingSoon: 'Coming soon'` was removed on 2026-09-13 (founder
    // instruction 2026-09-12 §2.4). A tier the founder has not opened is no
    // longer listed at all, so there is nothing for the phrase to label —
    // and the approved lexicon carries no wording for it, because an
    // unopenable tier advertising a prize pool is a statement about future
    // availability this product is not in a position to make.
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
    // D-E11 (founder ruling 2026-09-13): the email opt-in and its three
    // supporting lines are removed from this surface too, for the same reason
    // as the sealed screen's — we cannot send the mail we were offering. What
    // is left below is in-app delivery to an open tab, which we do perform.
    // PHASE-N-REVIEW (founder 2026-09-17, round four, CHANGE-2026-09-16_ui-uplift.md
    // §E): the one-message opt-in on the sealed screen — back, with an
    // address and a pool this time, and a dispatcher behind it
    // (backend/packet/src/notify-pool.ts). Offered only when the entry
    // service advertises it. Proposals until ratified.
    keepUpdated: 'Keep me updated when this pool ends',
    keepUpdatedEmailPrompt: 'Where should the one message go?',
    keepUpdatedEmailPlaceholder: 'you@example.com',
    keepUpdatedSend: 'Send it there',
    keepUpdatedSigning: 'Confirm in your wallet…',
    keepUpdatedDone: (email: string) =>
      `One message will go to ${email} when this pool ends. The address is deleted the moment it is sent.`,
    keepUpdatedFailed: 'That did not save. Try again in a moment.',
    keepUpdatedBadEmail: 'That does not look like an address.',
    keepUpdatedNote: 'One message about this pool, nothing else. The address is kept only until it is sent.',
    sealed: (id: string) => `Pool #${id} sealed — battles are being revealed`,
    scored: (id: string) => `Pool #${id}: results are committed`,
    paid: (id: string) => `Pool #${id}: prizes are paid`,
    // PHASE-N-REVIEW (founder 2026-09-17, round four A2: "if a wallet has won
    // a prize, there should be a celebration moment when they open the
    // notification"). A Paid pool that paid THIS wallet reads as the win it
    // is — the list line, the toast, and the headline at the top of the
    // sheet. The amount is the chain's (career row, bigint → string).
    won: (id: string, sol: string) => `Pool #${id}: you won ${sol} SOL`,
    wonHeadline: 'Congratulations',
    wonLine: (sol: string) => `You won ${sol} SOL`,
    wonSeeResults: 'See the results',
    refunding: (id: string) => `Pool #${id} did not reach its minimum field — refunds are open`,
  },
  career: {
    chartTitle: 'Prize record',
    chartNote: 'Prize per tournament, in entry order. Prize finishes in amber.',
    // The rivals strings left with the panel on 2026-09-16 (the founder's
    // data-minimisation ruling of 2026-09-15).
  },
  beatYou: {
    title: 'What finished above you',
    // 2026-09-16: the panel reads the published battle set and checks each
    // seat against its on-chain fingerprint; it no longer opens sealed
    // boxes. PHASE-N-REVIEW: wording is a proposal pending the founder's voice.
    note: 'Re-scored in your browser from the published battle set, each seat checked against its on-chain fingerprint. Seats only — no names.',
    headToHead: (w: number, d: number, l: number) => `${w}W · ${d}D · ${l}L against you`,
    unavailable:
      'The sealed battles for this pool are not available to decrypt yet. The Verify page recomputes the full result from the published bundle.',
  },
  share: {
    button: 'Share your result card',
  },
  results: {
    // PHASE-N-REVIEW (round four A2, 2026-09-17): the results page is titled
    // like the pool page — "Pool #N" on the marquee, this word on the chip
    // beside it and on the box the payout list sits in.
    title: 'Results',
    // Share my seven (2026-09-13): the seven-Blott montage, offered only on
    // a closed pool's results page — see results/share-seven.tsx for why it
    // left the review screen. PHASE-N-REVIEW: drafts; the founder owns the words.
    sevenHeadline: 'My seven battles.',
    sevenAlt: 'Your seven Blotts, shapes only',
    shareSevenTitle: 'Share your seven',
    shareSevenLine:
      'This pool has closed, so your seven Blotts can be shown. Every battle in it is on the Verify page, recomputable by anyone.',
    shareSevenText: 'My seven Blotts from Blotto Cup — every result recomputable from published data. blotto.gg',
    paidAutomatically:
      'Prizes are paid automatically when results are committed. No claim step.',
    // Founder addendum 2026-09-07, ruling 1: the published rule is 12 hours.
    escrowHeld:
      'This prize is held by the program while a flag against it is reviewed against the published criteria. If no decision is made within 12 hours, the flag is cleared and the prize is paid.',
    // The held-row label (was a raw string in results-reveal.tsx until
    // Stage E — every user-facing string lives here).
    heldForReview: 'held for review',
    /*
     * CHALLENGING A DECISION (2026-09-19; was `appeal` from Phase 2 Stage E).
     *
     * WHY THE RENAME. The appeal route published a promise it could not
     * keep: "the appeal is decided by a different reviewer within a further
     * 7 days", while the founder-owned reviewer registry holds one person,
     * so no appeal could be decided at all (audit O24). The named-reviewer
     * apparatus is out of the player-facing product — Blotto Cup is the
     * reviewer of record, a human still decides — and a challenge goes
     * through the complaints route, where a person reads it and answers
     * within the published windows (COPY.complaints).
     *
     * The form itself is `complaints/complaint-form.tsx`, so the outcome
     * states, the signed submission and the failure wording live in
     * COPY.complaints and are not duplicated here. These two strings are
     * what the results page adds around it.
     *
     * NO LODGE DEADLINE IS PUBLISHED. The old sentence gave seven days from
     * being notified; the complaints route imposes no deadline, and
     * publishing one the route does not enforce is exactly the defect the
     * claims register exists to catch. A challenge is open for as long as we
     * can do anything about it.
     *
     * PHASE-N-REVIEW: drafts pending the founder's voice.
     */
    challenge: {
      title: 'Challenge this decision',
      note:
        'A flag against your entry was upheld and your prize passed to the next eligible player. You can challenge that decision here. A person reads it, decides it against the published criteria, and the decision and the criterion cited are recorded. If a challenge succeeds after the prize has gone to another player, we pay you the full prize ourselves.',
    },
    // No denominator: a pool runs with MIN_SEATS..64 players (R7-b, which
    // superseded D-E4's 52 on 2026-09-12) and the career
    // row does not carry its field size.
    rank: (r: number) => `Ranked #${r}`,
    // SUBSTANCE FIXED (D3-B, ratified 2026-08-27; substance amended by D-E2,
    // ratified 2026-09-06 — one paid place): the split-pot tie rule.
    tieNote:
      'Tied players \u2014 equal on battles won and on stats won \u2014 share a rank. A tie for first splits the prize pool equally between the tied players, an indivisible remainder of a few lamports to the eligible player with the lowest entry number; no other position is paid. The full ranking with tie labels is recomputable on the Verify page from the published data.',
    // E3 (proposal E1 §4): the verified archive. Drafts pending founder
    // voice review — substance (provenance, recomputability) is the
    // architecture speaking; the wording is the founder's to shape.
    // PHASE-N-REVIEW (D-E8, 2026-09-12): `note` used to say everything shown
    // had been re-checked against the on-chain commitment. That commitment
    // covers the player, the ranking and the prize and nothing else, so the
    // note now claims only those, and `provenance` states the rest of the
    // split — entry number from our own records, battles won recomputed
    // from the published entries. Substance is the founder's ruling; the
    // words await the founder's voice.
    archive: {
      title: 'Full standings',
      note:
        'Served from the published results data, with the player, the ranking and the prize on every row re-checked against the on-chain commitment before any of it is shown. Fetch the same data yourself and recompute it — nothing on this page asks for trust.',
      provenance:
        'The chain commits to three things on each row: the player, their ranking and the prize they were paid. The entry number comes from our own records of the chain. Battles won is recomputed from the published entries — anyone holding that same data can recompute it themselves.',
      /** The entry-number cell where our records have no entry row (D-E8). */
      seatUnknown: 'Entry number not in our records',
      bundleLink: 'Published data',
      verifyLink: 'Recompute on the Verify page',
      winner: (playerShort: string, amountSol: string) =>
        `Winner: ${playerShort} — ${amountSol} SOL`,
      seat: 'Seat',
      player: 'Player',
      rank: 'Rank',
      /** Battle score across the seven battles; a drawn battle counts half. */
      battleScore: 'Battles won',
      // PHASE-N-REVIEW (founder 2026-09-17: "some of the battles won are
      // given as a percentage" — the ½ glyph read as one). Halves are
      // written .5 now, and this line under the table says why a half exists.
      battleScoreNote: 'A drawn battle counts as half a battle won.',
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
  /*
   * THE COMPLAINTS ROUTE (2026-09-19). The way a player contests anything —
   * a decision, a payment, the site, their data — and the route the terms
   * and the privacy notice both point at.
   *
   * It replaces the appeal panel as the way to challenge a decision. The
   * named-reviewer apparatus is out of the player-facing product: Blotto Cup
   * is the reviewer of record, a human still decides, and this is how a
   * player asks for that decision to be looked at again.
   *
   * THE TWO WINDOWS ARE FUNCTIONS OF THE CONSTANTS, never typed figures
   * (COMPLAINT_ACKNOWLEDGE_WORKING_DAYS / COMPLAINT_RESOLVE_DAYS in
   * backend/detection/src/complaints.ts), for the reason every number on a
   * player-facing surface is: on 2026-09-12 a constant moved and three
   * hand-typed strings kept the old figure while every gate reported clean.
   *
   * PHASE-N-REVIEW: every string here is a draft. Brand voice is
   * founder-reserved, and the two response windows are a PROPOSAL awaiting
   * ratification — five working days to acknowledge and thirty days to
   * resolve are windows one person can meet while a pool is running, and a
   * window we miss is worse than one we never published.
   */
  /*
   * The founder-owned operator identity (config/operator.json), rendered by
   * the terms and the privacy notice. No company exists yet, so every value
   * is null and both pages print the line below — never a placeholder that
   * reads as real. Same rule, and the same reason, as the custody page's
   * "not yet set" (app/src/app/custody/custody.config.ts).
   */
  operator: {
    notYetSet: 'not yet set',
  },
  /*
   * THE TWO DOCUMENTS (2026-09-19), in their own modules because each is
   * long enough to read on its own and both are drafted against
   * 01_PRODUCT_FACTS. Exported through here so the one-place rule holds and
   * so the language gate and the published-numbers gate scan them.
   */
  terms: TERMS,
  privacy: PRIVACY,
  complaints: {
    title: 'Complaints',
    /** The FORM's own heading. The page title is already "Complaints", and
     * the same word twice down the page reads as a mistake. */
    formTitle: 'Send a complaint',
    intro:
      'If something has gone wrong — a decision you want looked at again, a payment that did not arrive, a problem with the site, or anything about your own data — this is the route. A person reads every complaint.',
    categoryLabel: 'What is this about?',
    categories: {
      decision: 'A decision I want challenged',
      payment: 'A payment problem',
      site: 'A problem with the site',
      data_protection: 'Data protection',
      other: 'Something else',
    },
    /** Which categories need a wallet signature, and why. */
    signatureNote:
      'Challenging a decision or reporting a payment problem asks us to change an outcome, so your wallet signs the complaint — that is what proves you control the address it concerns. Everything else can be sent without a signature, so you can still reach us if you cannot get into your wallet.',
    signatureNeeded: 'Your wallet will be asked to sign this.',
    signatureNotNeeded: 'No signature needed for this.',
    textLabel: 'What happened',
    textPlaceholder: 'What happened, and what you would like us to do.',
    poolLabel: 'Which tournament (optional)',
    submit: 'Send this complaint',
    submitting: 'Sending…',
    /** The published undertaking. Both figures come from the constants. */
    windows: (acknowledgeWorkingDays: number, resolveDays: number) =>
      `We will acknowledge your complaint within ${acknowledgeWorkingDays} working days and answer it within ${resolveDays} days. A person reads it; no software decides a complaint.`,
    publishedNote:
      'What you write here is not published. It is kept with the complaint, and a decision about a held prize is recorded in the signed decision log either way.',
    referenceLabel: 'Your reference',
    referenceKeep: (reference: string) =>
      `Keep this reference: ${reference}. It is how you ask us about this complaint, and for a signed complaint it is the wallet that signed it that can read the status.`,
    statusTitle: 'Check a complaint',
    statusIntro: 'Already sent one? Enter your reference to see where it is.',
    statusRefLabel: 'Reference',
    statusSubmit: 'Check',
    statusStates: {
      received: 'Received. Nobody has answered it yet.',
      acknowledged: 'Acknowledged. A person is looking at it.',
      resolved: 'Answered.',
    },
    statusSignedYes: 'This complaint was signed by your wallet.',
    statusSignedNo: 'This complaint was sent without a signature.',
    statusNotFound:
      'No complaint matches that reference for this wallet. Check the reference; a signed complaint can only be read by the wallet that signed it.',
    /** One line per ending of a submission. Each says what to do next. */
    outcome: {
      submitted: 'Sent.',
      not_configured:
        'The complaints service is not configured in this build, so nothing was sent. Nothing about your entry or your prize is affected.',
      unreachable:
        'The complaints service could not be reached, so nothing was sent. Try again in a moment — your complaint has not been refused.',
      signature_required:
        'This kind of complaint is signed by the wallet it concerns. Sign in with that wallet and send it again, or choose \u201cSomething else\u201d to reach us without a signature.',
      cannot_sign:
        'This wallet cannot sign messages. Choose \u201cSomething else\u201d to send it without a signature, and say which address it is about.',
      declined: 'Signing was declined, so nothing was sent.',
      clock_skew:
        'Your device\u2019s clock is out of step with the service, so the signature was not accepted. Check the time on your device and send it again.',
      refused: 'The signature did not verify as this wallet\u2019s.',
      already_lodged: 'That reference is already on the record. Nothing was sent twice.',
      too_long: 'Write something first, and keep it under the length the form allows.',
      /** PHASE-N-REVIEW: says whose fault it is, because it is ours, and
       * names the route that does work rather than leaving the player to
       * guess. It must not read as a refusal or as a length problem — the
       * complaint was neither considered nor too long. */
      not_accepted:
        'The complaints service would not accept this complaint as sent, so nothing was sent — and nothing about your entry or your prize is affected. This is a fault at our end, not in what you wrote. Send it from the complaints page, where nothing is filled in for you.',
    } as Record<string, string>,
  },
  verify: {
    title: 'Verify a pool',
    explainer:
      'Recompute the whole result yourself: decrypt every sealed battle with the revealed pool secret, score the identical field, rebuild the results tree, and compare it to what was committed on-chain. Nothing here trusts the operator.',
    // Founder 2026-09-09: more guidance on how to use this page. PHASE-N-REVIEW.
    howTitle: 'How to use this page',
    howSteps: [
      'Open a concluded pool from the Pools tab and press “Verify this pool” — its address arrives here filled in. Or paste any pool address.',
      'Press “Fetch both”. The on-chain record comes from our read API and the published bundle from its permanent address. If you would rather not trust us for the fetch, paste either one by hand from the chain or the gateway.',
      'Press “Recompute”. Your browser decrypts every sealed battle with the revealed pool secret, scores the whole field with the same engine the operator runs, rebuilds the results tree and compares its root with the one committed on-chain.',
    ] as const,
    howVerdict:
      'Green means the published result reproduces exactly from the published data. Red means it does not — and that is worth telling us about. A third answer, in plain type, means nothing disagreed but something could not be checked yet — each row says which.',
    howWhen: 'A pool can be verified once it has concluded and its secret has been revealed; an open pool has nothing to check yet.',
    poolLabel: 'Pool address (fetches the on-chain record)',
    bundleLabel: 'Published bundle address (the pool page links it)',
    fetchBoth: 'Fetch both',
    bundleField: 'Published reveal bundle (JSON)',
    recordField: 'On-chain record (JSON — from the events, or the read API’s /verify-record)',
    recompute: 'Recompute',
    match: 'Recomputed root matches the on-chain commitment.',
    mismatch: 'RECOMPUTED ROOT DOES NOT MATCH — the published data does not reproduce the on-chain result.',
    // The third verdict (audit 2026-09-11, D-10 / D-29). PHASE-N-REVIEW:
    // drafted, founder may re-voice. SUBSTANCE FIXED: it must not read as a
    // pass — something named below was NOT verified — and it must not
    // read as a mismatch, because nothing disagreed.
    incomplete:
      'Everything checked reproduces from the published data. Some of it could not be checked yet — the rows below say which.',
    // D-04: where the bundle address comes from, and what it means when we
    // cannot supply it. PHASE-N-REVIEW: drafted, founder may re-voice.
    bundleUriFound: 'Bundle address filled in from the published archive.',
    bundleUriUnavailable:
      'We could not supply this pool\u2019s bundle address. That happens when the published bundle has not been verified against the on-chain commitment \u2014 which is exactly when checking it yourself matters most. The address is in the pool\u2019s own publication record on the gateway, and we will give it to you on request through /complaints.',
  },
  profile: {
    title: 'Your career',
    lifetime: 'Lifetime record',
    poolsEntered: 'Pools entered',
    // D-E2: a paid seat is a first place (or a share of one).
    prizeFinishes: 'Prize finishes',
    totalPrizes: 'Total prizes',
    readOnlyNote: 'Profiles are a read-only record. Nothing here affects any pool.',
    /*
     * The caveat beside the rarity collection — the ONE place a player sees
     * their drawn tier. The wording is the founder's ruling of 2026-09-14,
     * accepted in place of "this rarity means nothing right now, but it
     * might mean something in the future": that second half tells a paying
     * player a random draw may later carry value, which inverts the PID
     * §8.4 position that the class is decorative and worth nothing, and so
     * is a founder-and-counsel question, not copy. This sentence states the
     * ratified position and nothing more.
     */
    rarityCaveat:
      "Rarity is decorative. It changes nothing: not your battles, not your score, not your ranking, and no prize. A Mythic's Strength is worth exactly a Common's.",
    // Moved here from profile-client.tsx on 2026-09-17 (same words).
    collection: 'Character collection',
    myBlots: 'My Blotts',
    // 2026-09-13: this line said "Shapes, never numbers" — but a Blott's
    // shape IS its numbers (components/blott/warp.ts), which is why the
    // grid no longer offers a share. It says what is true instead.
    myBlotsNote:
      'Every battle you have locked, as its Blott — kept on this device only. Once a pool has closed, its results page lets you share the seven.',
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
      /*
       * WRITTEN BUT NOT RENDERED (audit 2026-09-11, A-29 — reported, not
       * removed). `custodyView()` in app/custody/custody.config.ts builds
       * seven rows and this is not one of them, so the disclosure page
       * omits a key the program treats as real: `Config.keeper` is the ONLY
       * signer `open_pool` accepts (programs/blotto_cup/src/state.rs), and
       * the admin rotates it with `set_keeper`.
       *
       * It is NOT wired here because the row needs a holder and there is no
       * `keys.keeper` in the founder-owned `config/custody.json` — that
       * file's committed value discloses the devnet keeper inside the
       * settlement signer's own string instead. Inventing a holder, or
       * rendering "not yet set" over a key whose holder IS recorded, would
       * both be worse than the omission. Adding `keys.keeper` to the config
       * is a founder edit; the row follows it.
       */
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
      /*
       * RENAMED 2026-09-19, from `reviewers` / "Reviewer wallets". The
       * named-reviewer apparatus is out of the player-facing product:
       * Blotto Cup is the reviewer of record and a person still decides.
       * The founder-owned key list (`config/reviewers.json`) is UNCHANGED
       * and still gates the admin surfaces — what changed is that a player
       * is no longer pointed at it, because a registry of names was never
       * a disclosure they could act on.
       *
       * The two limits are the load-bearing half and are kept word for
       * word: the key cannot pay itself, and an upheld prize goes to the
       * next eligible player and never to us.
       */
      decisionKey: {
        name: 'Operator decision key',
        holderNote: 'Held by Blotto Cup',
        can: 'Sign review decisions on flagged entries; every decision is recorded in a public, signed log.',
        cannot:
          'Pay itself. A review decision can only release a held prize to its entrant or record that the flag was upheld \u2014 an upheld prize is paid to the next eligible player, never to us.',
      },
    },
  },
  reveal: {
    // The five classes are named to players by rarity tier ONLY — ladder
    // order 0..4, and the count of each per pool of 64 (LAUNCH_CLASS_COUNTERS
    // in the program — the published bag). The creature names PID v0.5 §3
    // carried (Goblin … Titan) were dropped by the founder on 2026-09-15;
    // the program's class indices are unchanged. Cosmetic: labels read by
    // nothing in any scoring or prize path, and shown on the profile only.
    cardTitle: 'Your pass',
    // Round four (§E): the heading beside the trophy Blott on the sealed column.
    sealedTitle: 'Sealed',
    rarityNames: ['Common', 'Uncommon', 'Rare', 'Epic', 'Mythic'] as const,
    rarityCounts: [38, 15, 7, 3, 1] as const,
    rarityOf: (count: number) => `${count} of every 64 passes`,
    cardSeat: (n: number) => `Seat ${n + 1} of 64`,
    cardDone: 'Continue',
    /*
     * The pass as a SHAREABLE card (2026-09-13). This replaces the share
     * that used to sit on the review screen BEFORE sealing: that one handed
     * the player a picture of their seven Blotts, and a Blott's silhouette is
     * a deterministic function of its five stats (components/blott/warp.ts)
     * — so the image was the sealed allocation, readable, offered for
     * publication while the pool was still open. The pass carries the seat
     * and the pool number: public, nothing sealed — and since 2026-09-15 not
     * the drawn class either (founder 2026-09-14: the rarity assignment is
     * not broadcast to players).
     * PHASE-N-REVIEW: drafts; the founder owns the words.
     */
    passEntered: "I'm in.",
    passPool: (n: string | number) => `Pool #${n}`,
    passShareTitle: 'Share your pass',
    passShareLine: 'Your seven battles stay sealed. The pass shows your pool and your seat — nothing more.',
    // The waiting beat, between the signature and the chain's answer. It
    // replaced the egg's "keep tapping, or simply wait" (2026-09-15).
    confirming: 'Confirming your entry with the network. Nothing more is needed from you.',
    passShareText: (n: string | number) =>
      `I'm in Blotto Cup pool #${n}. Seven sealed battles, the winner takes the prize pool. blotto.gg`,
    passShare: 'Share',
    passShareX: 'Post on X',
    passShareFallbackCopied: 'Share line copied — the pass downloaded to your device.',
    passShareXNote: 'X opened with your line. The pass downloaded to your device — attach it to the post.',
    passFooter: 'BLOTTO CUP · blotto.gg · 18+ only · not available in some territories',
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
    // §3.3.2 + the HUB-06 §6 pattern: the schedule can change with notice,
    // so the page says when it last did and which version a reader is
    // looking at, rather than presenting the list as permanent.
    availabilityUpdated: (updated: string, version: number) =>
      `This list was last updated on ${updated} (schedule version ${version}). It can change with notice.`,
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
      // NARROWED 2026-09-16. This read "the same device or network origin"
      // until a review found the network half does not run: the daemon
      // passes `ipHash: ''` for every entry (backend/reveal/src/main.ts),
      // the hashed-IP capture at ciphertext submission is not built, and
      // `deviceIpCorrelation` correctly skips an empty key -- so the IP
      // branch is inert rather than wrong, and correlates nothing, ever.
      // The device half is real and is the HARD-BLOCK half (R11).
      // A published claim does not wait on a build, so the sentence is
      // narrowed to what runs; it widens again when the capture lands.
      '(4) the same device behind multiple entries in one pool; ' +
      '(5) a score far outside the field’s distribution. ' +
      'These signals are computed for every tournament and published with the review log. Nothing is flagged automatically: a flag is a decision taken by a person that an entry meets one of the criteria above, ' +
      'and a flag never decides anything by itself \u2014 it only sends the entry to the signed review process below.',
    /*
     * C10 + the founder's addendum of 2026-09-07 (ruling 1): resolving,
     * review and the route to contest a decision. The published rule is 12
     * hours; the program's seven-day release is the safeguard, not the rule.
     *
     * REWRITTEN 2026-09-19 — THE NAMED REVIEWER IS OUT OF THE PRODUCT.
     * Three sentences went, and each for the same reason: they described an
     * apparatus rather than an undertaking, and the apparatus could not
     * keep them.
     *
     *   "a named reviewer decides that flag" \u2192 "a person decides". The
     *   decision is still a human one signed into the append-only log; who
     *   that person is was never a player's business and naming the role
     *   implied a panel that does not exist.
     *
     *   "the appeal is decided by a different reviewer within a further 7
     *   days" \u2192 gone. The founder-owned registry holds one person, so no
     *   appeal could be decided at all (audit O24), and the seven-day lodge
     *   deadline is not published any more either: a challenge goes through
     *   the complaints route, which imposes no deadline. Publishing a
     *   window nothing enforces is the exact defect this file's claims
     *   register exists to catch.
     *
     *   "published in a signed log naming the reviewer" \u2192 "recorded". The
     *   log is still append-only and still signed; what is no longer
     *   promised to a player is a name in it.
     *
     * What did NOT change, and must not (brief \u00a71.4): the 12-hour clock
     * read from REVIEW_WINDOW_SECS, the seven-day permissionless release,
     * the decision record, and the undertaking to pay a successful
     * challenge ourselves without recovering a prize already paid.
     */
    reviewProcess:
      'When a tournament closes, results are published and the tournament enters resolving. Resolving lasts up to 12 hours. ' +
      'During resolving we check the winning wallet against published sanctions lists, as we are required to. Where an entry has been flagged against the integrity criteria published above, a person decides that flag against those criteria. A flagged prize is held by the program: it is not paid to us and it is not paid to anyone else while the review runs. ' +
      'If no decision is made within 12 hours, the flag is cleared and the prize is paid. Separately, and as a safeguard against our own failure, the program allows anyone at all to release a held prize to the player it belongs to after seven days, without our involvement. ' +
      'You may challenge a decision through our complaints route, and we will tell you which criterion was cited. Every decision and the criterion cited are recorded. If a challenge succeeds after the prize has been paid to another player, we pay you the full prize ourselves and do not seek to recover a prize already paid.',
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
