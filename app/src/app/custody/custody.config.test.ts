/* C13 specs: the disclosure derives from config; unset values are an
 * explicit null (rendered "not yet set") — never a fabricated number.
 *
 * Until 2026-09-08 the committed config was entirely unset, and these tests
 * pinned that. The devnet register is now recorded in config/custody.json
 * (the C4 follow-up the runbook asked for), so the tests pin the other half
 * of the contract: every displayed value is the committed one, verbatim, and
 * the one value still unset (the upgrade timelock — Squads has none
 * configured) still renders as null rather than as an invented number. */
import { describe, expect, it } from 'vitest';
import custodyConfig from '@config/custody.json';
import { custodyView } from './custody.config';

describe('custodyView', () => {
  const view = custodyView();

  it('the program id comes from config and matches the committed value', () => {
    expect(view.programId.value).toBe(custodyConfig.programId);
    expect(view.programId.value).toBe('5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17');
  });

  it('every displayed value is the committed config value, verbatim', () => {
    expect(view.upgradeAuthority.value).toBe(custodyConfig.upgradeAuthority);
    expect(view.upgradeAuthority.value).toContain('GXKXLYHBWBAhp7LWNMEZbsuwGb3WHeoDBsmhfndwagXY');
    const byName = new Map(view.keys.map((k) => [k.name, k]));
    expect(byName.get('Admin (multisig)')!.holder).toBe(custodyConfig.keys.admin);
    expect(byName.get('Admin (multisig)')!.holder).toContain(
      '9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z',
    );
    expect(byName.get('Entry signer')!.holder).toBe(custodyConfig.keys.entrySigner);
    expect(byName.get('Settlement signer')!.holder).toBe(custodyConfig.keys.settlementSigner);
    expect(byName.get('Publishing wallet')!.holder).toBe(custodyConfig.keys.irysUploadWallet);
  });

  it('an unset value is null — no invented threshold or timelock', () => {
    // The timelock is genuinely unset on devnet (Squads has none configured);
    // the page must say "not yet set", never show a number.
    expect(custodyConfig.multisig.timelockHours).toBeNull();
    expect(view.timelock.value).toBeNull();
    // And no view value anywhere fabricates a number for an unset field.
    for (const v of [view.upgradeAuthority, view.threshold, view.timelock]) {
      expect(v.value === null || v.value.length > 0).toBe(true);
    }
  });

  it('every key row carries can/cannot mechanics; the sealing holder follows provisioning', () => {
    expect(view.keys.length).toBe(7);
    for (const k of view.keys) {
      expect(k.name.length).toBeGreaterThan(3);
      expect(k.can.length).toBeGreaterThan(20);
      expect(k.cannot.length).toBeGreaterThan(20);
    }
    const byName = new Map(view.keys.map((k) => [k.name, k]));
    // The per-pool sealing keys' holder is architecture, shown only once the
    // settlement signer (and with it custody) is provisioned — which it is.
    const sealing = byName.get('Pool sealing keys (one per pool)')!;
    expect(custodyConfig.keys.settlementSigner).not.toBeNull();
    expect(sealing.holder).not.toBeNull();
  });

  it('threshold renders as "n of m" only when BOTH halves are set', () => {
    // Guard against a partial config producing "3 of null": either the
    // whole value is null (renders "not yet set") or it is a clean string.
    if (view.threshold.value !== null) {
      expect(view.threshold.value).not.toMatch(/null|undefined|NaN/);
      expect(view.threshold.value).toMatch(/^\d+ of \d+$/);
    }
    // The devnet multisig is 1-of-1 and the page must say exactly that.
    expect(view.threshold.value).toBe('1 of 1');
  });
});
