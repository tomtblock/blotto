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

  it('carries no sealed material at all — the boxes have no public reader', () => {
    // Rewritten in place on 2026-09-16 (the founder's data-minimisation
    // ruling of 2026-09-15). This case used to assert that no fixture handed
    // out sealed entries for a pool whose secret was not yet public. Sealing
    // is still a property, not a promise; the fixture now proves the stronger
    // thing the real system does: NO surface serves a sealed box, revealed or
    // not, so no scenario carries one to serve.
    for (const s of SCENARIOS) {
      expect('sealedEntries' in s, `${s.key} carries sealed entries`).toBe(false);
    }
  });

  it('keeps entrants consistent with the entry rows', () => {
    for (const s of SCENARIOS) expect(s.entries.length, s.key).toBe(s.summary.entrants);
  });

  it('pays the winner the whole pot where it pays at all (D-E2), never above it', () => {
    for (const s of SCENARIOS) {
      if (s.payouts.length === 0) continue;
      // One paid place: the fixture's winner is the viewer's seat 3.
      expect(s.payouts.length, s.key).toBe(1);
      expect(s.payouts[0].seat, s.key).toBe(3);
      const total = s.payouts.reduce((acc, p) => acc + BigInt(p.amount), 0n);
      expect(total, `${s.key} pays exactly its pot`).toBe(BigInt(s.summary.pot_lamports));
    }
  });

  it('a settled pool’s archive ranks the paid seat first and everyone else at zero', () => {
    for (const s of SCENARIOS) {
      if (!s.leaderboard) continue;
      expect(s.leaderboard.rows.length, s.key).toBe(s.summary.entrants);
      const first = s.leaderboard.rows.filter((r) => r.rank === 1);
      expect(first.map((r) => r.seat), s.key).toEqual(s.payouts.map((p) => p.seat));
      for (const r of s.leaderboard.rows) {
        if (r.rank !== 1) expect(r.amount_lamports, `${s.key} seat ${r.seat}`).toBe('0');
      }
    }
  });

  it('the archive is honest about what the chain committed (D-E8)', () => {
    for (const s of SCENARIOS) {
      if (!s.leaderboard) continue;
      // The committed leaf, and only it: player, rank, amount.
      expect(s.leaderboard.committed_fields, s.key).toEqual([
        'player',
        'rank',
        'amount_lamports',
      ]);
      // Exactly one row has no indexed entry number, so the null path the
      // archive table has to render is exercised by the preview data.
      const seatless = s.leaderboard.rows.filter((r) => r.seat === null);
      expect(seatless.length, `${s.key} exercises the absent entry number`).toBe(1);
      expect(seatless[0].rank, `${s.key} keeps the paid row's entry number`).not.toBe(1);
      for (const r of s.leaderboard.rows) {
        // Half-points stay integers — a fixture is not allowed to be the
        // place a float enters a score.
        expect(Number.isInteger(r.recomputed.score_half), `${s.key} ${r.player}`).toBe(true);
        expect(Number.isInteger(r.recomputed.zones), `${s.key} ${r.player}`).toBe(true);
      }
    }
  });

  it('every summary carries the server clock the countdowns derive from', () => {
    const decimal = /^\d+$/;
    for (const s of SCENARIOS) {
      expect(s.summary.server_time, s.key).toMatch(decimal);
      // Option A: one clock per pool — no go-deadline field exists any more.
      expect('go_deadline' in s.summary, s.key).toBe(false);
    }
  });

  it('resolving (Stage C) is derived from held shares, never asserted alone', () => {
    for (const s of SCENARIOS) {
      // The read API's rule, mirrored: no held share → never resolving; a
      // resolving pool carries the window's end as a decimal string.
      if (s.summary.held_shares === 0) expect(s.summary.resolving, s.key).toBe(false);
      if (s.summary.resolving) {
        expect(s.summary.held_shares, s.key).toBeGreaterThan(0);
        expect(s.summary.resolving_until, s.key).toMatch(/^\d+$/);
      }
    }
    const escrow = SCENARIOS.find((s) => s.key === 'escrow');
    expect(escrow?.summary.resolving).toBe(true);
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
    expect(await FIXTURE_API.getPayouts(paid.summary.pool)).toHaveLength(1);
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
