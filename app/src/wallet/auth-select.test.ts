/*
 * The shell's auth decision, pinned (audit 2026-09-11, C-03).
 *
 * Every branch of `selectAuth` and, most of all, the one that did not exist:
 * a provider that never reports leaves "initializing" after the deadline
 * and lands in a signed-out state that NAMES the cause — which is what makes
 * the header render the sign-in link instead of a placeholder
 * (auth-shell.test.tsx renders that) and the sign-in page explain itself.
 */
import { describe, expect, it } from 'vitest';
import { AUTH_INIT_TIMEOUT_MS, INITIALIZING, selectAuth, unavailableMessage } from './auth-select';
import type { Auth } from './types';

const base = {
  injected: null,
  live: null,
  appId: 'app-id',
  bridgeRejected: false,
  bridgeTimedOut: false,
  detected: [],
};

const signedIn: Auth = {
  ...INITIALIZING,
  status: 'signed-in',
  walletAddress: '4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1',
};

describe('selectAuth', () => {
  it('is initializing while the bridge has not reported and the deadline has not passed', () => {
    const a = selectAuth(base);
    expect(a.status).toBe('initializing');
    expect(a.unavailable).toBeUndefined();
  });

  it('after the deadline it is signed-out and says why — the dead end the audit named', () => {
    const a = selectAuth({ ...base, bridgeTimedOut: true });
    // Not "initializing": the header branches on this and renders the
    // sign-in link for anything else (components/shell/app-header.tsx).
    expect(a.status).toBe('signed-out');
    expect(a.unavailable).toBe('unreachable');
    expect(a.walletAddress).toBeNull();
  });

  it('a late-arriving provider wins over the deadline', () => {
    const a = selectAuth({ ...base, bridgeTimedOut: true, live: signedIn });
    expect(a).toBe(signedIn);
  });

  it('a missing credential and a rejected one keep their own names', () => {
    expect(selectAuth({ ...base, appId: undefined }).unavailable).toBe('absent');
    expect(selectAuth({ ...base, bridgeRejected: true }).unavailable).toBe('rejected');
    // Rejection is known before any deadline and outranks it.
    expect(selectAuth({ ...base, bridgeRejected: true, bridgeTimedOut: true }).unavailable).toBe(
      'rejected'
    );
  });

  it('the injected automation signer outranks everything', () => {
    const a = selectAuth({ ...base, injected: signedIn, bridgeTimedOut: true, bridgeRejected: true });
    expect(a).toBe(signedIn);
  });

  it('detected wallets are carried into every fallback state', () => {
    const detected = [{ id: 'phantom', name: 'Phantom', icon: 'data:,' }];
    for (const inputs of [
      { ...base, detected },
      { ...base, detected, appId: undefined },
      { ...base, detected, bridgeRejected: true },
      { ...base, detected, bridgeTimedOut: true },
    ]) {
      expect(selectAuth(inputs).detectedWallets).toBe(detected);
    }
  });

  it('the operator line for a timeout names the deadline and the likely causes', () => {
    const m = unavailableMessage('unreachable');
    expect(m).toContain(`${AUTH_INIT_TIMEOUT_MS / 1000}s`);
    expect(m).toContain('blocked');
    expect(m).toContain('reload');
  });
});
