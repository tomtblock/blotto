/* C11: the device marker — stable per profile, absent (zeros) when
 * storage is closed, never a throw. */
import { afterEach, describe, expect, it } from 'vitest';
import { deviceMarker } from './device';

const shim = () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  return store;
};

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('deviceMarker', () => {
  it('generates once and answers the SAME 32 bytes thereafter', () => {
    shim();
    const first = deviceMarker();
    expect(first.length).toBe(32);
    expect(first.some((b) => b !== 0)).toBe(true);
    expect([...deviceMarker()]).toEqual([...first]);
  });

  it('a fresh profile gets a fresh marker', () => {
    shim();
    const a = deviceMarker();
    shim(); // new empty store — the cleared/other browser
    const b = deviceMarker();
    expect([...a]).not.toEqual([...b]);
  });

  it('closed storage yields all zeros (absence, which detection ignores)', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    const m = deviceMarker();
    expect(m.length).toBe(32);
    expect(m.every((b) => b === 0)).toBe(true);
  });
});
