/*
 * The landing picker's size toggle (D-E19, founder brief 2026-11-05): board
 * and size live in the URL, the default size is 8 when its pool is open
 * (else the smallest open), switching board keeps the size, and under each
 * size sits its live fill on the board on show ("5/8"). The rules are pure
 * (picker-state.ts); the card is rendered with react-dom/server, which reads
 * the server snapshot of the URL — the defaults — exactly as the
 * prerendered landing does.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { TIER_ENTRY_LAMPORTS } from '@blotto/scoring';
import { COPY } from '@/copy';
import { SCENARIOS, fixturePoolTypes } from '@/data/scenarios';
import type { PoolSummary } from '@/data/types';
import {
  buildPickerTiers,
  defaultMode,
  defaultPool,
  defaultSize,
  defaultTier,
  fillLabel,
  pickerSelection,
  readPickerParams,
  writePickerParams,
  type PickerSlot,
} from './picker-state';
import { PoolPicker } from './PoolPicker';

const pools = SCENARIOS.map((s) => s.summary);
const tiers = buildPickerTiers(pools, fixturePoolTypes(), TIER_ENTRY_LAMPORTS);
const open = (key: string) => SCENARIOS.find((s) => s.key === key)!.summary;

const slot = (capacity: 8 | 16 | 32 | 64, over: Partial<PickerSlot> = {}): PickerSlot => ({
  capacity,
  pool: null,
  live: false,
  typeAmounts: null,
  ...over,
});

describe('the URL holds the board and the size', () => {
  it('reads a board and a size, and ignores anything that is not one', () => {
    expect(readPickerParams('?mode=hard&size=32')).toEqual({ mode: 'hard', size: 32 });
    expect(readPickerParams('')).toEqual({ mode: null, size: null });
    expect(readPickerParams('?mode=casual&size=12')).toEqual({ mode: null, size: null });
    expect(readPickerParams('?size=64abc&mode=EASY')).toEqual({ mode: null, size: null });
    expect(readPickerParams('?size=016')).toEqual({ mode: null, size: 16 });
  });

  it('writes both, keeping every other parameter', () => {
    expect(writePickerParams('', 'easy', 8)).toBe('?mode=easy&size=8');
    expect(writePickerParams('?ref=x&size=64', 'hard', 16)).toBe('?ref=x&size=16&mode=hard');
    // Round trip: what is written is what is read.
    expect(readPickerParams(writePickerParams('?a=1', 'hard', 64))).toEqual({ mode: 'hard', size: 64 });
  });

  it('a link opens the card on that board and size; switching board keeps the size', () => {
    const linked = pickerSelection(tiers, '?mode=hard&size=32', null);
    expect(linked).toMatchObject({ mode: 'hard', size: 32, tier: 0 });
    // The board toggle writes the new board with the CURRENT size.
    const switched = pickerSelection(tiers, writePickerParams('?mode=hard&size=32', 'easy', linked.size), null);
    expect(switched).toMatchObject({ mode: 'easy', size: 32 });
    // A size only one board offers is still kept when the other is chosen.
    const lonely = buildPickerTiers(
      pools.filter((p) => p !== open('hard-64')),
      fixturePoolTypes().map((t) => (t.mode === 'hard' && t.capacity === 64 ? { ...t, live: false } : t)),
      TIER_ENTRY_LAMPORTS
    );
    expect(pickerSelection(lonely, '?mode=hard&size=64', null)).toMatchObject({ mode: 'hard', size: 64 });
  });
});

describe('the defaults', () => {
  it('opens on the easy board, the lowest open tier, size 8 — the new player’s pool', () => {
    expect(defaultMode(tiers)).toBe('easy');
    expect(defaultTier(tiers, 'easy')).toBe(0);
    expect(pickerSelection(tiers, '', null)).toMatchObject({ mode: 'easy', tier: 0, size: 8 });
    expect(defaultPool(tiers, 'easy')?.pool).toBe(open('open').pool);
    expect(defaultPool(tiers, 'hard')?.pool).toBe(open('hard-open').pool);
  });

  it('falls back to the smallest open size when 8 has no open pool', () => {
    expect(defaultSize([slot(8, { live: true }), slot(16), slot(32, { pool: open('field') }), slot(64, { pool: open('filling') })])).toBe(32);
    expect(defaultSize([slot(8), slot(16, { live: true }), slot(32, { live: true }), slot(64)])).toBe(16);
    expect(defaultSize([slot(8), slot(16), slot(32), slot(64)])).toBe(8);
  });

  it('opens on the hard board only when nothing easy is open', () => {
    const hardOnly = buildPickerTiers(
      pools.filter((p) => p.mode === 'hard'),
      null,
      TIER_ENTRY_LAMPORTS
    );
    expect(defaultMode(hardOnly)).toBe('hard');
  });

  it('without GET /pool-types, a type is live only where a pool of it is open', () => {
    const fallback = buildPickerTiers(pools, null, TIER_ENTRY_LAMPORTS);
    expect(fallback[0]!.easy.every((s) => s.live === (s.pool !== null))).toBe(true);
    expect(fallback[1]!.easy.every((s) => !s.live)).toBe(true);
  });
});

describe('the live fill under each size', () => {
  it('is entered / the pool’s own size, for the board on show', () => {
    const easy = tiers[0]!.easy.map(fillLabel);
    const hard = tiers[0]!.hard.map(fillLabel);
    const fill = (s: PoolSummary) => `${s.entrants}/${s.capacity}`;
    expect(easy).toEqual([fill(open('open')), fill(open('deadline')), fill(open('field')), fill(open('filling'))]);
    expect(hard).toEqual([fill(open('hard-open')), fill(open('hard-16')), fill(open('hard-32')), fill(open('hard-64'))]);
    expect(easy[0]).toBe('3/8');
  });

  it('says Soon for a size switched on with no pool open, and a dash for one that is not open', () => {
    expect(fillLabel(slot(16, { live: true }))).toBe(COPY.landing.fillSoon);
    expect(fillLabel(slot(16))).toBe(COPY.landing.fillNone);
  });
});

describe('PoolPicker (server render: the defaults)', () => {
  const html = renderToString(<PoolPicker tiers={tiers} serverTime="1760000000" />).replaceAll('<!-- -->', '');

  it('carries the size toggle beside the board toggle, every size with its fill', () => {
    expect(html).toContain('data-testid="pool-picker-size"');
    expect(html).toContain(`aria-label="${COPY.landing.sizeAria}"`);
    for (const s of tiers[0]!.easy) {
      expect(html).toContain(`data-testid="pool-picker-size-${s.capacity}"`);
      expect(html).toContain(`aria-label="${COPY.landing.sizeOptionAria(s.capacity, fillLabel(s))}"`);
    }
    expect(html).toMatch(/data-testid="pool-picker-size-8-detail"[^>]*>3\/8</);
    // Size 8 is chosen, on the easy board.
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="pool-picker-size-8"/);
    expect(html).toMatch(/aria-checked="false"[^>]*data-testid="pool-picker-size-16"/);
    expect(html).toContain('data-mode="easy"');
    expect(html).toContain('data-size="8"');
  });

  it('names the pool by players and prizes, counts players of its own size, and shows its prizes above Enter', () => {
    expect(html).toContain('8 players · 2 prizes · 1st 0.3 SOL');
    expect(html).toMatch(/data-testid="pool-picker-players"[^>]*>3<span[^>]*>\/ 8</);
    expect(html).not.toContain('/ 64');
    expect(html).toContain('data-testid="prize-table"');
    const table = html.indexOf('data-testid="prize-table"');
    const enter = html.indexOf('data-testid="pool-picker-enter"');
    const finalLine = html.indexOf(COPY.pool.decisionsFinal);
    expect(table).toBeLessThan(finalLine);
    expect(finalLine).toBeLessThan(enter);
    expect(html).toContain(`href="/play?pool=${open('open').pool}"`);
  });

  it('lists every entry price in the bar, under the board toggle, greying the ones not open', () => {
    expect(html).toContain('data-testid="pool-picker-tier"');
    const mode = html.indexOf('data-testid="pool-picker-mode"');
    const tierRow = html.indexOf('data-testid="pool-picker-tier"');
    const sizes = html.indexOf('data-testid="pool-picker-size"');
    expect(mode).toBeLessThan(tierRow);
    expect(tierRow).toBeLessThan(sizes);
    TIER_ENTRY_LAMPORTS.forEach((_, tier) => {
      const t = tiers[tier]!;
      const open = t.easy.concat(t.hard).some((x) => x.live || x.pool !== null);
      const price = Number(TIER_ENTRY_LAMPORTS[tier]) / 1e9;
      expect(html).toContain(`aria-label="${COPY.landing.tierOptionAria(String(price), open)}"`);
      const button = html.match(new RegExp(`<button[^>]*data-testid="pool-picker-tier-${tier}"[^>]*>`))![0];
      expect(button.includes('aria-disabled="true"')).toBe(!open);
    });
    // The open price is the one chosen; the fixture opens tier 0 only.
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="pool-picker-tier-0"/);
    expect(html).toContain(COPY.landing.tierLegend);
  });
});
