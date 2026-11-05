/*
 * The pool picker's selection rules (D-E19, founder brief 2026-11-05) —
 * pure, no React, so the server page and the tests read the same rules the
 * card does.
 *
 *  - THE URL HOLDS THE CHOICE: `?mode=easy|hard&size=8|16|32|64`, so a link
 *    opens the card on that pool and Back walks the toggles. Anything else
 *    in the query is left alone; a value that is not a board or a size is
 *    ignored rather than guessed at.
 *  - THE DEFAULTS: the easy board unless only hard pools are open; the
 *    lowest tier holding an open pool on that board; and size 8 if its pool
 *    is open — the entry point for new players — else the smallest size
 *    with an open pool, else the smallest size switched on.
 *  - Switching board keeps the chosen size. Whether a size is open on the
 *    other board is that card's business, not a reason to move the player.
 *
 * Nothing here decides whether a pool type is open: `live` comes from
 * GET /pool-types (the chain), with the open pools as the outage fallback,
 * on the server — this module only chooses among what it is handed.
 */
import { POOL_CAPACITIES, isPoolCapacity, type PoolCapacity } from '@blotto/scoring';
import type { BoardMode } from '@/battle/board/mode';
import type { PoolSummary } from '@/data/types';
import { COPY } from '@/copy';

/** One pool type on the card: a size on one board at one tier. */
export interface PickerSlot {
  capacity: PoolCapacity;
  /** The open pool of this type, or null. */
  pool: PoolSummary | null;
  /** The type takes entries at all (its tier is open for the board AND it is enabled). */
  live: boolean;
  /**
   * The TYPE's prize amounts (lamports, decimal strings, rank 1 first) from
   * GET /pool-types — what its next pool opens with — or null when unknown.
   * The open pool's own table always wins over this (`poolLadder`).
   */
  typeAmounts: readonly string[] | null;
}

export interface PickerTier {
  tier: number;
  entryLamports: string;
  /** One slot per size, smallest first (POOL_CAPACITIES order). */
  easy: readonly PickerSlot[];
  hard: readonly PickerSlot[];
}

const MODES: readonly BoardMode[] = ['easy', 'hard'];

/** The board and size a query string names, each null when absent or not one. */
export function readPickerParams(search: string): { mode: BoardMode | null; size: PoolCapacity | null } {
  const q = new URLSearchParams(search);
  const m = q.get('mode');
  const z = q.get('size');
  const n = z !== null && /^\d+$/.test(z) ? Number(z) : NaN;
  return {
    mode: m !== null && (MODES as readonly string[]).includes(m) ? (m as BoardMode) : null,
    size: isPoolCapacity(n) ? n : null,
  };
}

/** The query string with the board and size written in, every other parameter kept. */
export function writePickerParams(search: string, mode: BoardMode, size: PoolCapacity): string {
  const q = new URLSearchParams(search);
  q.set('mode', mode);
  q.set('size', String(size));
  return `?${q.toString()}`;
}

const anyPool = (slots: readonly PickerSlot[]) => slots.some((s) => s.pool !== null);
const anyLive = (slots: readonly PickerSlot[]) => slots.some((s) => s.live || s.pool !== null);

/** Easy unless only a hard pool is open somewhere (the landing's demo stays easy). */
export function defaultMode(tiers: readonly PickerTier[]): BoardMode {
  return tiers.some((t) => anyPool(t.easy)) || !tiers.some((t) => anyPool(t.hard)) ? 'easy' : 'hard';
}

/** The lowest tier with an open pool on this board; else any open pool; else any live type. */
export function defaultTier(tiers: readonly PickerTier[], mode: BoardMode): number {
  const withOpen = tiers.find((t) => anyPool(t[mode]));
  if (withOpen) return withOpen.tier;
  const anyOpen = tiers.find((t) => anyPool(t.easy) || anyPool(t.hard));
  if (anyOpen) return anyOpen.tier;
  const enabled = tiers.find((t) => anyLive(t.easy) || anyLive(t.hard));
  return enabled ? enabled.tier : (tiers[0]?.tier ?? 0);
}

/** 8 if its pool is open; else the smallest size with an open pool; else the smallest live; else 8. */
export function defaultSize(slots: readonly PickerSlot[]): PoolCapacity {
  const smallest = POOL_CAPACITIES[0];
  if (slots.find((s) => s.capacity === smallest)?.pool) return smallest;
  const open = slots.find((s) => s.pool !== null);
  if (open) return open.capacity;
  const live = slots.find((s) => s.live);
  return live ? live.capacity : smallest;
}

/** Whether a tier offers anything at all, on either board. */
export function tierChoosable(t: PickerTier): boolean {
  return anyLive(t.easy) || anyLive(t.hard);
}

/** The words under a size on the toggle: its live fill ("5/8"), "Soon", or a dash. */
export function fillLabel(slot: PickerSlot): string {
  if (slot.pool) return COPY.landing.fill(slot.pool.entrants, slot.capacity);
  return slot.live ? COPY.landing.fillSoon : COPY.landing.fillNone;
}

/**
 * What the card shows, from the URL and the defaults: the board, the tier
 * (the player's own choice where they made one) and the size.
 */
export function pickerSelection(
  tiers: readonly PickerTier[],
  search: string,
  tierChoice: number | null
): { mode: BoardMode; tier: number; size: PoolCapacity; row: PickerTier | undefined } {
  const fromUrl = readPickerParams(search);
  const mode = fromUrl.mode ?? defaultMode(tiers);
  const tier = tierChoice ?? defaultTier(tiers, mode);
  const row = tiers.find((t) => t.tier === tier) ?? tiers[0];
  const size = fromUrl.size ?? defaultSize(row ? row[mode] : []);
  return { mode, tier: row?.tier ?? tier, size, row };
}
