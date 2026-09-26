/*
 * Flagging is the one review decision that names a wallet the page is not
 * already showing, so it is the one that can be aimed at the wrong thing.
 *
 * The case that motivates the module: until this control existed, NOTHING
 * could place a flag at all. `flag_entry` has two callers — the crank's
 * auto-flag, which ruling D-E9 turned off permanently, and `POST /decisions`
 * with action `flag`, which the server accepted and no client ever sent. So
 * escrow, release, forfeit and `pay_next_place` all sat behind a gate with
 * no handle. This is the handle, and these are its guards.
 */
import { describe, expect, it } from 'vitest';
import { flagTargetMessage, flagTargetRefusal } from './flag-target';

const W00 = 'BoQJjB4fGGTkyQcFKgfgiV3KEmWpaP2jjEpqnoX3iUMR';
const W01 = 'CF38D8UdFhCCakjK1Ty4RViSGpAfaKht5VEy8q79TTEH';

describe('flagTargetRefusal', () => {
  it('accepts a wallet that is not already flagged', () => {
    expect(flagTargetRefusal(W00, [])).toBeNull();
    expect(flagTargetRefusal(W00, [W01])).toBeNull();
  });

  it('trims, so a pasted address with whitespace still works', () => {
    expect(flagTargetRefusal(`  ${W00}\n`, [])).toBeNull();
    // and the trimmed form is what the already-flagged check compares
    expect(flagTargetRefusal(`  ${W00}  `, [W00])).toBe('already_flagged');
  });

  it('refuses an empty target rather than signing nothing', () => {
    expect(flagTargetRefusal('', [])).toBe('empty');
    expect(flagTargetRefusal('   ', [])).toBe('empty');
  });

  it('refuses anything that is not a base58 address', () => {
    expect(flagTargetRefusal('not-an-address', [])).toBe('malformed');
    // 0, O, I and l are not in the base58 alphabet
    expect(flagTargetRefusal('0OIl' + W00.slice(4), [])).toBe('malformed');
    // too short, and too long
    expect(flagTargetRefusal('abc', [])).toBe('malformed');
    expect(flagTargetRefusal(W00 + W00, [])).toBe('malformed');
  });

  it('refuses a wallet already flagged in this pool — the server would say flag_unchanged', () => {
    expect(flagTargetRefusal(W00, [W00, W01])).toBe('already_flagged');
  });

  it('checks the address shape BEFORE the already-flagged list', () => {
    // A malformed string can never be in the list, and the shape complaint
    // is the more useful one.
    expect(flagTargetRefusal('nonsense', ['nonsense'])).toBe('malformed');
  });
});

describe('flagTargetMessage', () => {
  it('has a sentence for every refusal', () => {
    for (const r of ['empty', 'malformed', 'already_flagged'] as const) {
      const m = flagTargetMessage(r);
      expect(m).toBeTruthy();
      expect(m).not.toMatch(/undefined/);
    }
  });
});
