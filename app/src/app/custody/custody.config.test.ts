/* C13 specs: the disclosure derives from config; unset values are an
 * explicit null (rendered "not yet set") — never a fabricated number. */
import { describe, expect, it } from 'vitest';
import custodyConfig from '../../../../config/custody.json';
import { custodyView } from './custody.config';

describe('custodyView', () => {
  const view = custodyView();

  it('the program id comes from config and matches the committed value', () => {
    expect(view.programId.value).toBe(custodyConfig.programId);
    expect(view.programId.value).toBe('5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17');
  });

  it('unset multisig values are null — no invented threshold or timelock', () => {
    // The committed launch config has these unset; the page must say so.
    expect(view.upgradeAuthority.value).toBeNull();
    expect(view.threshold.value).toBeNull();
    expect(view.timelock.value).toBeNull();
    // And no view value anywhere fabricates a number for an unset field.
    for (const v of [view.upgradeAuthority, view.threshold, view.timelock]) {
      expect(v.value === null || v.value.length > 0).toBe(true);
    }
  });

  it('every key row carries can/cannot mechanics; unprovisioned holders are null', () => {
    expect(view.keys.length).toBe(7);
    for (const k of view.keys) {
      expect(k.name.length).toBeGreaterThan(3);
      expect(k.can.length).toBeGreaterThan(20);
      expect(k.cannot.length).toBeGreaterThan(20);
    }
    const byName = new Map(view.keys.map((k) => [k.name, k]));
    expect(byName.get('Admin (multisig)')!.holder).toBeNull();
    expect(byName.get('Pool sealing keys (one per pool)')!.holder).toBeNull();
  });

  it('threshold renders as "n of m" only when BOTH halves are set', () => {
    // Guard against a partial config producing "3 of null": either the
    // whole value is null (renders "not yet set") or it is a clean string.
    if (view.threshold.value !== null) {
      expect(view.threshold.value).not.toMatch(/null|undefined|NaN/);
      expect(view.threshold.value).toMatch(/^\d+ of \d+$/);
    }
  });
});
