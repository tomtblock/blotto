/*
 * The signing-confirmation gate (audit 2026-09-11, B-53).
 *
 * The finding: a global that suppresses the embedded wallet's signing
 * confirmation shipped ungated in the production bundle, while its sibling
 * automation lever — the injected test signer — was gated behind
 * NEXT_PUBLIC_ALLOW_TEST_SIGNER and proven absent from a real build by the
 * app-test-signer CI lane.
 *
 * Both directions are asserted here for the reason that lane states in its
 * own header: a check that can only pass is not a gate. So this suite proves
 * the suppression is UNREACHABLE without the flag AND reachable with it —
 * if the second half ever fails, the first half is proving nothing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signingUiOptions } from './signing-ui';

const setGlobal = (value: boolean | undefined) => {
  (globalThis as { window?: unknown }).window = { __BLOTTO_SIGN_NO_MODAL__: value };
};

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as { window?: unknown }).window;
});

describe('signingUiOptions', () => {
  it('shows the confirmation in a real build, even with the global set', () => {
    // The attack this closes: anything that can set a window property on
    // this origin could otherwise sign an embedded wallet's transactions
    // with no screen shown to the person whose money moves.
    for (const flag of [undefined, '', '0', 'true', 'yes']) {
      vi.stubEnv('NEXT_PUBLIC_ALLOW_TEST_SIGNER', flag);
      setGlobal(true);
      expect(signingUiOptions(), String(flag)).toEqual({});
    }
  });

  it('shows the confirmation in an automation build the harness did not ask', () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_TEST_SIGNER', '1');
    setGlobal(undefined);
    expect(signingUiOptions()).toEqual({});
    delete (globalThis as { window?: unknown }).window;
    expect(signingUiOptions()).toEqual({});
  });

  it('suppresses it only when the flag is on AND the harness set the global', () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_TEST_SIGNER', '1');
    setGlobal(true);
    expect(signingUiOptions()).toEqual({
      options: { uiOptions: { showWalletUIs: false } },
    });
  });

  it('is the ONLY place the global is read, so the gate cannot be walked around', () => {
    // A second read elsewhere would be ungated again, and the build-time
    // elimination that keeps the name out of a deployable bundle would stop
    // holding. Pinned against the sources rather than trusted.
    const read = (path: string) =>
      readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
    expect(read('./privy-bridge.tsx')).not.toContain('__BLOTTO_SIGN_NO_MODAL__');
    // Inside the gate module, the build-flag guard must come first in the
    // function itself — prose above it does not count.
    const body = read('./signing-ui.ts').split('export function signingUiOptions')[1] ?? '';
    const guardAt = body.indexOf("process.env.NEXT_PUBLIC_ALLOW_TEST_SIGNER !== '1'");
    const globalAt = body.indexOf('window.__BLOTTO_SIGN_NO_MODAL__');
    expect(guardAt).toBeGreaterThan(-1);
    expect(globalAt).toBeGreaterThan(guardAt);
  });
});
