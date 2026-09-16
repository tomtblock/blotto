/*
 * Opaque storage keys (2026-09-16, the founder's data-minimisation ruling
 * of 2026-09-15): the key never names its subject, the same subject always
 * gets the same key on one device, two purposes never collide, a closed
 * storage answers null, and a legacy key migrates once.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyKey, opaqueKey, opaqueToken } from './opaque-key';

// Node has no localStorage; a Map-backed stand-in gives the module a device
// secret to derive from, exactly as a browser would.
function installStorage(broken = false) {
  const map = new Map<string, string>();
  const throwing = () => {
    throw new Error('storage closed');
  };
  (globalThis as Record<string, unknown>).localStorage = broken
    ? { getItem: throwing, setItem: throwing, removeItem: throwing }
    : {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
      };
  return map;
}

const WALLET = '7fpaNh8mAi9SDJyvu6sVFxsqqP8LE3whvBJ1K9ZFYPve';

describe('opaqueKey / opaqueToken', () => {
  let map: Map<string, string>;
  beforeEach(() => {
    map = installStorage();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('never names the subject, and is stable on one device', () => {
    const a = opaqueKey('welcomed', WALLET);
    const b = opaqueKey('welcomed', WALLET);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a).toMatch(/^blotto:k:[0-9a-f]{64}$/);
    expect(a).not.toContain(WALLET);
    expect(a).not.toContain(WALLET.slice(0, 8));
  });

  it('separates purposes and subjects', () => {
    expect(opaqueKey('welcomed', WALLET)).not.toBe(opaqueKey('attested:v2', WALLET));
    expect(opaqueKey('welcomed', WALLET)).not.toBe(opaqueKey('welcomed', `${WALLET}x`));
    // The NUL separators keep (purpose, subject) pairs from spelling each other.
    expect(opaqueKey('ab', 'c')).not.toBe(opaqueKey('a', 'bc'));
  });

  it('a token is the same digest without the key prefix, so membership can be re-decided', () => {
    const token = opaqueToken('notify-seen', 'POOL:Paid');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).toBe(opaqueToken('notify-seen', 'POOL:Paid'));
    expect(token).not.toContain('POOL');
  });

  it('answers null when storage is closed', () => {
    installStorage(true);
    expect(opaqueKey('welcomed', WALLET)).toBeNull();
    expect(opaqueToken('welcomed', WALLET)).toBeNull();
  });

  it('migrates a legacy key once, transforming the value if asked, and removes it', () => {
    const legacy = `blotto:welcomed:${WALLET}`;
    map.set(legacy, '2026-09-01T00:00:00.000Z');
    const key = opaqueKey('welcomed', WALLET)!;
    migrateLegacyKey(legacy, key);
    expect(map.get(key)).toBe('2026-09-01T00:00:00.000Z');
    expect(map.has(legacy)).toBe(false);
    // A second migration finds nothing to carry and changes nothing.
    map.set(key, 'kept');
    migrateLegacyKey(legacy, key);
    expect(map.get(key)).toBe('kept');

    map.set('old', '["POOL:Paid"]');
    migrateLegacyKey('old', opaqueKey('notify-seen', WALLET), (v) =>
      JSON.stringify((JSON.parse(v) as string[]).map((k) => opaqueToken('notify-seen', k)))
    );
    expect(map.get(opaqueKey('notify-seen', WALLET)!)).toBe(
      JSON.stringify([opaqueToken('notify-seen', 'POOL:Paid')])
    );
    expect(map.has('old')).toBe(false);
  });
});
