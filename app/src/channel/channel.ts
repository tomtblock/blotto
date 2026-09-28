/*
 * The delivery channel: WHERE this page is being shown (2026-09-28, the
 * mobile channel — decision D-E18).
 *
 * There is ONE app. The Android package published through the Solana dApp
 * Store is a WebView shell (`mobile/`, built with Solana Mobile's own
 * `webshell` tool) that opens the deployed site; it carries no copy of the
 * product. So every player, on any channel, runs the same build — the
 * version check in src/build/ holds that line at the seal — and the only
 * things a channel may change are the handful of surfaces that CANNOT work
 * in a given environment:
 *
 *   - Google's sign-in page refuses to open inside an embedded WebView
 *     (`disallowed_useragent`), and X's is unreliable there, so the shell
 *     offers wallet sign-in only (signin-client.tsx);
 *   - a phone has no browser extension, so the mobile wallet standard is
 *     registered on Android (wallet/mobile-wallet.tsx) and nowhere else.
 *
 * Nothing on the money path, the board, sealing or scoring reads this
 * value. `scripts/check-standing-rules.sh`'s class rule is the model: a
 * channel is cosmetic to the competition, and a change that makes it
 * otherwise is a product change, not a mobile one.
 *
 * Pure: takes the user-agent string, so it is unit-tested with literals.
 * The React half is use-channel.ts.
 */

export type Channel =
  /** A desktop or iOS browser, or anything unrecognised. The default. */
  | 'web'
  /** Chrome (or another browser) on Android, outside the shell. */
  | 'android-browser'
  /** Inside the Solana Mobile WebView shell — the dApp Store package. */
  | 'webshell';

/**
 * The token the Solana Mobile web shell appends to the WebView's user
 * agent. Read from `@solana-mobile/wallet-standard-mobile@0.6.0`'s own
 * detection (`isSolanaMobileWebShell` in its bundle), not assumed: the
 * library and this module must agree on what a shell looks like, or one
 * would register the mobile wallet where the other hides the socials.
 */
export const WEBSHELL_UA_TOKEN = 'Solana Mobile Web Shell';

/** Which channel a user-agent string describes. Unset or empty means the web. */
export function channelOf(userAgent: string | null | undefined): Channel {
  const ua = userAgent ?? '';
  if (ua.includes(WEBSHELL_UA_TOKEN)) return 'webshell';
  if (/\bAndroid\b/i.test(ua)) return 'android-browser';
  return 'web';
}

/**
 * Whether the mobile wallet standard should be registered on this channel.
 * Android only, in or out of the shell: the library's local transport needs
 * an Android wallet app to answer, and on every other platform registering
 * it would list a wallet that can never connect.
 */
export function usesMobileWallet(channel: Channel): boolean {
  return channel === 'android-browser' || channel === 'webshell';
}

/**
 * Whether the social sign-in routes are offered. Hidden ONLY inside the
 * shell: an Android browser is still a browser, and Google's page opens in
 * it as it does anywhere else.
 */
export function offersSocialSignIn(channel: Channel): boolean {
  return channel !== 'webshell';
}
