/* C11: the device marker — stable per (browser, pool), UNLINKABLE across
 * pools (audit 2026-09-11, B-40), absent (zeros) when storage is closed,
 * never a throw. */
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { deviceMarker } from './device';

const POOL_A = 'Poo1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const POOL_B = 'Poo1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const shim = () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
};

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('deviceMarker', () => {
  it('answers the SAME 32 bytes for the same browser and pool', () => {
    shim();
    const first = deviceMarker(POOL_A);
    expect(first.length).toBe(32);
    expect(first.some((b) => b !== 0)).toBe(true);
    // The in-pool same-device signal is exactly this equality.
    expect([...deviceMarker(POOL_A)]).toEqual([...first]);
  });

  it('answers DIFFERENT bytes for the same browser in another pool', () => {
    shim();
    // The finding: one stable marker published in every bundle linked every
    // wallet a browser had ever used. Two pools, two unrelated values.
    expect([...deviceMarker(POOL_A)]).not.toEqual([...deviceMarker(POOL_B)]);
  });

  it('a fresh profile gets a fresh identity', () => {
    shim();
    const a = deviceMarker(POOL_A);
    shim(); // new empty store — the cleared/other browser
    const b = deviceMarker(POOL_A);
    expect([...a]).not.toEqual([...b]);
  });

  it('never keeps or derives from the v1 marker, which was published verbatim', () => {
    const store = shim();
    // A browser that entered before the fix carries the old key, and its
    // value is public in every v1 reveal bundle. Deriving from it would let
    // anyone holding that bundle recompute this browser's marker for any
    // future pool — the linkage this change removes, reintroduced.
    const leaked = 'ab'.repeat(32);
    store.set('blotto:device-marker:v1', leaked);
    const marker = deviceMarker(POOL_A);
    expect(store.has('blotto:device-marker:v1')).toBe(false);
    expect([...marker]).not.toEqual([...Buffer.from(leaked, 'hex')]);
    const salt = store.get('blotto:device-salt:v3');
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    expect(salt).not.toBe(leaked);
  });

  it('never sends the stored salt itself', () => {
    const store = shim();
    const marker = deviceMarker(POOL_A);
    const salt = store.get('blotto:device-salt:v3')!;
    expect(Buffer.from(marker).toString('hex')).not.toBe(salt);
  });

  it('carries a v2 salt to the v3 name once, and the marker does not change by a byte', () => {
    // 2026-10-12: only the storage NAME moved (the v2 name read to a scanner
    // as key material). A browser that entered before keeps its markers, so
    // the in-pool same-device signal is undisturbed across the rename.
    const store = shim();
    const v2 = 'cd'.repeat(32);
    store.set('blotto:device-secret:v2', v2);
    const marker = deviceMarker(POOL_A);
    expect(store.get('blotto:device-salt:v3')).toBe(v2);
    expect(store.has('blotto:device-secret:v2')).toBe(false);
    // The derivation, spelled out independently: sha256(domain NUL pool NUL ‖ salt).
    const label = new TextEncoder().encode(`blotto:device:v2\u0000${POOL_A}\u0000`);
    const salt = Buffer.from(v2, 'hex');
    const expected = sha256(new Uint8Array([...label, ...salt]));
    expect([...marker]).toEqual([...expected]);
    // And later reads come from v3 alone.
    expect([...deviceMarker(POOL_A)]).toEqual([...expected]);
  });

  it('a malformed v2 value is dropped, never carried', () => {
    const store = shim();
    store.set('blotto:device-secret:v2', 'not-hex');
    deviceMarker(POOL_A);
    expect(store.has('blotto:device-secret:v2')).toBe(false);
    expect(store.get('blotto:device-salt:v3')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('closed storage yields all zeros (absence, which detection ignores)', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
      removeItem() {
        throw new Error('denied');
      },
    };
    const m = deviceMarker(POOL_A);
    expect(m.length).toBe(32);
    expect(m.every((b) => b === 0)).toBe(true);
    // Absence must not become a shared fake identity across browsers: a
    // zeroed marker is the one value detection skips.
    expect([...deviceMarker(POOL_B)]).toEqual([...m]);
  });
});
