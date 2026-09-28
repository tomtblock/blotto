import { describe, expect, it } from 'vitest';
import { channelOf, offersSocialSignIn, usesMobileWallet, WEBSHELL_UA_TOKEN } from './channel';

// Real strings, so the regex is tested against what browsers send and not
// against what a test would like them to send.
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
// An Android WebView's user agent carries `; wv)`; the shell appends its own token after it.
const WEBSHELL =
  `Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 ${WEBSHELL_UA_TOKEN}`;

describe('channelOf', () => {
  it('is the web by default — unset, empty, desktop, iOS', () => {
    expect(channelOf(undefined)).toBe('web');
    expect(channelOf(null)).toBe('web');
    expect(channelOf('')).toBe('web');
    expect(channelOf(DESKTOP_CHROME)).toBe('web');
    // MWA is not available on any iOS browser (Solana Mobile's own table),
    // so an iPhone is the web, whatever it says after "like Mac OS X".
    expect(channelOf(IOS_SAFARI)).toBe('web');
  });

  it('recognises an Android browser', () => {
    expect(channelOf(ANDROID_CHROME)).toBe('android-browser');
  });

  it('recognises the Solana Mobile shell by the token the wallet library also reads', () => {
    expect(channelOf(WEBSHELL)).toBe('webshell');
    // The token wins over the Android match: the shell IS Android, and it
    // must not be mistaken for a browser.
    expect(WEBSHELL).toMatch(/Android/);
  });

  it('pins the token against the installed wallet library', async () => {
    // The library detects the shell with this exact substring. If a library
    // upgrade changes it, this fails here rather than on a phone.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const bundle = readFileSync(
      fileURLToPath(
        new URL(
          '../../node_modules/@solana-mobile/wallet-standard-mobile/lib/cjs/index.browser.js',
          import.meta.url
        )
      ),
      'utf8'
    );
    expect(bundle).toContain(`"${WEBSHELL_UA_TOKEN}"`);
  });
});

describe('what a channel changes', () => {
  it('registers the mobile wallet on Android only', () => {
    expect(usesMobileWallet('web')).toBe(false);
    expect(usesMobileWallet('android-browser')).toBe(true);
    expect(usesMobileWallet('webshell')).toBe(true);
  });

  it('hides the social routes inside the shell only', () => {
    expect(offersSocialSignIn('web')).toBe(true);
    expect(offersSocialSignIn('android-browser')).toBe(true);
    expect(offersSocialSignIn('webshell')).toBe(false);
  });
});
