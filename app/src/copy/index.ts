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

/*
 * The hero's lines (founder wording, V3 2026-09-27), one per line on the
 * landing. Joined, they are the shell's tagline (the <title>).
 *
 * D-E19 (the Ladder, 2026-11-05): "Sixty Four Seats" and "The winner takes
 * the prize pool" stopped being true — pools hold 8, 16, 32 or 64 players
 * and pay their highest places on a fixed table.
 * PHASE-N-REVIEW: draft wording; founder voice / counsel.
 */
const HERO_LINES = ['Eight to Sixty Four Players. Seven Battlefields.', 'Everyone battles everyone.', 'The top of the ranking takes the prizes.'] as const;

/**
 * A finishing place in words: 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st.
 * Display only; the rank itself is the integer the results tree commits to.
 */
function place(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const unit = n % 10;
  return `${n}${unit === 1 ? 'st' : unit === 2 ? 'nd' : unit === 3 ? 'rd' : 'th'}`;
}

/** "8, 16, 32 or 64" — a list of figures the caller derived, never typed here. */
function orList(items: readonly (string | number)[]): string {
  const all = items.map(String);
  return all.length <= 1 ? (all[0] ?? '') : `${all.slice(0, -1).join(', ')} or ${all[all.length - 1]}`;
}

/** One pool size and the figures that go with it — every number from @blotto/scoring via the caller. */
export interface SizeFacts {
  capacity: number;
  minField: number;
  paidPlaces: number;
}

/** A run of places paying the same amount, already formatted (data/prizes.ts groups them). */
export interface PrizeRunText {
  from: number;
  to: number;
  sol: string;
}

