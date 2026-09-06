/*
 * The preview catalogue's guarantees. These are the properties design work
 * relies on and that nothing else checks.
 */

import { describe, expect, it } from 'vitest';
import { FIXTURE_API } from './fixture';
import {
  FIXTURE_PLAYER,
  FIXTURE_TREASURY,
  SCENARIOS,
  SCENARIO_BY_POOL,
} from './scenarios';
import type { PoolSummary } from './types';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

describe('the preview scenarios', () => {
  it('covers every pool state the app can render', () => {
    // If a state is missing, its screen cannot be reached without a live
    // tournament in exactly that state — which is the problem this exists for.
    const states = new Set(SCENARIOS.map((s) => s.summary.state));
    const all: PoolSummary['state'][] = [
      'Open',
      'Sealed',
      'Scored',
      'Paid',
      'Refunding',
      'Closed',
    ];
    for (const state of all) expect(states.has(state), `no scenario in state ${state}`).toBe(true);
  });

  it('gives every pool an address-shaped id, because pages treat it as one', () => {
    for (const s of SCENARIOS) expect(s.summary.pool, s.key).toMatch(BASE58);
    expect(FIXTURE_PLAYER).toMatch(BASE58);
  });

  it('keeps every scenario distinct, so one cannot mask another', () => {
    const ids = SCENARIOS.map((s) => s.summary.pool);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SCENARIO_BY_POOL.size).toBe(SCENARIOS.length);
  });

  it('marks every fixture pool with the watermark', () => {
    // A page rendering fixture data must be identifiable as such at a glance.
    for (const s of SCENARIOS) expect(s.summary.pool.startsWith('F1XTURE')).toBe(true);
  });

  it('never publishes a secret for a pool that has not been revealed', () => {
    // Sealing is a property, not a promise: a fixture that hands out sealed
    // entries for an Open pool would teach the UI to render something the
    // real system must never produce.
    for (const s of SCENARIOS) {
      if (s.summary.secret === null) {
        expect(s.sealedEntries, `${s.key} leaks sealed entries`).toHaveLength(0);
      }
    }
  });

  it('keeps entrants consistent with the entry rows', () => {
    for (const s of SCENARIOS) expect(s.entries.length, s.key).toBe(s.summary.entrants);
  });

  it('pays exactly 16 seats where it pays at all, and never above the pot', () => {
    for (const s of SCENARIOS) {
      if (s.payouts.length === 0) continue;
      expect(s.payouts.length, s.key).toBe(16);
      const total = s.payouts.reduce((acc, p) => acc + BigInt(p.amount), 0n);
      expect(total <= BigInt(s.summary.pot_lamports), `${s.key} pays above its pot`).toBe(true);
    }
  });

  it('carries every amount as a decimal string, never a float', () => {
    const decimal = /^\d+$/;
    for (const s of SCENARIOS) {
      expect(s.summary.entry_lamports).toMatch(decimal);
      expect(s.summary.pot_lamports).toMatch(decimal);
      for (const p of s.payouts) expect(p.amount).toMatch(decimal);
      for (const r of s.results) expect(r.amount).toMatch(decimal);
    }
    for (const t of FIXTURE_TREASURY.tiers) {
      expect(t.pot_lamports).toMatch(decimal);
      expect(t.short_by_lamports).toMatch(decimal);
    }
  });
});

describe('the fixture API over the catalogue', () => {
  it('lists every scenario, so the pools index shows a mixed list', async () => {
    expect(await FIXTURE_API.listPools()).toHaveLength(SCENARIOS.length);
  });

  it('answers each pool with its own rows and unknown pools with nothing', async () => {
    const paid = SCENARIOS.find((s) => s.key === 'paid')!;
    expect((await FIXTURE_API.getPool(paid.summary.pool))?.state).toBe('Paid');
    expect(await FIXTURE_API.getPayouts(paid.summary.pool)).toHaveLength(16);
    expect(await FIXTURE_API.getPool('F1XTUREnope1111111111111111111111111111111111')).toBeNull();
    expect(await FIXTURE_API.getPayouts('F1XTUREnope1111111111111111111111111111111111')).toHaveLength(0);
  });

  it('answers a profile for ANY wallet, since the injected signer is arbitrary', async () => {
    const other = 'F1XTUREsomeonee1se11111111111111111111111111';
    expect((await FIXTURE_API.getProfile(other))?.player).toBe(other);
  });

  it('shows every treasury status, so no admin branch is left undesigned', async () => {
    const t = await FIXTURE_API.getTreasury();
    const statuses = new Set(t?.tiers.map((x) => x.status));
    for (const s of ['open', 'settling', 'openable', 'short']) expect(statuses.has(s as never)).toBe(true);
  });
});
