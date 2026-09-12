/*
 * The embedded wallet's signing-confirmation suppressor, and its gate.
 *
 * WHAT IT IS. The 10.B Step 2 spike (P0: a buy tap killed the page on real
 * iOS Safari) needed to isolate whether Privy's own confirmation modal was
 * the page-killer, so the spike page set `window.__BLOTTO_SIGN_NO_MODAL__`
 * and embedded signing passed `uiOptions: { showWalletUIs: false }` — the
 * transaction is signed with no confirmation shown to the person signing it.
 *
 * WHY IT IS GATED (audit 2026-09-11, B-53). Until this module the global was
 * read in the production bundle, ungated. Anything that can set a window
 * property on this origin — a compromised dependency, an injected script,
 * an extension — could therefore switch off the one screen that tells a
 * player what their embedded wallet is about to sign, and the signature
 * would be produced silently. Its sibling automation lever (the injected
 * test signer, `tx/test-signer.ts`) was gated and proven absent from real
 * builds; this one was not, and it is the more dangerous of the two.
 *
 * THE GATE IS THE SAME ONE, deliberately: NEXT_PUBLIC_ALLOW_TEST_SIGNER.
 *
 *  - It is the switch for "this browser is a driven automation harness",
 *    which is the only context either lever belongs in.
 *  - next.config.ts NORMALISES it to the literal "0" when unset, which is
 *    what makes the gate real rather than hopeful: Next inlines a SET
 *    NEXT_PUBLIC_* variable literally, so the comparison becomes
 *    `"0" === "1"`, the branch is dead code, and the minifier drops it —
 *    the global's name never reaches a deployable bundle. An unset variable
 *    is left as a runtime lookup instead, so a second, un-normalised flag
 *    would NOT have this property. That mistake has been paid for once
 *    already (see the app-test-signer CI lane's header).
 *  - One switch also means one thing to get wrong, and the cluster
 *    invariants already refuse a mainnet build that has it on
 *    (chain/cluster.ts).
 *
 * PHASE-N-REVIEW: reusing the automation flag rather than adding a second
 * one is the judgement call — a separate variable would read more precisely
 * and would NOT be normalised at build time unless someone remembered to
 * normalise it too, which is the property that makes this gate real.
 */

declare global {
  interface Window {
    /** Set ONLY by a driven automation harness; ignored unless the build
     * flag above is on. Never set this in an ordinary browser session. */
    __BLOTTO_SIGN_NO_MODAL__?: boolean;
  }
}

/**
 * Options to spread into the provider's `signTransaction` call.
 *
 * `{}` in every real build — the player sees the provider's confirmation
 * for everything their embedded wallet signs. Only a build with the
 * automation flag on, driven by a harness that set the global, gets the
 * suppression.
 */
export function signingUiOptions():
  | Record<string, never>
  | { options: { uiOptions: { showWalletUIs: false } } } {
  if (process.env.NEXT_PUBLIC_ALLOW_TEST_SIGNER !== '1') return {};
  if (typeof window === 'undefined' || !window.__BLOTTO_SIGN_NO_MODAL__) return {};
  return { options: { uiOptions: { showWalletUIs: false } } };
}