export const COPY = {
  shell: {
    title: 'Blotto Cup',
    // D-E19 (the Ladder, 2026-11-05; superseding D-E2's one paid place):
    // fixed prizes for the highest places, recomputable results. No
    // multiple and no percentage, ever (proposal E1 §2.5's copy constraint).
    // PHASE-N-REVIEW: draft wording; founder voice / counsel.
    tagline: HERO_LINES.join(' '),
    metaDescription:
      'Pools of eight to sixty-four players, each setting seven sealed battles of five stats — 100 points a battle, or 700 placed anywhere in a hard pool. ' +
      'The highest-ranked players in every pool are paid fixed prizes, funded before entries open, and every result is recomputable from published data.',
    tabs: { play: 'Play', pools: 'Pools', profile: 'Profile' },
    // The honest degraded state: the data service is unreachable, which is
    // NOT the same statement as "no tournament is open".
    liveDataUnavailable: 'Live pool data is temporarily unavailable.',
    liveDataUnavailableDetail:
      'The data service could not be reached. Refresh in a moment — nothing on-chain is affected.',
    // The terms and the privacy notice offered whole, for anyone who wants
    // to read one as a single document (components/ui/section-tiles.tsx).
    readAsOnePage: 'Read as one page',
    oneSectionAtATime: 'One section at a time',
    // The close key on every dialog (components/ui/modal.tsx, sheet.tsx).
    close: 'Close',
    // 2026-11-05: the site is open to everyone while it still runs on the
    // test network, so every page says so (components/shell/test-network-notice.tsx).
    // Rendered on every build that is not mainnet; a mainnet build never shows it.
    // PHASE-N-REVIEW: draft wording; founder voice.
    testNetworkNotice: 'Test network. Entries use test SOL, which has no value. No real money is involved.',
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
    /*
     * The second clause — "or use a Solana wallet you already have" — was
     * removed on 2026-09-24 with the external-wallet buttons. It had to go
     * with them: a page that offers no wallet route must not open by
     * promising one, and a player reading it would look for a control that
     * is not there.
     *
     * PHASE-N-REVIEW: the shortened line is the architect's, cut to the
     * minimum true statement rather than re-voiced. The founder owns the
     * wording. Put the clause back when `EXTERNAL_WALLET_SIGNIN_ENABLED`
     * goes back to true (app/src/app/signin/signin-client.tsx).
     */
    subtitle: 'Sign in with an account and a wallet is made for you.',
    /*
     * INSIDE THE SOLANA MOBILE SHELL (2026-09-28, D-E18) the social routes
     * are not offered — Google refuses to open its sign-in page inside an
     * embedded WebView — so the page opens on the wallet rows and says so.
     * PHASE-N-REVIEW: plain sentence pending the founder's wording.
     */
    webshellSubtitle: 'Sign in with your Solana wallet. Phantom and Solflare are the tested ones.',
    google: 'Continue with Google',
    // Apple removed 2026-09-24 (founder): the provider was never enabled and the
    // button did nothing. See wallet/types.ts.
    twitter: 'Continue with X',
    // The provider modal's own subtitle (capped at 100 characters by the SDK).
    // PHASE-N-REVIEW: draft wording (D-E19); founder voice / counsel.
    modalMessage: 'Seven sealed battles. Fixed prizes, funded before entries open.',
    walletDivider: 'or connect a wallet',
    detected: 'Detected',
    moreWallets: 'More wallets',
    moreWalletsNote: 'Solflare, Backpack, a mobile wallet, or a QR code',
    // Under the wallet rows on a desktop browser where Phantom is not
    // detected (signin/extension-hint.ts). The founder's wording, approved
    // 2026-11-04, after a tester with Phantom installed but not active on
    // the site was sent to the Chrome Web Store.
    phantomNotDetected:
      "Have Phantom installed but don't see it here? Make sure it's switched on for this site, in this Chrome profile, then reload.",
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
    continueLink: 'Find a pool',
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
    // V2 (founder 2026-09-27): the exit is called what it is for.
    send: 'Cash out',
    sendTitle: 'Cash out — send SOL',
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
    noPool: 'Pick an open pool to enter. The open pools are on the home page; every pool is on the Pools tab.',
    browsePools: 'See all pools',
    ageAttestation:
      'I confirm I am 18 or older and that entering a paid pool for prizes is lawful where I live.',
    // D-B4: the versioned clickwrap around the line above. SUBSTANCE FIXED:
    // acceptance is recorded with the wallet's signature and the terms
    // version; the wording of what is being accepted must stay accurate.
    // Founder 2026-09-09: no version number on screen or in the signed
    // statement; the edition is named by its date (the message binds it).
    termsAcceptance:
      'I accept the Blotto Cup terms. My wallet signs this statement once and the acceptance is recorded.',
    // V5 (founder 2026-09-30): the clickwrap is no longer its own screen.
    // The two statements stand on the board's rail (app/play/entry-rail.tsx)
    // and the one seal key waits on them; the lead, the step labels and
    // "Confirm and continue" that the full-screen gate carried are gone.
    // PHASE-N-REVIEW: drafts; the founder owns the words.
    statementsLabel: 'Before you can seal',
    // What the greyed seal key says on hover while the statements wait
    // (the board's own reason, "Allocate all blotts first", comes first).
    sealHoldStatements: 'Confirm the two statements first',
    // The stop card when the statements could not be signed at the seal:
    // the seven battles are kept, and Try again re-runs the same press.
    attestFailedTitle: 'Your statements were not signed',
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
    poolMissing: 'No pool with this address is listed. It may have closed, or the link may be old.',
    poolLoadFailedTitle: 'The pool could not be loaded',
    poolLoadFailed:
      'The pool data did not arrive. Try again; if it keeps happening, tell us through /complaints \u2014 include the web address you opened the site from.',
    poolLoadRetry: 'Try again',
    // 2026-09-09: the entry page checks the pool's state and this wallet's
    // existing entry BEFORE the ninety seconds start. PHASE-N-REVIEW.
    poolClosedTitle: 'This pool has closed',
    poolClosed: 'It is no longer taking entries. Another pool of this size opens once this one has concluded.',
    poolClosedLink: 'See open pools',
    alreadyEnteredTitle: 'You are already in this pool',
    // D-E19 sweep: "seat" left the public copy; the number is the entry number.
    alreadyEntered: (seat: number) =>
      `Entry number ${seat} is yours. Your seven battles are sealed and cannot be changed or entered again — one entry per wallet per pool.`,
    alreadyEnteredPool: 'Open the pool page',
    alreadyEnteredResults: 'Results and the leaderboard',
    entriesChecking: 'Checking your entries',
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
    territoryBlockedTitle: 'Not available here',
    territoryBlocked: (list: string) =>
      `Not available to residents of ${list}. Access is blocked by location.`,
    territoryBlockedSeeRules: 'The full list is on the rules page.',
    // C9: the balance pre-flight — shown BEFORE the timed session starts,
    // never after battles are allocated.
    balanceInsufficientTitle: 'Not enough SOL for this entry',
    balanceUnavailableTitle: 'Balance check needed',
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
    signInTitle: 'Sign in to enter',
    signInLine: 'Entering needs a signed-in wallet.',
    signerMissingTitle: 'Your wallet is not ready',
    signerMissing:
      'This wallet is signed in but cannot sign yet. Reconnect it from your wallet page, or sign out and in again, before entering.',
    signerMissingLink: 'Open your wallet',
    /*
     * The KNOWN case (D-E18): a mobile wallet that signs in but offers
     * sign-and-send only, which the entry path cannot use (wallet/types.ts,
     * `signerLimit`). Different next step from `signerMissing` — reconnecting
     * cannot help — so it gets its own sentence. PHASE-N-REVIEW: wording.
     */
    signerCannotSignTransactions:
      'This wallet can sign in but cannot enter a pool yet. Sign out and sign in with Phantom or Solflare.',
  },
  /*
   * THE BUILD CHECK (2026-09-28, D-E18: one build for every channel). Just
   * before the entry is sealed the page asks the server which build is
   * live; if this page is from an older one — a tab or the Android app
   * left open across a deploy — it stops here, before anything is signed,
   * and offers a reload. Nothing was sent, nothing was signed, nothing
   * changed on chain. PHASE-N-REVIEW: plain sentences pending the
   * founder's wording; keeping the board across the reload is a follow-up.
   */
  build: {
    staleTitle: 'Blotto Cup has been updated',
    stale:
      'This screen is from an earlier version of the site, so the entry was not sealed and nothing was signed. Reload to get the current version, then play the board again.',
    reload: 'Reload',
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
    // D-E19 (2026-11-05): the pools hold 8 to 64 players and pay a fixed
    // table, so "seats" and "winner takes" went. Still three pieces split on
    // the middle dot. PHASE-N-REVIEW: draft wording; founder voice / counsel.
    line: 'Eight to sixty-four players \u00b7 Seven battles \u00b7 Fixed prizes',
    // Visually hidden equivalent of the decorative video, for screen readers.
    srIntro: 'Blotto Cup. Pools of eight to sixty-four players, seven battles, fixed prizes for the top of the ranking.',
    dialogLabel: 'Blotto Cup intro',
  },

  pool: {
    // D-E4: the field a pool needs is stated beside the count. D-E19: both
    // numbers are the POOL's own (`poolLadder`), never a global or a literal.
    entrantsOf: (n: number, capacity: number, minSeats: number) =>
      `${n} / ${capacity} entered · ${minSeats} needed to run`,
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
        ? 'Enough players have entered: if the clock ran out now, this pool would run.'
        : `Not enough players yet: if the clock ran out now, every entry would be refunded in full. ${minSeats} are needed.`,
    // The pool's whole prize pool, as one Stat. D-E19: the per-place table
    // is back (components/pools/prize-table.tsx) — a pool pays its highest
    // places, so the total alone no longer says who is paid what.
    prizeLabel: 'Prize pool',
    // SUBSTANCE FIXED (D3-B; D-E19 superseding D-E2's one paid place): paid
    // by place; a tie shares the prizes of the places it occupies.
    // PHASE-N-REVIEW: draft wording; founder voice / counsel.
    prizeRule:
      'Prizes are paid by place, from the pool\u2019s fixed prize table. Players tied on a rank share equally the prizes of the places they occupy together; an indivisible remainder of a few lamports goes to the eligible player with the lowest entry number.',
    // PID §8.6: displayed ABOVE the enter button, always.
    decisionsFinal:
      'Decisions are final. Once your seven battles are submitted they cannot be changed or withdrawn.',
    enter: 'Enter this pool',
    // 2026-09-13: three literals on the pool page, now here.
    verifyThisPool: 'Verify this pool',
    // PHASE-N-REVIEW (founder 2026-09-16, CHANGE-2026-09-16_ui-uplift.md §A11):
    // the marquee over the pool page's three rule paragraphs, now a neon box
    // on the yellow field. Proposal until ratified.
    // PHASE-N-REVIEW (founder 2026-09-16, round two: "condense the number of
    // words, maybe bullet points, larger"): the four points under that
    // marquee, in place of the three ratified paragraphs prizeRule / sealed /
    // refundRule; prizeRule stays as the long form (the sealed line left
    // with the sealed panel, 2026-09-27; rules.sealing is the full statement).
    // Substance unchanged: one paid place and a tie for first
    // splits equally (the lamport-remainder rule lives on the Rules page),
    // the key our systems hold locked until the pool closes, the fill clock,
    // the field, the refund. Numbers come from the shared constants via the
    // caller. Proposal until ratified.
    /*
     * "How this pool plays" (founder 2026-09-24): the mode boundary a player
     * reads BEFORE paying — the rule of THIS pool, config-driven (D-B6).
     * Phase A: every pool is easy. PHASE-N-REVIEW: drafts; founder-owned.
     */
    // V2 (founder 2026-09-27): one box, "How this pool…", a Plays / Pays
    // toggle inside it. The two headings above became the toggle's words.
    // V5 (founder 2026-09-30): the box stands beside the board
    // (components/pools/pool-rules.tsx on the entry rail), not on the pool page.
    howThisPool: 'How this pool…',
    rulesToggleAria: 'Plays or pays',
    rulesPlays: 'Plays',
    rulesPays: 'Pays',
    howItPlays: (mode: 'easy' | 'hard', minutes: number): readonly string[] =>
      mode === 'easy'
        ? [
            'Seven battles. In each one you split 100 points across Strength, Speed, Heart, Wit and Durability.',
            `${minutes} minutes on one clock for all seven. It starts when you place your first point.`,
            'At the buzzer whatever is on the board is your entry. Points you have not placed in a battle are spread evenly across its five stats, unless you locked that battle in.',
            'A battle is won by taking three of the five stats against an opponent. Every player faces every other player.',
          ]
        : [
            'Seven battles and 700 points. Place them anywhere — all in one battle, spread across all seven, or anything between.',
            `${minutes} minutes on one clock. It starts when you place your first point.`,
            'At the buzzer whatever is on the board is your entry. Points you have not placed are spread evenly across every stat of every battle you have not locked in.',
            'A battle is won by taking three of the five stats against an opponent. Every player faces every other player.',
          ],
    // D-E19: the "Pays" side states THIS pool's table in the founder's
    // prize sentence (`prizes.sentence`, built by the caller from the pool's
    // own amounts) and its own size and floor. PHASE-N-REVIEW: draft
    // wording; founder voice / counsel.
    aboutPoints: (p: {
      prizeSentence: string;
      capacity: number;
      minSeats: number;
      fillHours: number;
    }): readonly string[] => [
      p.prizeSentence,
      'Players tied on a rank share equally the prizes of the places they occupy together.',
      'Your battles are encrypted on your device; the key stays locked in our systems until the pool closes. Only their hash goes on-chain at entry.',
      `Entries stay open for up to ${p.fillHours} hours. The pool runs the moment ${p.capacity} players have entered, or at the deadline with at least ${p.minSeats}.`,
      `Fewer than ${p.minSeats} players at the deadline: every entry is refunded in full.`,
    ],
    entryLabel: 'Entry',
    resultsLink: 'Results',
    ageTerritoryNote: '18+ only · not available in some territories',
    // Founder 2026-09-09: "It must be super clear to the user that they
    // should check back when the pool has reached 64 and concluded." The
    // size rule was D-E4's (52) and is now R7-b's (40, 2026-09-12) — this
    // string carried 52 until 2026-09-16 and is the screen a player reads
    // immediately AFTER paying (the success screen, entered-panel.tsx),
    // where PID §8.6 requires the fill deadline and refund rule to be stated
    // accurately. It is a function of the POOL's own size and floor
    // (D-E19) for that reason, not for tidiness. PHASE-N-REVIEW: draft
    // wording; founder voice / counsel.
    checkBack: (capacity: number, minSeats: number) =>
      `The pool plays when ${capacity} players have entered, or at its deadline with at least ${minSeats}. Every battle is then revealed and scored, and the ranking appears on the pool page.`,
    // `potFixedAtOpen` went with D-E19: a pool's table is its own on-chain
    // copy, so there is no launch table for the page to compare it with.
    noOpenPool: 'No pool is open for entries right now.',
    // PHASE-N-REVIEW: draft wording (D-E19); founder voice / counsel.
    noOpenPoolDetail:
      'A pool opens once the prize treasury holds its full prize pool, the previous pool of the same size, board and price has paid out or closed, and a short cooldown has passed.',
    // D-E4 (option A, 2026-09-07): the fill rule in one breath — field
    // size, the one clock, the refund. D-E19: the pool's own size and floor,
    // from the caller (12 hours at launch). PHASE-N-REVIEW: draft wording.
    refundRule: (capacity: number, minSeats: number, fillHours: number) =>
      `Entries stay open for up to ${fillHours} hours. The pool runs the moment ${capacity} players have entered, or when time runs out with at least ${minSeats}. If fewer than ${minSeats} have entered when time runs out, every entry is refunded in full.`,
    // Per-tier lobby (the old handover's §5A remainder, closed 2026-08-28).
    tierEntry: (sol: string) => `${sol} SOL entry`,
    tierPot: (sol: string) => `${sol} SOL prize pool`,
    // D-E19 (the pools tab): one group per pool size, headed by its size.
    // PHASE-N-REVIEW: draft wording; founder voice.
    sizeGroup: (sol: string, capacity: number) => `${sol} SOL · ${capacity} players`,
    sizeFilterAria: 'Show pools of this size',
    sizeFilterAll: 'All',
    tierTableLink: 'Full prize tables',
    // E3: the archive strip on the pools tab. Draft pending founder voice
    // review; the substance (settled pools remain browsable, every result
    // recomputable) is the architecture speaking.
    archiveTitle: 'Archive',
    archiveNote: 'Settled pools. Every result here is recomputable from published data.',
    // Phase 2 Stage C: the derived RESOLVING badge — the published process
    // ("the tournament enters resolving. Resolving lasts up to 12 hours")
    // made visible on the pool a held share belongs to. Label + countdown
    // label + one-line note. Substance is the rules page's own sentence
    // (the hours come from the shared constant via the caller); wording is
    // a draft pending founder voice review like every line in this file.
    resolving: 'Resolving',
    // V2 (founder 2026-09-27): one word set for a pool's state everywhere —
    // an open pool is "Open now" on the home card, the list and the page.
    stateOpen: 'Open now',
    resolvingEndsIn: 'Resolving ends in',
    resolvingNote: (hours: number) =>
      `Results are published. A prize on this pool is held while a flag against it is reviewed. If no decision is made within ${hours} hours, the flag is cleared and the prize is paid.`,
  },
  // The landing page's game explainer (founder ask 2026-08-28). Substance
  // must match the rules tab and PRODUCT-FACTS; wording is founder-voiced
  // like all copy — re-voicing rights reserved.
  landing: {
    // Founder 2026-09-27: the hero title, two lines. The break is the
    // founder's; the h1 renders it with `whitespace-pre-line`.
    heroTitle: 'Battle ready\nBlotts',
    heroLines: HERO_LINES,
    // Founder 2026-09-27: with two boards open the hero's button cannot say
    // which pool, so it takes the player to the picker instead.
    chooseYourPool: 'Choose your pool ↓',
    // The board (founder 2026-09-24): the landing's toy is the board.
    // PHASE-N-REVIEW: drafts; founder-owned.
    tryBoard: 'Try the board',
    demoBoardHint:
      'Tap a troop, press and hold a field. Nothing to sign, nothing to pay: this one is just to feel it. A real entry plays the same board with a three-minute clock.',
    // V3 (founder 2026-09-27): beside the demo, straight into the easy flow.
    enterForReal: 'Enter for real',
    /*
     * V2 (founder 2026-09-27, Figma Concept A as ONE card): a single
     * full-width card with an Easy / Hard toggle and a tier filter. The
     * hard side reads "Opens soon" ONLY when the founder has enabled the
     * hard ladder on chain and no hard pool is open yet (the tiers API says
     * so; nothing in the app decides it). A tier the founder has not opened
     * is listed greyed with "Not open yet" (founder ruling 2026-09-27,
     * reversing 2026-09-12 §2.4) and cannot be chosen. All drafts;
     * founder-owned.
     */
    pickBoardTitle: 'Pick your board',
    // PHASE-N-REVIEW: draft wording (D-E19, the four sizes); founder voice.
    pickBoardLine:
      'Both boards give you 700 points for seven battles. Easy puts exactly 100 in every battle. Hard lets you move them anywhere. Every pool comes in four sizes, and the bigger the pool, the more places are paid.',
    pickBoardAria: 'Which board',
    tierFilterAria: 'Which entry price',
    tierNotOpen: 'Not open yet',
    tierLegend: 'Greyed prices are not open yet',
    /*
     * D-E19 (founder brief 2026-11-05): the size toggle beside the board
     * toggle — "8 · 16 · 32 · 64", each with its live fill for the board on
     * show, so the toggle doubles as a view of every pool. PHASE-N-REVIEW:
     * draft wording; founder voice.
     */
    sizeAria: 'How many players',
    sizeLabel: 'Players',
    /** The fill under a size: entered / capacity, both the pool's own. */
    fill: (entered: number, capacity: number) => `${entered}/${capacity}`,
    /** Under a size that is switched on with no pool open yet. */
    fillSoon: 'Soon',
    /** Under a size that is not open. */
    fillNone: '—',
    sizeNotOpen: 'Not open yet',
    /** The size and its fill, read out (the toggle's visible text is terse). */
    sizeOptionAria: (capacity: number, fill: string) => `${capacity} players, ${fill}`,
    openNow: 'Open now',
    opensSoon: 'Opens soon',
    opensSoonLine: (mode: 'easy' | 'hard') =>
      mode === 'hard'
        ? 'The hard board is switched on. Its next pool of this size opens shortly.'
        : 'The easy board is switched on. Its next pool of this size opens shortly.',
    closesIn: 'Closes in',
    // D-E19: "Seats" left the card; the box reads players entered / capacity.
    playersLabel: 'Players',
    enterEasy: 'Enter the easy pool',
    enterHard: 'Enter the hard pool',
    bestFor: 'Best for',
    // V3 (founder 2026-09-27, the Example Entry Card sketch): the card says
    // the mode in one line and who it is for; the diagram and the "How it
    // plays" list are gone.
    board: {
      easy: {
        name: 'Easy',
        title: '100 per battle',
        one: 'Seven battles. Every battle gets exactly 100 points to split across your five troops.',
        best: 'Your first entry, or anyone who wants seven even fights.',
      },
      hard: {
        name: 'Hard',
        title: '700 anywhere',
        one: 'Seven battles. One budget of 700 points — stack a battle, leave another with nothing.',
        best: 'Players who know the board and want to choose which battles to win.',
      },
    },
  },

  /*
   * V2 (founder 2026-09-27): every stop on the site — a dead end, a
   * refusal, an error, a failed action — is one card (components/ui/
   * stop-card.tsx) and always offers a way out. These are its shared words.
   */
  stop: {
    kinds: {
      'dead-end': 'Nothing to do here',
      refusal: 'Not this time',
      error: 'Something went wrong',
      failure: 'Did not go through',
    },
    findAnotherPool: 'Find another pool',
    backHome: 'Back to the home page',
    seePools: 'See open pools',
    openWallet: 'Open your wallet',
    tryAgain: 'Try again',
    // The rejection card after a failed entry (founder 2026-09-27): the
    // failure's own sentence (tx/errors.ts) under this title, then the ways
    // out. "Back to this pool" restarts the flow from a fresh read of the
    // pool; nothing landed when it is offered (reveal/machine.ts).
    entryFailedTitle: 'Your entry did not go through',
    backToPool: 'Back to this pool',
    // The 404 page (founder 2026-09-27: designed and branded).
    notFoundTitle: 'That page is not here',
    notFoundLine: 'The link may be old, or the address mistyped.',
  },

  howItWorks: {
    title: 'How it works',
    // Founder wording, 2026-09-09 (replaces "Five stats. One hundred points.
    // Where you put them is the whole game.").
    pentagonCaption: 'Spread Your Skill. Outsmart Your Opponent. Best Strategy Wins.',
    // R7-b (2026-09-12) moved the minimum field 52 -> 40, and step 3 carried
    // the old figure on the LANDING PAGE until 2026-09-16. Like
    // `rules.howToEnter` below, the steps are a function of the shared
    // constants so a number cannot go stale again. D-E19 (2026-11-05): four
    // sizes, each with its own minimum field and paid places, all passed in
    // by the caller from @blotto/scoring. PHASE-N-REVIEW: draft wording for
    // steps 1, 3 and 4; founder voice / counsel.
    steps: (sizes: readonly SizeFacts[]) => [
      {
        title: 'Pick a pool',
        body:
          `Pick an open pool of ${orList(sizes.map((z) => z.capacity))} players and pay the entry. Your character pass is cosmetic art: its look never affects scoring or prizes.`,
      },
      {
        title: 'Set seven battles',
        body:
          // PHASE-N-REVIEW: said "fifteen seconds per screen" (R9); the client
          // runs one ninety-second budget for all seven (R9-b, run-clock.ts),
          // and two other strings already say so. Founder may veto.
          'For each battle, split exactly 100 points across Strength, Speed, Heart, Wit and Durability — or, in a hard pool, place 700 points anywhere across the seven. Three minutes on one clock. Your battles are encrypted on your device before you pay; nobody can read them until the pool closes.',
      },
      {
        title: 'Everyone fights everyone',
        body:
          `When the pool runs — full, or when its clock ends with at least its minimum field (${sizes.map((z) => `${z.minField} of ${z.capacity}`).join(', ')}) — entries are revealed. Your battle one faces every other player’s battle one, and so on through seven. A battle is won by taking three of the five stats.`,
      },
      {
        title: 'The top of the ranking is paid',
        body:
          `Ranking is by battles won, then by stats won. Every pool pays fixed prizes to its highest places (${sizes.map((z) => `${z.paidPlaces} in a pool of ${z.capacity}`).join(', ')}), automatically, and they are funded before entries open. Players tied on a rank share the prizes of the places they occupy.`,
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
    // PHASE-N-REVIEW: Ladder (D-E19) draft wording, pending founder voice and
    // counsel — the study now covers every pool size, full and at its
    // minimum field. The "never placed first" claim is pinned to the data by
    // fair-play.test.ts across all eight fields.
    skillIntro:
      'Two hundred pools were played at every pool size, full and at the smallest field each plays at, with the same scoring engine that pays every real pool. The only thing that differed between the players below was how they split their points across the seven battles; the table shows how often each placed first. A player who leaves every battle on the default even split never placed first — not rarely, never: against any battle that concentrates its points on three stats, an even split takes only the two that were left short, and loses three to two by construction.',
    // The fields the study is measured at: every pool size, full and at its
    // minimum field. Hard-coded until 2026-09-16, when a heading still read
    // "52 seats" over data computed at 40; every number here is a parameter
    // fed from fair-play.config.ts, which derives it from the shared
    // constants. Never "seats" in public copy (D-E19 wording rules).
    skillHeadings: {
      player: 'Player',
      caption: 'How often each player placed first',
      poolSize: (players: number) => `Pool of ${players}`,
      fullGroup: 'Full pool',
      minGroup: 'Smallest field it plays at',
      minField: (players: number) => `${players} players`,
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
    // V3 (founder 2026-09-27): the tiles' group name and short labels.
    tilesLabel: 'Sections of fair play',
    tiles: {
      skill: 'Skill',
      screening: 'Screening',
      age: '18+',
      availability: 'Where',
      randomness: 'Randomness',
      check: 'Check it',
    },
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
      "This pool filled before your entry reached it, so nothing settled. Another pool of this size opens once this one has been paid out.",
    deadlinePassed:
      "This pool stopped taking entries at its deadline before your entry reached it, so nothing settled.",
    /*
     * 2026-09-19 (DRIFT §H18/§H22): the sentence "The even split is the
     * weakest allocation in the game" was REMOVED from both places it
     * appeared, because it is false and it is text a player reads. Measured
     * with the product's own engine over 400 pools of 40: the even split
     * beats arbitrary allocation 400/400, and loses to three-stat play
     * 0/400. It is the MIDDLE of three tiers, not the bottom — deliberate
     * play beats it totally, and careless play loses to it totally.
     *
     * What remains is the part that was always true and is the part a player
     * needs: it loses 3–2 to anyone who concentrates on three stats, so it
     * never beats someone who is thinking. Do not restore the superlative.
     *
     * Wording is an architect proposal; brand voice is founder-owned.
     */
    // 2026-09-09: the two refusals the founder met that read as a network fault.
    alreadyEntered:
      "This wallet has already entered this pool, so nothing settled. One entry per wallet per pool is the rule — your entry is held and your battles are sealed. Check the pool page for your entry.",
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
    // anything is signed (docs/testing/TESTING-REPORT.md, seal lockout). The old
    // wording sent that player to the Rules page's eligibility list, which
    // is the wrong explanation. This one is true for both cases and stays
    // generic (PID §8: the refusal gives no reason). Proposal until ratified.
    entryRefused:
      'This entry was not accepted, so nothing was signed and nothing was charged this time. Trying again will not change the answer. If this wallet already made one attempt at this pool, that attempt is the one that stands \u2014 the pool page shows whether a seat was taken, and you can ask us about your own entry through /complaints.',
    // PHASE-N-REVIEW (2026-09-18, DRIFT.md §H6): split back out of
    // entryRefused. The 2026-09-16 note above folded the ciphertext store's
    // 409 into the eligibility refusal because, at the time, the two really
    // did have the same consequence — one seal per wallet per pool, and a
    // wallet that had sealed could never enter that pool again. That is no
    // longer true: an abandoned attempt can now be replaced
    // (backend/packet/src/seats.ts), so a 409 here means an attempt from
    // this wallet is SETTLED or the pool has stopped taking entries — not
    // that the player is ineligible. Sending them to the Rules page's
    // eligibility list was the wrong explanation then and is a false one
    // now. Stays generic (PID §8: the service gives no reason) and names no
    // cause it cannot be sure of. Architect proposal until the founder
    // ratifies the wording.
    sealConflict:
      'This attempt did not go through, and nothing was signed or charged this time. It was not a decision about you: either an earlier attempt from this wallet at this pool is the one that stands, or the pool stopped taking entries first. The pool page shows whether a seat was taken, and you can ask us about your own entry through /complaints.',
  },
  battle: {
    // V3 (founder 2026-09-27): ONE key — a full board's own key says
    // "Confirm, Sign & Seal" and seals straight from the board; the review
    // (an early submit, or the buzzer) ends in the same key. The two-step
    // arm-then-confirm of v3 D2 is gone; §8.6 renders above the key.
    // "Allocation" left every player-facing line.
    seal: 'Confirm, Sign & Seal',
    sealing: 'Sealing your battles…',
    /*
     * The stat names are NOT here: they are `STAT_NAMES` in
     * `battle/allocation.ts` and have exactly one definition on the client —
     * the fixed stat order the encoding depends on, not decoration. (This
     * block once also refused a points-remaining counter under PID §4.2,
     * audit A-29; the board shows what is left by the founder's ruling of
     * 2026-09-24, register D-E17, and that override is recorded there.)
     */
    backSheetLine: 'Leaving locks nothing and loses nothing — your clock keeps running.',
    backStay: 'Stay',
    backLeave: 'Leave',
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
  /*
   * THE BATTLE BOARD (founder brief 2026-09-24): the map that replaces the
   * dials — seven fields, five troops, press-and-hold to send points, a
   * stepper for steps, lock-in per field, one three-minute clock. Two modes:
   * easy (100 points in each battle — the rule the platform has always
   * played) and hard (700 points anywhere across the seven; its pool lands
   * in Phase B). PHASE-N-REVIEW: every line here is a draft; the founder
   * owns the words. Vocabulary ruled 2026-09-24 (5.4): troop, crowd,
   * field, points.
   *
   * PID §4.2 said the player never sees a points-remaining counter, and
   * audit A-29 removed one on that basis (see the note in `battle` above).
   * The founder's ruling of 2026-09-24 (5.3) asks for exactly that readout
   * in both modes — per field in easy, one total in hard. PHASE-N-REVIEW:
   * the ruling supersedes §4.2's sentence; recorded in
   * docs/architecture/ARCHITECTURE.md for the PID reissue.
   */
  board: {
    modeEasy: 'Easy · 100 per battle',
    modeHard: 'Hard · 700 anywhere',
    mapLabel: 'The battle board: seven fields around a castle',
    field: (n: number) => `Field ${n}`,
    chipEasy: (placed: number, left: number) => `${placed} placed · ${left} left`,
    chipHard: (placed: number) => `${placed} placed`,
    chipFull: '100 · Full',
    chipLocked: (placed: number) => `Locked · ${placed}`,
    chipAria: (n: number, line: string, locked: boolean) =>
      `Field ${n}: ${line}${locked ? ', locked in' : ''}. Opens the stepper.`,
    fieldAria: (n: number, troop: string | null, locked: boolean) =>
      locked
        ? `Field ${n} is locked in`
        : troop
          ? `Field ${n}. Press and hold, or press Enter, to send ${troop} here`
          : `Field ${n}. Pick a troop first`,
    trayLabel: 'Troops. Tap a card, then press and hold on a field.',
    troopPlaced: (n: number) => `${n} placed`,
    // Plaques (the mockup's field signs): name, the big line, the small line.
    plaqueFull: 'Full',
    plaqueLeft: (n: number) => `${n} left`,
    plaquePlaced: (n: number) => `${n} placed`,
    plaqueLocked: 'Locked in',
    toastFull: (n: number) => `Field ${n} is full`,
    toastPick: 'Pick a troop from the tray first',
    zoomLabel: 'Zoom',
    zoomReset: 'Reset zoom to 100%',
    // The hint line: always the NEXT action, in one sentence (the mockup's words).
    // Grab mode (founder 2026-09-24, second pass): the hand key. With it on
    // the board only moves under the finger, and a tap on a field opens the
    // stepper for the troop in hand — no disarming the tray to get at the keys.
    grab: 'Grab',
    grabAria: 'Grab mode: drag to move around, tap a field for its numbers',
    hintGrab: (troop: string | null) =>
      troop
        ? `Grab mode. Drag to move around; tap a field to set its ${troop} in steps. Tap a troop card to deploy again.`
        : 'Grab mode. Drag to move around; tap a field to pick a troop and set it in steps.',
    hintPick: 'Tap a troop, then press and hold on a field',
    hintHold: (troop: string) => `Press and hold on a field to send ${troop} there. Hold longer for more. Tap a plaque or a crowd’s number for steps.`,
    hintHoldHard: (troop: string, left: number) => `Press and hold on a field to send ${troop} there. ${left} points left to place.`,
    hintDeploying: (troop: string, n: number) => `Deploying ${troop} on Field ${n}…`,
    hintLastSeconds: 'Ten seconds. Anything unplaced spreads evenly across the fields you have not locked in.',
    // The clock (founder 2.3): the rule is said before the first touch.
    timerHeld: 'Starts on your first point',
    timerHeldAria: 'The clock starts when you place your first point',
    timeLeft: 'Time left',
    timerAria: (clock: string) => `${clock} remaining`,
    // V5 (founder 2026-09-30): the column beside the board — the rules,
    // the statements, the seal key.
    railLabel: 'How this pool plays, and the seal',
    bannerTitle: 'The clock starts when you place your first point',
    bannerEasy: 'Three minutes for all seven battles. Each battle takes 100 points, split across your five troops however you like.',
    bannerHard: 'Three minutes. 700 points to place anywhere across the seven battles — all in one, spread across all seven, or anything between.',
    bannerLooking: 'Look around, pick a troop, zoom in — none of that starts it.',
    bannerGo: 'Take the field',
    readoutEasy: (full: number, locked: number) => `${full} / 7 battles full${locked ? ` · ${locked} locked in` : ''}`,
    readoutHard: (left: number, locked: number) => `Left to place  ${left} / 700${locked ? ` · ${locked} locked in` : ''}`,
    leave: '← Leave',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit',
    // The stepper.
    stepperTitle: (troop: string, n: number) => `${troop} on Field ${n}`,
    pickTroopTitle: (n: number) => `Which troop for Field ${n}?`,
    leftHere: (n: number) => `${n} left on this field`,
    leftToPlace: (n: number) => `${n} left to place`,
    stepAria: (delta: number, troop: string, n: number) =>
      `${delta > 0 ? 'Add' : 'Take back'} ${Math.abs(delta)} ${troop} ${delta > 0 ? 'to' : 'from'} Field ${n}`,
    fillField: (troop: string) => `Fill with ${troop}`,
    sendBack: (troop: string) => `Send ${troop} back`,
    lock: (n: number) => `Lock in Field ${n}`,
    unlock: (n: number) => `Unlock Field ${n}`,
    lockedHint: (n: number) => `Field ${n} is locked in. It will not change, and the buzzer will not touch it.`,
    lockNeedsFull: 'A field locks in once it is full.',
    lockNeedsPlaced: (left: number) => `Place your remaining ${left} points first — this is the last open field.`,
    close: 'Close',
    // V4 (founder 2026-09-27): the seal key sits beside the troops from the
    // first moment, greyed until every field is full; the landing demo's
    // says this instead of the seal words, since nothing signs there.
    submitComplete: 'Submit my board',
    sealLocked: 'Allocate all blotts first',
    /*
     * V2 (founder 2026-09-27; the co-founder's board): bulk clearing, Undo,
     * and the nine-step walkthrough with the clock held. PHASE-N-REVIEW:
     * drafts; the founder owns the words. The walkthrough's minutes come
     * from the board's clock constant, never typed.
     */
    undo: 'Undo',
    undoAria: 'Undo the last change — a whole hold, a step, or a clear',
    clearField: (n: number) => `Clear Field ${n}`,
    clearBoardAria: 'Send every troop back to the tray',
    clearBoardConfirm: 'Send every troop back?',
    yes: 'Yes',
    no: 'No',
    guideKey: 'Show me how first',
    guideStep: (n: number, of: number) => `Step ${n} of ${of}`,
    guideNext: 'Next',
    guideBack: 'Back',
    guideSkip: 'Skip',
    guideStart: 'Start building',
    guideWaiting: 'Your move…',
    guide: (mode: 'easy' | 'hard', minutes: number): readonly { title: string; body: string; waits: boolean }[] => [
      {
        title: 'Seven fields, seven battles',
        body:
          mode === 'easy'
            ? 'Each field around the castle is one battle, and every battle takes 100 points. Set all seven, then submit.'
            : 'Each field around the castle is one battle. You have 700 points to place across the seven — all in one, spread across all, or anything between.',
        waits: false,
      },
      {
        title: mode === 'easy' ? '100 points per field' : '700 points across the board',
        body:
          mode === 'easy'
            ? 'Field 1’s plaque counts what you have placed there, out of 100. Every field has one.'
            : 'The readout at the top counts what is left of your 700. A field’s plaque counts what stands on it.',
        waits: false,
      },
      { title: 'Your troops are your stats', body: 'Tap one of the five cards below to arm it.', waits: true },
      {
        title: 'Press and hold to send them',
        body: 'Press and hold on Field 1. Hold longer for more, tap for one, slide off to pause. The clock does not run during this walkthrough.',
        waits: true,
      },
      {
        title: 'Every troop is a point',
        body:
          mode === 'easy'
            ? 'The chip counts this stat; the plaque counts the whole field out of 100. A full field takes no more troops.'
            : 'The chip counts this stat; the readout counts the whole board out of 700. When it reads 0 left, the board is placed.',
        waits: false,
      },
      { title: 'Change your mind', body: 'Tap the number above the crowd to open its controls.', waits: true },
      {
        title: 'Send some back',
        body: 'Take one back with −1, five with −5, or the whole crowd with Send back. Clear Field empties the field. Undo takes back a whole hold.',
        waits: true,
      },
      {
        title: 'The clock',
        body: `${minutes} minutes from your first troop. At the buzzer the board is submitted as it stands, and points you never placed are spread evenly across the stats of the fields you have not locked in. A spread-thin field loses to a focused one, so fill every field yourself.`,
        waits: false,
      },
      {
        title: 'Submit',
        body:
          mode === 'easy'
            ? 'When every plaque reads Full, submit. Your entry is encrypted on your device before you pay; nobody can read it until the pool closes. Once submitted it is final.'
            : 'When the readout reads 0 left, submit. Your entry is encrypted on your device before you pay; nobody can read it until the pool closes. Once submitted it is final.',
        waits: false,
      },
    ],
    // Review.
    reviewTitle: 'Your entry',
    reviewSubmitted: (clock: string) => `Submitted with ${clock} left. Decisions are final once sealed.`,
    reviewExpired: 'Time ran out. Whatever was on the board is your entry; anything unplaced was spread evenly across the fields you had not locked in.',
    checkEasy: (per: number) => `7 battles · every battle sums to exactly ${per}`,
    checkHard: (total: number) => `7 battles · ${total} points placed`,
    reviewTableLabel: 'Your seven battles, five stats each',
    reviewBattle: 'Battle',
    reviewTotal: 'Total',
    backToBoard: 'Back to board',
    demoAgain: 'Try again',
  },
  welcome: {
    teamName: 'The Blotto Cup team',
    greeting: 'Welcome to Blotto Cup.',
    paragraphs: [
      "We're the Blotto Cup team. Thank you for joining — we mean that.",
      // D-E19 (2026-11-05). PHASE-N-REVIEW: draft wording; founder voice / counsel.
      'Blotto Cup is a competition of judgement: seven sealed battles, five stats in each — 100 points a battle on the easy board, or 700 placed anywhere on the hard board — and the highest places in every pool are paid fixed prizes. Nothing is decided at random, and every result can be recomputed by anyone from published data.',
      'Pick a pool, make your seven, seal them, and check back when it has played. If anything is unclear, the rules page says it plainly.',
    ],
    justNow: 'Just now',
    dismiss: 'Close',
    cta: 'Find a pool',
  },
  // v3 D3: retention surfaces — mastery and standing only. Factual state
  // changes, never pressure; the do-not-build vocabulary is CI-enforced.
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
    sealed: (id: string) => `Pool #${id} sealed — battles are being revealed`,
    scored: (id: string) => `Pool #${id}: results are committed`,
    paid: (id: string) => `Pool #${id}: prizes are paid`,
    // PHASE-N-REVIEW (founder 2026-09-17, round four A2: "if a wallet has won
    // a prize, there should be a celebration moment when they open the
    // notification"). A Paid pool that paid THIS wallet reads as the win it
    // is — the list line, the toast, and the headline at the top of the
    // sheet. The amount is the chain's (career row, bigint → string).
    // D-E19: a prize is any paid place now, so the line names the prize, not
    // a win. PHASE-N-REVIEW: draft wording; founder voice.
    won: (id: string, sol: string) => `Pool #${id}: your prize of ${sol} SOL is paid`,
    refunding: (id: string) => `Pool #${id} did not reach its minimum field — refunds are open`,
    /*
     * THE TABLE (V2, founder 2026-09-27, sketch G): the sheet is a clip over
     * a table — Pool, Position, Date, the way to the results — a win in
     * gold, and "New" on a row whose results this device has not opened.
     * The date is the day the pool closed to entries (its fill deadline,
     * the pool record's one clock). Position is the verified archive's rank
     * where there is one; before that the state says what is happening.
     * The Congratulations box and its confetti left with this.
     */
    tableAria: 'Your pools',
    colPool: 'Pool',
    colPosition: 'Position',
    colDate: 'Date',
    viewResults: 'View results',
    viewPool: 'View pool',
    newTag: 'New',
    // D-E19: place-based — "1st", "11th" — and a paid finish with no
    // verified rank yet says it was a paid place, not "Winner" (any of a
    // pool's top places is paid now). PHASE-N-REVIEW: draft wording.
    positionRank: (rank: number) => place(rank),
    positionPaid: 'Paid place',
    positionSealed: 'Revealing',
    positionRefund: 'Refund',
    positionPending: '—',
  },
  beatYou: {
    title: 'What finished above you',
    // 2026-09-16: the panel reads the published battle set and checks each
    // seat against its on-chain fingerprint; it no longer opens sealed
    // boxes. PHASE-N-REVIEW: wording is a proposal pending the founder's voice.
    note: 'Re-scored in your browser from the published battle set, each entry checked against its on-chain fingerprint. Entry numbers only — no names.',
    // V4 (founder 2026-09-27): YOUR record against that seat, said as
    // yours — "against you" read as if the winner had lost to you.
    headToHead: (w: number, d: number, l: number) => `You ${w}W · ${d}D · ${l}L`,
    unavailable:
      'The sealed battles for this pool are not available to decrypt yet. The Verify page recomputes the full result from the published bundle.',
  },
  results: {
    // PHASE-N-REVIEW (round four A2, 2026-09-17): the results page is titled
    // like the pool page — "Pool #N" on the marquee, this word on the chip
    // beside it and on the box the payout list sits in.
    title: 'Results',
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
      // D-E19: an upheld flag no longer passes a share straight on — in a
      // pool that pays several places it is held in the pool's vault until
      // it is paid on. PHASE-N-REVIEW: draft wording; founder voice / counsel.
      note:
        'A flag against your entry was upheld and your prize was withheld: it stays in this pool\u2019s prize vault and is paid on to other players of this pool, never to the operator. You can challenge that decision here. A person reads it, decides it against the published criteria, and the decision and the criterion cited are recorded. If a challenge succeeds after the prize has gone to another player, we pay you the full prize ourselves.',
    },
    /*
     * YOUR RESULT (V2, founder 2026-09-27: "player-first"; your-result.tsx).
     * Position out of the verified field, battles won, the three keys, the
     * replay, and the way to tell us. The denominator here IS the archive's
     * row count — the field this pool actually played with, never a typed
     * number. PHASE-N-REVIEW: drafts; the founder owns the words.
     */
    yourResult: {
      title: 'Your result',
      positionLabel: 'Position',
      // D-E19: place-based ("11th of 26"). PHASE-N-REVIEW: draft wording.
      position: (rank: number, of: number) => `${place(rank)} of ${of}`,
      battlesWon: 'Battles won',
      // V4: of every battle this player fought — seven against each of
      // the other seats in the verified field.
      battlesWonOf: (label: string, fought: number) => `${label} of ${fought}`,
      // D-E19: every paid place shows its own amount (the archive's
      // committed leaf), and an unpaid finish is said once, factually — no
      // near-miss styling, no animation (founder brief 2026-11-05).
      // PHASE-N-REVIEW: draft wording; founder voice.
      paid: (sol: string) => `Prize paid to your wallet: ${sol} SOL`,
      held: 'Your prize is held while a flag is reviewed.',
      unpaid: (rank: number, of: number, lastPaid: number) =>
        lastPaid === 1
          ? `You finished ${place(rank)} of ${of}. The prize was paid to 1st place.`
          : `You finished ${place(rank)} of ${of}. Prizes were paid to 1st–${place(lastPaid)}.`,
      leaderboard: 'See full leaderboard',
      verify: 'Verify pool',
      verifyWhat: 'What does verifying do?',
      verifyExplainer:
        'Verifying recomputes this whole result in your own browser: it fetches the published battles and the revealed pool secret, re-scores every player against every other, rebuilds the results tree and compares it to what the chain holds. Every number on this page can be reached that way. Nothing asks for trust.',
      shareX: 'Share on X',
      shareText: (rank: number, poolId: string) =>
        `I finished ${place(rank)} in Blotto Cup pool #${poolId}. Seven sealed battles, every result recomputable by anyone. blotto.gg`,
      // The replay: your seven battles against one opponent, fought on
      // screen from the published battles. Named by rank, never by wallet.
      replayTitle: (opponent: string) => `Your seven battles against ${opponent}`,
      // D-E19: several places are paid, so first place is named by place.
      replayWinner: 'first place',
      replayRank: (rank: number) => place(rank),
      replayPlay: 'Play the replay',
      replaySkip: 'Skip to the result',
      replayAgain: 'Watch again',
      replayMarch: 'March…',
      replayLoading: 'Reading the published battles…',
      replayUnavailable:
        'The published battles could not be read just now, so there is nothing to replay. The Verify page fetches the same file.',
      replayBattle: (n: number) => `Battle ${n}`,
      replayYou: 'You',
      replayWon: 'Won',
      replayLost: 'Lost',
      replayDrawn: 'Drawn',
      replayTally: (won: number, lost: number, drawn: number) => `Won ${won} · Lost ${lost} · Drawn ${drawn}`,
      replayAhead: 'you came out ahead',
      replayBehind: 'they came out ahead',
      replayLevel: 'dead level',
      replayByStats: '(level on battles; stats won decide)',
      feedback: 'Something look wrong? Tell us. A person reads every message.',
      feedbackLink: 'Send a message',
    },
    // No denominator: a pool runs with anything from its minimum field to its
    // capacity (D-E19), and the career row does not carry its field size.
    rank: (r: number) => `Ranked ${place(r)}`,
    // SUBSTANCE FIXED (D3-B, ratified 2026-08-27; substance amended by
    // D-E19, 2026-11-04 — the top places paid on a fixed table, superseding
    // D-E2's one place): the split-pot tie rule, across the paid line too.
    // PHASE-N-REVIEW: draft wording; founder voice / counsel.
    tieNote:
      'Tied players \u2014 equal on battles won and on stats won \u2014 share a rank, and share equally the prizes of the places they occupy together, an indivisible remainder of a few lamports to the eligible player with the lowest entry number. A tie that reaches past the last paid place shares the prizes of the paid places it covers between everyone in it. The full ranking with tie labels is recomputable on the Verify page from the published data.',
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
      // D-E19: every paid place is listed, not only the first, and the
      // table draws the paid line. PHASE-N-REVIEW: draft wording.
      paidTitle: 'Prizes paid',
      paidRow: (rank: number, playerShort: string, amountSol: string) =>
        `${place(rank)} · ${playerShort} — ${amountSol} SOL`,
      paidLine: (lastPaid: number) =>
        lastPaid === 1 ? 'The prize was paid to 1st place.' : `Prizes were paid to 1st–${place(lastPaid)}.`,
      // D-E19 sweep: the column is the entry number; "seat" left the public copy.
      seat: 'Entry',
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
      seat: 'Entry',
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
   * backend/detection/src/complaint-windows.ts), for the reason every number on a
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
   * docs/compliance/PRODUCT-FACTS.md. Exported through here so the one-place rule holds and
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
    poolLabel: 'Which pool (optional)',
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
    // V3 (founder 2026-09-27): "Profile", one dashboard.
    title: 'Profile',
    lifetime: 'Lifetime record',
    poolsEntered: 'Pools entered',
    prizeFinishes: 'Prize finishes',
    totalPrizes: 'Total prizes',
    readOnlyNote: 'Profiles are a read-only record. Nothing here affects any pool.',
    signInFirst: 'Sign in to see your record.',
    signInFirstLine: 'Your career — every pool entered, every paid finish — is built from on-chain data for the wallet you sign in with.',
    emptyTitle: 'No entries yet.',
    emptyLine: 'Your first pool starts your record — the open pools are on the home page.',
    /*
     * V3 (founder 2026-09-27): the previous finishes as a table in the
     * notifications sheet's style (its column words are `notify.*`), and a
     * pool opens a card with how the player played it — their own seven
     * battles from the published bundle. PHASE-N-REVIEW: drafts; founder
     * may re-voice.
     */
    finishes: {
      title: 'Previous finishes',
      tableAria: 'Your previous pools',
      empty: 'Your finishes appear here from your first pool.',
      openAria: (id: string) => `How you played pool #${id}`,
      matrixKicker: 'How you played',
      matrixLoading: 'Reading the published data…',
      matrixUnpublished: 'Your battles for this pool are shown once the pool has been revealed and its published data verified.',
      matrixMissing: 'Your battles for this pool are not in the published data.',
      matrixFailed: 'The published data could not be read just now. The results page fetches the same file.',
      matrixAria: (id: string) => `Your seven battles in pool #${id}`,
    },
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
          'Move money. No admin instruction transfers a lamport \u2014 an upheld flag leaves the prize in the pool\u2019s own vault for the next eligible player; pausing never blocks settlement or refunds.',
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
        can: 'Open the next pool of a tier once the previous one has paid out or closed and the tier\u2019s cooldown has passed. Nobody else can open a pool, however long a tier sits idle: if the keeper stops, no new pool opens and no money is at risk — sealing and refunding a pool that is already running stay open to anyone, and the admin can rotate the keeper at any time.',
        cannot: 'Enter a pool, move money, or decide when a pool runs \u2014 the number of players entered and the clock do.',
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
          'Choose amounts or recipients, or enter a pool. The program checks every payout list against the prize pool and the recorded entries, and every onward payment against the committed results; a wrong list is rejected on-chain.',
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
        can: 'Hold pass-sale revenue, fund each pool\u2019s fixed prize pool before entries open, and pay refunds. The one exit is a multisig-approved withdrawal, and the program blocks any withdrawal that would dip below the published floor: the minimum balance, one further prize pool per idle tier, and every entry payment that could still be refunded.',
        cannot: 'Pay anyone directly, skim an open pool, or touch the refundable entry payments \u2014 the floor is enforced by the program, not by policy.',
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
    // The success screen's heading (entered-panel.tsx).
    sealedTitle: 'Sealed',
    rarityNames: ['Common', 'Uncommon', 'Rare', 'Epic', 'Mythic'] as const,
    rarityCounts: [38, 15, 7, 3, 1] as const,
    // D-E19: a pool holds 8 to 64 players, but every pass is still drawn
    // from the one published bag (LAUNCH_CLASS_COUNTERS), whose size is the
    // sum of the counts above — never a typed figure. PHASE-N-REVIEW: draft
    // wording; founder voice.
    rarityOf: (count: number) =>
      `${count} in the same mix of ${[38, 15, 7, 3, 1].reduce((a, b) => a + b, 0)} that every pass is drawn from`,
    // The pass's line on the success screen (entered-panel.tsx): the entry
    // number out of the POOL's own size (D-E19), never a typed 64.
    // PHASE-N-REVIEW: draft wording; founder voice.
    cardEntry: (n: number, capacity: number) => `Entry ${n + 1} of ${capacity}`,
    /*
     * The pass as a SHAREABLE card (2026-09-13). This replaces the share
     * that used to sit on the review screen BEFORE sealing: that one handed
     * the player a picture of their seven Blotts, and a Blott's silhouette is
     * a deterministic function of its five stats (components/blot/blotGeometry.ts)
     * — so the image was the sealed allocation, readable, offered for
     * publication while the pool was still open. The pass carries the seat
     * and the pool number: public, nothing sealed — and since 2026-09-15 not
     * the drawn class either (founder 2026-09-14: the rarity assignment is
     * not broadcast to players).
     * PHASE-N-REVIEW: drafts; the founder owns the words.
     */
    passEntered: "I'm in.",
    passPool: (n: string | number) => `Pool #${n}`,
    /*
     * The signing hold (V2, founder 2026-09-27; signing-overlay.tsx): the
     * whole screen from the one seal press until the network answers — a
     * graphic and one sentence, no hash. Three sentences for the three steps
     * the page can observe: the sealed entry not yet signed, the payment not
     * yet signed, the chain confirming. PHASE-N-REVIEW: drafts.
     */
    signingTitle: 'Sealing your entry',
    // V5 (founder 2026-09-30): the statements' signature, first, for a
    // wallet not yet on record — free, and it moves nothing.
    signingAttest: 'First, your wallet signs the two statements you confirmed. Signing them is free and moves nothing.',
    signingSeal: 'Approve the first prompt in your wallet — it signs your sealed entry.',
    signingPay: 'Now the payment. Approve it in your wallet.',
    // The waiting beat, between the signatures and the chain's answer. It
    // replaced the egg's "keep tapping, or simply wait" (2026-09-15).
    confirming: 'Confirming your entry with the network. Nothing more is needed from you.',
    // V3 (founder 2026-09-27): the founder's own line. Text only — the
    // pass PNG that used to download beside it is gone ("looks like a
    // virus"), and so is the note that explained it.
    // D-E19: "The winner takes the prize pool" went with one-place pools.
    // PHASE-N-REVIEW: draft wording; founder voice / counsel.
    passShareText: (n: string | number) =>
      `I'm in Blotto Cup pool #${n} on blotto.gg. Seven sealed battlefields, everyone plays everyone, fixed prizes for the top of the ranking. Come and join me!`,
    passShareX: 'Post on X',
    // Founder 2026-09-27: the success screen's way onward is another pool.
    playAgain: 'Play again',
    stalledTitle: 'Still confirming',
    stalled:
      'Confirmation is taking longer than usual. Your entry is submitted and nothing further is needed — results appear on the pool page once the network confirms.',
    stalledDismiss: 'Back to the pool',
  },
  /*
   * THE SHARE CARD (app/card/[pool]/[player]/route.tsx). D-E19: "seat N of
   * 64" became the finish and the field — "3rd of 32 players" — from the
   * verified archive; before it verifies, the field alone. Three literals
   * that lived in the route moved here. PHASE-N-REVIEW: draft wording.
   */
  card: {
    finish: (rank: number, field: number) => `${place(rank)} of ${field} players`,
    field: (field: number) => `${field} players`,
    entered: 'Entered',
    recomputable: 'Every result recomputable from published data',
  },
  /*
   * PRIZES BY PLACE (D-E19, the Ladder; founder brief 2026-11-05). The
   * words around a pool's fixed table. The AMOUNTS are never here: they are
   * the pool's own (`poolLadder`) or LADDER_TABLES × the entry price, formatted
   * to SOL by the caller; the grouping into rows and runs is
   * data/prizes.ts. Copy rules: a pool is described by players and
   * prizes; never a multiple of the entry, never a percentage paid, never
   * "pot", "seat", "cash", "winner takes".
   * PHASE-N-REVIEW: draft wording; founder voice / counsel.
   */
  prizes: {
    place,
    /** A band's place label: "1st", "5th–8th". */
    band: (from: number, to: number) => (from === to ? place(from) : `${place(from)}–${place(to)}`),
    amount: (sol: string) => `${sol} SOL`,
    each: 'each',
    colPlace: 'Place',
    colPrize: 'Prize',
    tableLabel: (capacity: number) => `Prizes in a pool of ${capacity} players`,
    total: 'All prizes',
    /** "16 players · 4 prizes · 1st 0.5 SOL" — how a pool is described. */
    summary: (capacity: number, places: number, firstSol: string) =>
      `${capacity} players \u00b7 ${places} ${places === 1 ? 'prize' : 'prizes'} \u00b7 1st ${firstSol} SOL`,
    /** "16 players" — a size whose table this surface does not hold. */
    players: (capacity: number) => `${capacity} players`,
    /**
     * The founder's prize sentence: "The prizes are fixed and funded before
     * entries open. 1st 0.8 SOL, 2nd 0.4 SOL, 3rd and 4th 0.2 SOL each, 5th
     * to 8th 0.1 SOL each." Runs of equal places come from data/prizes.ts.
     */
    sentence: (runs: readonly PrizeRunText[]) =>
      `The prizes are fixed and funded before entries open. ${runs
        .map((r) =>
          r.from === r.to
            ? `${place(r.from)} ${r.sol} SOL`
            : `${place(r.from)} ${r.to === r.from + 1 ? 'and' : 'to'} ${place(r.to)} ${r.sol} SOL each`
        )
        .join(', ')}.`,
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
    // constants (rules.config passes the pool sizes, their minimum fields
    // and the board clock) — the D-B6 rule that no figure on this page is
    // hand-typed.
    // D-E19 (2026-11-05): the pool sizes and their floors come in from
    // rules.config.ts (POOL_CAPACITIES / MIN_FIELD_BY_CAPACITY), never typed.
    // "Every winning wallet" became every wallet due a prize: several places
    // are paid. PHASE-N-REVIEW: draft wording; founder voice / counsel.
    howToEnter: (sizes: readonly SizeFacts[], boardMinutes: number) =>
      `Sign in, pick an open pool, and confirm the 18+ and terms statements — your wallet signs that confirmation once per terms version. Pay the entry price for the tier. Before an entry is accepted, your wallet is checked against published sanctions lists; every wallet due a prize is checked again before payment. You then set seven battles on one ${boardMinutes}-minute clock, which starts when you place your first point: in an easy pool each battle splits 100 points across five stats; in a hard pool you place 700 points anywhere across the seven battles, every stat between 0 and 700, and the pool's page says which rule it plays. Your battles are encrypted on your device before any payment moves. One entry per wallet per pool; there is no limit across pools. The keys that run the service — the admin, the keeper, the entry signer and the settlement signer — can never enter. A pool holds ${orList(sizes.map((z) => z.capacity))} players and runs with at least its minimum field (see the field-size rule). Decisions are final: a submitted entry cannot be changed or withdrawn (see the refund rule for pools that never reach their minimum field).`,
    // PHASE-N-REVIEW: draft wording (D-E19); founder voice / counsel.
    priceIntro: (cooldownMinutes: number) =>
      `Seven entry prices (tiers) are configured. A tier must be switched on by the operator before pools open in it; at launch only the smallest tier is on. In each tier, pools come in four sizes on each board, and one pool of each size and board is open at a time; a new one opens ${cooldownMinutes} minutes after the previous one has paid out or closed.`,
    // D-E19 (founder ruling 2026-11-04, superseding D-E2's one paid place):
    // the highest places are paid on a fixed table per size. No percentage,
    // no multiple — the tables below this text are SOL, generated from
    // LADDER_TABLES × the entry price (rules.config.ts).
    // PHASE-N-REVIEW: draft wording; founder voice / counsel.
    prizeIntro:
      'Every pool pays fixed prizes to its highest places, from a table set by the pool\u2019s size and entry price \u2014 never by how many players entered. The prizes are moved into the pool\u2019s own prize vault from the prize treasury before entries open, and they are the same whatever size the field turns out to be. The tables below give every prize, by pool size and entry price. Players tied on a rank share the prizes of the places they occupy (see ties). Prizes are paid automatically when results are committed; there is no claim step.',
    /** The heading over one size's table (D-E19). */
    prizeTableHeading: (z: SizeFacts) =>
      `${z.capacity} players \u00b7 ${z.paidPlaces} ${z.paidPlaces === 1 ? 'prize' : 'prizes'} \u00b7 minimum field ${z.minField}`,
    // SUBSTANCE FIXED (D3-B): identical-field scoring, exactly as the engine
    // implements it (backend/scoring/src/engine.ts). The timer rule has its
    // own section (battleTimer — R9-b).
    scoring:
      'Every player faces the identical field: your battle 1 is compared against every other entry\u2019s battle 1, and so on for all seven. A battle is won by taking three or more of its five stats; if neither side takes three, it is a draw worth half a win to each. Rankings are ordered by total battles won (a draw counts half), then by total stats won across every comparison. The ordering is fully deterministic: the same sealed battles always produce the same ranking.',
    // R9-b (founder addendum 2026-09-07): the battle timer, the founder's
    // wording verbatim — the rule, then its effect stated as how the
    // allocation performs, never as a chance of anything.
    // Rewritten 2026-09-26 for the board (app/src/battle/board/spread.ts):
    // one clock, and the spread of unplaced points per mode. The even
    // split's three-to-two loss holds in both modes.
    // PHASE-N-REVIEW: the operator owns the final wording.
    battleTimer:
      'One clock runs for the whole board. It starts when you place your first point. When you submit, or when the clock ends, any points you have not placed are spread evenly across the stats of every battle you have not locked in: in an easy pool each battle spreads its own unplaced points across its five stats, so a battle you never touch is entered as 20 points in each; in a hard pool the board\u2019s unplaced points are spread across every stat of every unlocked battle. Against any allocation that concentrates points on three stats, an even split loses that battle three stats to two, every time \u2014 so it never beats a player who is thinking. Nothing is decided at random: the spread is fixed and published, and leaving points unplaced is a decision like any other. After an early submit you see the result and can go back while time remains; when the clock ends, the board is final.',
    // SUBSTANCE FIXED (D3-B; D-E19 superseding D-E2; the founder's addendum
    // of 2026-09-07, rulings 2 and 3): ranking, ties — including a tie that
    // straddles the paid line — and where a forfeited share goes: always to
    // players, never to us.
    //
    // PHASE-N-REVIEW: the forfeiture sentence is the brief's draft of
    // 2026-11-05; counsel approves the final wording. It states the
    // destination ("paid on to other players of the same pool"); until the
    // field-moves-up instructions ship, a forfeited share in a pool that
    // pays several places is HELD in its vault (pay_next_place refuses with
    // NextPlaceUnsupported), so "is paid on" describes where it goes, not
    // that it has already moved.
    ties:
      'Players are ranked by battles won, then by total stats won. Players who remain equal on both share a rank. Entry order plays no part in ranking or in deciding who is paid. It determines only where an indivisible remainder of a few lamports falls when a prize cannot be divided exactly. Your entry number is recorded when you enter and is visible to you before the pool closes. No random process is used at any stage of ranking or payment. ' +
      'Players who share a rank share equally the prizes of the places they occupy together: two players tied for 3rd are each paid half of the 3rd and 4th prizes combined. A tie that reaches past the last paid place is treated the same way \u2014 the prizes of the paid places it covers are divided equally between everyone in the tie, so each of them is paid a share even though some of the places they occupy pay nothing. Nobody ranked below the last paid place, and outside such a tie, is paid. ' +
      'If a flag is upheld, the withheld prize stays in the pool\u2019s prize vault and is paid on to other players of the same pool; it never goes to the operator. Any indivisible remainder goes to the eligible player with the lowest entry number. ' +
      'A prize is always paid to a player. It is never returned to us. ' +
      'Where more than one player shares the rank a prize passes to, we identify that group. The published rule is that they share equally, with any remainder going to the lowest entry number. The results bundle we publish after every pool lets anyone check that we identified the group correctly.',
    // SUBSTANCE FIXED: randomness scope (PID §8.3/§8.4).
    randomness:
      'Randomness from a recent slot hash, mixed with your entry\u2019s position in the pool, the pool and your wallet\u2019s key, decides ONE thing: which character class artwork your pass shows. Class is cosmetic. It does not affect any stat, any battle, any score, any rank, or any prize \u2014 nothing in the scoring path reads it. Scoring and prizes depend only on the sealed battles every player submitted. Every class draw is replayable from published on-chain data.',
    // SUBSTANCE FIXED: the sealing lifecycle (TECH-ARCH §5), the founder's
    // addendum wording of 2026-09-07 (ruling 5) — the key is generated and
    // held by our systems, export-locked; said plainly.
    sealing:
      'Your battles are encrypted on your device before they are submitted. The key that can decrypt them is generated and held by our systems, locked against export, and is not released until the pool closes and no further entry is possible. Until that moment no battle in the pool can be read, by us or by anyone else. A hash of your battles is recorded on-chain at entry. When the pool runs, the pool secret is published on-chain: at that moment everyone\u2019s battles become readable and checkable against the hashes committed at entry, and anyone can re-run the scoring.',
    // D-E4 (ratified 2026-09-06; option A per the founder's ruling of
    // 2026-09-07): the minimum field and the ONE clock, 12 hours at launch.
    // SUBSTANCE FIXED: the seat count and the clock decide when a pool runs
    // \u2014 never the operator; the start and the refund are both permissionless.
    // D-E19: one minimum field per size, each the break-even field for its
    // table, carried by the pool from its open (Pool.min_seats). The sizes
    // and floors come from the caller. PHASE-N-REVIEW: draft wording.
    fieldSize: (sizes: readonly SizeFacts[], fillHours: number) =>
      `A pool holds ${orList(sizes.map((z) => z.capacity))} players, and each size has its own minimum field: ${sizes.map((z) => `${z.minField} players in a pool of ${z.capacity}`).join(', ')}. Entries stay open for up to ${fillHours} hours from the moment the pool opens. The pool runs the moment it is full, or when the ${fillHours} hours end with at least its minimum field. Nobody decides when a pool runs; the number of players entered and the clock do, and anyone can trigger the start once the clock has ended. The prizes are the same whatever the field size.`,
    refund: (fillHours: number) =>
      `A pool whose clock runs out with fewer players than its minimum field \u2014 ${fillHours} hours after it opened \u2014 refunds every entry in full and closes. Your entry payment is held by the program until the pool runs, so the refund never depends on the operator. Anyone can trigger the refund once the deadline passes; no one\u2019s permission is needed.`,
    // D-A1 revised (master prompt v2, 2026-08-27): the pool-opening rule,
    // plus the cooldown (prompt v2 §B.6). SUBSTANCE FIXED: sequential pools
    // + pre-funded fixed pots + the cooldown between them.
    // D-E19: the unit that runs one pool at a time is the pool TYPE (size,
    // board and price). PHASE-N-REVIEW: draft wording.
    poolOpening: (cooldownMinutes: number) =>
      `Each size of pool runs one pool at a time on each board and at each price. A pool opens when the prize treasury holds its full prize pool, the previous pool of the same size, board and price has paid out or closed, and ${cooldownMinutes} minutes have passed since. Prize tables are fixed per size and price, and are funded before entries open.`,
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
      '(1) placement patterns — reuse of the same split, uniform round numbers; ' +
      '(2) timing — how the time on the clock was actually spent, battle by battle; ' +
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
      // NARROWED 2026-09-22. This read "computed for every tournament and
      // published with the review log", which promised more than is served.
      // The signals' VALUES are not published: `GET /detection` returns the
      // report to an operator token and to nobody else (backend/detection/
      // src/server.ts, ruling D-E9). What IS public, with no token, is
      // `GET /decisions?pool=` — every decision on a pool with the criterion
      // cited. PR #160's terms of service already say the narrower, true
      // thing; this page said the broader one, so two published surfaces
      // disagreed. The terms are right and this now matches them.
      'These signals are computed for every pool. Every decision and the criterion cited are recorded in a log anyone can read. Nothing is flagged automatically: a flag is a decision taken by a person that an entry meets one of the criteria above, ' +
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
      'When a pool closes, results are published and the pool enters resolving. Resolving lasts up to 12 hours. ' +
      'During resolving we check every wallet due a prize against published sanctions lists, as we are required to. Where an entry has been flagged against the integrity criteria published above, a person decides that flag against those criteria. A flagged prize is held by the program: it is not paid to us and it is not paid to anyone else while the review runs. ' +
      'If no decision is made within 12 hours, the flag is cleared and the prize is paid. Separately, and as a safeguard against our own failure, the program allows anyone at all to release a held prize to the player it belongs to after seven days, without our involvement. ' +
      'You may challenge a decision through our complaints route, and we will tell you which criterion was cited. Every decision and the criterion cited are recorded. If a challenge succeeds after the prize has been paid to another player, we pay you the full prize ourselves and do not seek to recover a prize already paid.',
    fairPlayLink: 'What keeps this fair, and who may enter',
    headings: {
      howToEnter: 'How to enter',
      price: 'Entry prices',
      prizes: 'Prizes by place',
      scoring: 'How scoring works',
      battleTimer: 'The clock and unplaced points',
      ties: 'Ranking, ties and forfeited prizes',
      randomness: 'What randomness does \u2014 and does not do',
      sealing: 'Sealing: when your battles are encrypted and revealed',
      fieldSize: 'How many players a pool runs with',
      refund: 'Refund and closing rule',
      poolOpening: 'When pools open',
      verify: 'How to verify a result',
      availability: 'Where Blotto Cup is available',
      age: '18+',
      responsiblePlay: 'Playing responsibly',
      detection: 'Detection and review',
    },
    tableHeadings: {
      tier: 'Tier',
      entry: 'Entry (SOL)',
      // D-E19: the per-size prize tables — a row per place band, a column
      // per entry price. PHASE-N-REVIEW: draft wording.
      place: 'Place',
      entryColumn: (sol: string) => `${sol} SOL entry`,
      allPrizes: 'All prizes',
    },
    // V3 (founder 2026-09-27): every section is a tile that opens its
    // text. Short labels by section id; the headings above stay the
    // sections' own.
    tilesLabel: 'Sections of the rules',
    tiles: {
      'how-to-enter': 'Entering',
      price: 'Prices',
      prizes: 'Prizes',
      scoring: 'Scoring',
      'battle-timer': 'The clock',
      ties: 'Ties',
      randomness: 'Randomness',
      sealing: 'Sealing',
      'field-size': 'Field size',
      refund: 'Refunds',
      'pool-opening': 'Opening',
      verify: 'Verify',
      availability: 'Where',
      age: '18+',
      'responsible-play': 'Playing well',
      detection: 'Detection',
    } as Record<string, string>,
  },
} as const;
