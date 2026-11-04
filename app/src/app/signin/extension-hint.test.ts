import { describe, expect, it } from 'vitest';
import { offersPhantomHint } from './extension-hint';
import type { DetectedWallet } from '@/wallet/types';

const PHANTOM: DetectedWallet = { id: 'phantom', name: 'Phantom', icon: 'data:,' };
const SOLFLARE: DetectedWallet = { id: 'solflare', name: 'Solflare', icon: 'data:,' };

const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_CHROME =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1';

describe('the "Phantom not detected" hint', () => {
  it('shows on a desktop browser with no Phantom row — the tester of 2026-11-04', () => {
    expect(offersPhantomHint('web', WINDOWS_CHROME, [])).toBe(true);
    expect(offersPhantomHint('web', MAC_CHROME, [SOLFLARE])).toBe(true);
  });

  it('does not show once Phantom is detected', () => {
    expect(offersPhantomHint('web', WINDOWS_CHROME, [PHANTOM])).toBe(false);
    expect(offersPhantomHint('web', MAC_CHROME, [SOLFLARE, PHANTOM])).toBe(false);
  });

  it('does not show where wallets are not browser extensions: Android, the shell, iPhone and iPad', () => {
    expect(offersPhantomHint('android-browser', WINDOWS_CHROME, [])).toBe(false);
    expect(offersPhantomHint('webshell', WINDOWS_CHROME, [])).toBe(false);
    expect(offersPhantomHint('web', IPHONE_SAFARI, [])).toBe(false);
    expect(offersPhantomHint('web', IPAD_CHROME, [])).toBe(false);
  });
});
