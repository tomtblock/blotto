/*
 * The one-time cleanup of the retired Blott stills (forget-blott-stills.ts):
 * it names the database the dial run wrote, never throws, and does nothing
 * where IndexedDB is absent.
 */
import { describe, expect, it } from 'vitest';
import { BLOTT_STILLS_DB, forgetBlottStills } from './forget-blott-stills';

describe('forgetBlottStills', () => {
  it('deletes exactly the database the dial run wrote', () => {
    const asked: string[] = [];
    expect(forgetBlottStills({ deleteDatabase: (name) => asked.push(name) })).toBe(true);
    expect(asked).toEqual(['blotto-blots']);
    expect(BLOTT_STILLS_DB).toBe('blotto-blots');
  });

  it('is a quiet no-op where the browser has no IndexedDB', () => {
    expect(forgetBlottStills(undefined)).toBe(false);
  });

  it('never lets a refusing browser reach the player', () => {
    const refusing = {
      deleteDatabase: () => {
        throw new Error('SecurityError: IndexedDB disabled');
      },
    };
    expect(() => forgetBlottStills(refusing)).not.toThrow();
    expect(forgetBlottStills(refusing)).toBe(false);
  });
});
