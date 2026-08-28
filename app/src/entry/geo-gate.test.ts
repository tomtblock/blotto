/*
 * Geo pre-flight gate specs (D-B3, amended 2026-08-28): every failure mode
 * keeps entry CLOSED, and the state distinguishes a real territory verdict
 * from the gate's own inability to ask.
 */
import { describe, expect, it } from 'vitest';
import { checkGeoGate } from './geo-gate';

const answering = (status: number, body: unknown): typeof fetch =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as never;

describe('checkGeoGate', () => {
  it('allows only on an explicit allowed: true', async () => {
    expect(await checkGeoGate('https://entry.example', answering(200, { allowed: true }))).toBe(
      'allowed'
    );
  });

  it('reports a real verdict as blocked', async () => {
    expect(await checkGeoGate('https://entry.example', answering(200, { allowed: false }))).toBe(
      'blocked'
    );
  });

  it('reports its own failures as unavailable, never as a territory block', async () => {
    expect(await checkGeoGate('https://entry.example', answering(403, {}))).toBe('unavailable');
    expect(await checkGeoGate('https://entry.example', answering(500, {}))).toBe('unavailable');
    expect(await checkGeoGate('https://entry.example', answering(200, {}))).toBe('unavailable');
    expect(await checkGeoGate('https://entry.example', answering(200, { allowed: 'yes' }))).toBe(
      'unavailable'
    );
    const failing: typeof fetch = (async () => {
      throw new Error('offline');
    }) as never;
    expect(await checkGeoGate('https://entry.example', failing)).toBe('unavailable');
    // A missing entry API is a deployment fact, not a statement about the
    // player's location.
    expect(await checkGeoGate(undefined, answering(200, { allowed: true }))).toBe('unavailable');
  });

  it('never returns allowed for anything but an explicit true', async () => {
    for (const body of [{}, { allowed: 1 }, { allowed: 'true' }, { allowed: null }]) {
      expect(await checkGeoGate('https://entry.example', answering(200, body))).not.toBe('allowed');
    }
  });
});
