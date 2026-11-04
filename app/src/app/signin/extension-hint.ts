/*
 * Whether the sign-in page says how to make an installed Phantom show up
 * (founder, 2026-11-04).
 *
 * A tester with the Phantom extension installed saw no "Phantom · Detected"
 * row, chose "More wallets", picked Phantom there and was sent to the Chrome
 * Web Store. The page and the provider both read the browser's wallet
 * standard, and neither saw Phantom: the extension was not running on the
 * site (switched off, limited to "on click", or in another Chrome profile).
 * Nothing on the page said so, and nothing in the provider's modal could.
 *
 * The hint is for a browser that runs extensions and has no Phantom row:
 *   - the web channel only. Android reaches wallet apps through the mobile
 *     wallet standard (channel.ts), and the shell is Android;
 *   - not on an iPhone or iPad, whose browsers run no Chrome extensions.
 *     iPadOS Safari can report a Mac user agent, and then counts as a
 *     desktop here — a wrong hint is one line, a missing one is a dead end;
 *   - not when Phantom is detected (its id is always 'phantom': walletId in
 *     wallet/standard-wallets.ts lowercases the name the wallet registers).
 *
 * Pure, so it is tested with literals (extension-hint.test.ts). The page
 * asks it only after hydration: the server sees no wallets, and a hint
 * rendered there would flash for every player who has Phantom.
 */
import type { Channel } from '@/channel/channel';
import type { DetectedWallet } from '@/wallet/types';

const IOS = /\b(iPhone|iPad|iPod)\b/;

export function offersPhantomHint(
  channel: Channel,
  userAgent: string,
  detected: readonly DetectedWallet[]
): boolean {
  if (channel !== 'web') return false;
  if (IOS.test(userAgent)) return false;
  return !detected.some((w) => w.id === 'phantom');
}
