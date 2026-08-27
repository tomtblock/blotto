/* Geo pre-flight gate specs (D-B3): every failure mode lands on 'blocked'. */
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

  it('blocks on allowed: false, non-200, malformed body, network error, and no base URL', async () => {
    expect(await checkGeoGate('https://entry.example', answering(200, { allowed: false }))).toBe(
      'blocked'
    );
    expect(await checkGeoGate('https://entry.example', answering(403, {}))).toBe('blocked');
    expect(await checkGeoGate('https://entry.example', answering(200, {}))).toBe('blocked');
    expect(await checkGeoGate('https://entry.example', answering(200, { allowed: 'yes' }))).toBe(
      'blocked'
    );
    const failing: typeof fetch = (async () => {
      throw new Error('offline');
    }) as never;
    expect(await checkGeoGate('https://entry.example', failing)).toBe('blocked');
    expect(await checkGeoGate(undefined, answering(200, { allowed: true }))).toBe('blocked');
  });
});
