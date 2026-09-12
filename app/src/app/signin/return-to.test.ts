/*
 * D-17 (audit 2026-09-11): signing in from the entry flow dropped the pool
 * and landed every player on "No pool selected".
 *
 * Two properties, and the second is why this is a module rather than a
 * one-liner: the destination has to SURVIVE (with its query string, which
 * is the pool), and it has to be validated, because a `?next=` a stranger
 * can put in front of a player is an open redirect on the one page where a
 * player is in the habit of signing in.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIGNIN_DESTINATION, signInDestination, signInHref } from './return-to';

const POOL = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';

describe('signInDestination', () => {
  it('carries the pool back to the entry flow — the finding', () => {
    expect(signInDestination(`/play?pool=${POOL}`)).toBe(`/play?pool=${POOL}`);
  });

  it('falls back to the arena when nothing was carried', () => {
    for (const nothing of [null, undefined, '', '   ']) {
      expect(signInDestination(nothing)).toBe(DEFAULT_SIGNIN_DESTINATION);
    }
  });

  it('returns to the other pages worth returning to', () => {
    for (const path of ['/pools', '/profile', '/wallet', '/verify', '/rules', '/']) {
      expect(signInDestination(path), path).toBe(path);
    }
  });

  it('refuses every off-site destination — an open redirect is the trap here', () => {
    for (const hostile of [
      'https://evil.example/play',
      'http://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>',
      '\\\\evil.example',
      '/play?pool=x\nLocation: https://evil.example',
    ]) {
      expect(signInDestination(hostile), hostile).toBe(DEFAULT_SIGNIN_DESTINATION);
    }
  });

  it('refuses a path this app does not serve', () => {
    expect(signInDestination('/admin/treasury')).toBe(DEFAULT_SIGNIN_DESTINATION);
    expect(signInDestination('/play/../admin')).toBe(DEFAULT_SIGNIN_DESTINATION);
  });

  it('drops a fragment and keeps the query', () => {
    expect(signInDestination(`/play?pool=${POOL}#anchor`)).toBe(`/play?pool=${POOL}`);
  });

  it('round-trips through the link builder', () => {
    const href = signInHref(`/play?pool=${POOL}`);
    expect(href.startsWith('/signin?next=')).toBe(true);
    const next = new URLSearchParams(href.slice('/signin?'.length)).get('next');
    expect(signInDestination(next)).toBe(`/play?pool=${POOL}`);
  });
});
