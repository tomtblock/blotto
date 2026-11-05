/*
 * The preview catalogue's guarantees. These are the properties design work
 * relies on and that nothing else checks.
 */

import { describe, expect, it } from 'vitest';
import {
  LADDER_TABLES,
  MIN_FIELD_BY_CAPACITY,
  POOL_CAPACITIES,
  TIER_ENTRY_LAMPORTS,
  amountForRank,
  prizePoolFor,
  type PoolCapacity,
} from '@blotto/scoring';
import { FIXTURE_API } from './fixture';
import {
  FIXTURE_PLAYER,
  FIXTURE_TREASURY,
  SCENARIOS,
  SCENARIO_BY_POOL,
  fixturePoolTypes,
} from './scenarios';
import { poolLadder } from './format';
import type { PoolSummary } from './types';

const ENTRY = TIER_ENTRY_LAMPORTS[0]!;
const tableOf = (s: { summary: PoolSummary }) => LADDER_TABLES[s.summary.capacity as PoolCapacity];

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

  /*
   * D-E19 (the Ladder): every pool carries its size's published table and
   * floor, computed by @blotto/scoring — a fixture amount typed by hand
   * would render on every preview as what the program pays.
   */
  it('carries each pool\u2019s own size, floor and table, from the published tables', () => {
    for (const s of SCENARIOS) {
      const capacity = s.summary.capacity as PoolCapacity;
      expect(POOL_CAPACITIES as readonly number[], s.key).toContain(capacity);
      expect(s.summary.min_seats, s.key).toBe(MIN_FIELD_BY_CAPACITY[capacity]);
      expect(s.summary.prize_table, s.key).toEqual([...LADDER_TABLES[capacity]]);
      expect(s.summary.paid_places, s.key).toBe(LADDER_TABLES[capacity].length);
      expect(s.summary.prize_amounts, s.key).toEqual(
        LADDER_TABLES[capacity].map((_, i) => amountForRank(LADDER_TABLES[capacity], ENTRY, i + 1).toString())
      );
      expect(BigInt(s.summary.pot_lamports), s.key).toBe(prizePoolFor(LADDER_TABLES[capacity], ENTRY));
      expect(s.summary.entrants, `${s.key} fits its pool`).toBeLessThanOrEqual(capacity);
      // The deadline's answer follows the POOL's own floor.
      if (s.summary.state === 'Open') {
        expect(s.summary.outcome_if_deadline_now, s.key).toBe(
          s.summary.entrants >= s.summary.min_seats ? 'seal' : 'refund'
        );
      }
    }
  });

  it('holds exactly one open pool per pool type at tier 0 — both boards × the four sizes', () => {
    const open = SCENARIOS.filter((s) => s.summary.state === 'Open');
    const types = open.map((s) => `${s.summary.mode ?? 'easy'}:${s.summary.tier}:${s.summary.capacity}`);
    expect(new Set(types).size, 'two open pools share a type').toBe(types.length);
    for (const mode of ['easy', 'hard']) {
      for (const capacity of POOL_CAPACITIES) expect(types, `${mode} ${capacity}`).toContain(`${mode}:0:${capacity}`);
    }
    // The landing's default size (8, easy) is the original fixture pool.
    expect(open.find((s) => s.key === 'open')?.summary.capacity).toBe(8);
  });

  it('pays the table place by place where it pays at all, and the total never above the prize pool', () => {
    for (const s of SCENARIOS) {
      if (s.payouts.length === 0) continue;
      const table = tableOf(s);
      const rankBySeat = new Map(s.leaderboard?.rows.map((r) => [r.seat, r.rank]) ?? []);
      for (const p of s.payouts) {
        const rank = rankBySeat.get(p.seat);
        expect(rank, `${s.key} seat ${p.seat} has a place`).toBeDefined();
        expect(BigInt(p.amount), `${s.key} seat ${p.seat}`).toBe(amountForRank(table, ENTRY, rank!));
      }
      const total = s.payouts.reduce((acc, p) => acc + BigInt(p.amount), 0n);
      expect(total, `${s.key} never pays above its prize pool`).toBeLessThanOrEqual(BigInt(s.summary.pot_lamports));
      // With n players the occupied places are 1..n: the paid places are min(table, n).
      expect(s.payouts.length, s.key).toBe(Math.min(table.length, s.summary.entrants));
    }
  });

  it('a settled pool’s archive pays its table’s places and everyone below the line zero', () => {
    for (const s of SCENARIOS) {
      if (!s.leaderboard) continue;
      const table = tableOf(s);
      expect(s.leaderboard.rows.length, s.key).toBe(s.summary.entrants);
      for (const r of s.leaderboard.rows) {
        expect(BigInt(r.amount_lamports), `${s.key} rank ${r.rank}`).toBe(amountForRank(table, ENTRY, r.rank));
      }
      const paidSeats = s.leaderboard.rows.filter((r) => r.amount_lamports !== '0').map((r) => r.seat);
      expect([...paidSeats].sort((a, b) => a! - b!), s.key).toEqual(s.payouts.map((p) => p.seat));
    }
  });

  it('shows an unpaid finish and a paid one, so both lines of the results page render', () => {
    const viewerRank = (key: string) =>
      SCENARIOS.find((s) => s.key === key)!.leaderboard!.rows.find((r) => r.player === FIXTURE_PLAYER)!;
    expect(viewerRank('paid').amount_lamports).not.toBe('0');
    expect(viewerRank('field-paid').amount_lamports).toBe('0');
    expect(viewerRank('field-paid').rank).toBeGreaterThan(LADDER_TABLES[32].length);
  });

  it('answers GET /pool-types with every launch type, live, naming its open pool', () => {
    const rows = fixturePoolTypes();
    expect(rows.map((r) => `${r.mode}:${r.capacity}`)).toEqual(
      ['easy', 'hard'].flatMap((m) => POOL_CAPACITIES.map((c) => `${m}:${c}`))
    );
    for (const r of rows) {
      expect(r.live, `${r.mode} ${r.capacity}`).toBe(true);
      const open = SCENARIO_BY_POOL.get(r.live_pool!);
      expect(open?.summary.state).toBe('Open');
      expect(open?.summary.capacity).toBe(r.capacity);
      expect(r.prize_amounts).toEqual(poolLadder(open!.summary).prizeAmounts.map(String));
      expect(BigInt(r.prize_pool_lamports)).toBe(prizePoolFor(r.prize_table, ENTRY));
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
      expect(seatless[0].amount_lamports, `${s.key} keeps every paid row's entry number`).toBe('0');
      expect(seatless[0].player, `${s.key} keeps the viewer's entry number`).not.toBe(FIXTURE_PLAYER);
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
    // D-E19: a full pool of 64 pays its 16 places.
    expect(await FIXTURE_API.getPayouts(paid.summary.pool)).toHaveLength(LADDER_TABLES[64].length);
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
