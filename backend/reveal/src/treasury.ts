/**
 * The treasury policy, off-chain (D-A1 revised, master prompt v2
 * 2026-08-27): a PURE function deciding which (mode, tier) — if any — the
 * keeper should open next, mirroring `open_pool`'s on-chain gates EXACTLY.
 * The parity suite drives this and `FakeChain.openPool` through the same
 * scenarios and requires them to agree, so a drift between the keeper's
 * intention and the program's decision fails tests rather than burning a
 * transaction per tick.
 *
 * TWO LADDERS since Phase B (founder rulings 2026-09-24): every tier has an
 * easy slot and a hard slot, each with its own enablement switch and
 * cooldown clock, sharing the tier's price and pot. The program's
 * `idle_tier_reserve` walks both ladders; so does the mirror below.
 *
 * Priority: the LOWEST openable tier first (v2 — the small tiers are the
 * revenue engine that funds the ladder; a big pot never queue-jumps the
 * pool most players are waiting for), and at one tier the EASY ladder before
 * the hard one — the easy pool is the one most players are waiting for.
 *
 * All lamport arithmetic is bigint; nothing here touches a float.
 */

import type { ChainConfigView, PoolStateName } from './chain';

/** What the keeper knows about each tier's live pool ('none' if no slot). */
export type TierPoolStates = (PoolStateName | 'none')[];

/** The two ladders, in the order the keeper walks them at one tier. */
const MODES = [0, 1] as const;

/** One ladder's three per-tier arrays, picked by mode. */
function ladder(config: ChainConfigView, mode: number) {
  return mode === 1
    ? {
        openTiers: config.hardOpenTiers,
        activePoolByTier: config.hardActivePoolByTier,
        tierNextOpenAt: config.hardTierNextOpenAt,
      }
    : {
        openTiers: config.openTiers,
        activePoolByTier: config.activePoolByTier,
        tierNextOpenAt: config.tierNextOpenAt,
      };
}

export interface NextOpenable {
  /** Tier index to open, or null when nothing may open this tick. */
  tier: number | null;
  /** The ladder to open it on (0 easy, 1 hard); null with `tier`. */
  mode: number | null;
  /** Why (for the log line and the treasury report), always set. */
  reason: string;
  /** For a 'short' verdict: lamports missing for the FIRST blocked slot
   * (lowest tier first, easy first), so the report can say "short by X
   * SOL". 0n otherwise. */
  shortfallLamports: bigint;
}

/**
 * The on-chain idle-tier reserve (`idle_tier_reserve`): `reserve_pots`
 * further pots of every ENABLED (mode, tier) with no live pool, optionally
 * excluding the slot being opened.
 *
 * `vaultCushion` is the per-pool rent cushion — `vault::rent_floor()`, the
 * rent-exempt minimum for a zero-data account, read from the cluster rather
 * than pinned. Every reserved pot needs one, because opening that pool will
 * fund pot PLUS the cushion, so the program counts
 * `(pot + cushion) * reserve_pots` per idle enabled slot.
 *
 * IT IS A REQUIRED ARGUMENT, not a defaulted one. This mirror is checked
 * against the program by the parity suite, and a default of zero would let
 * a caller that forgot it reproduce exactly the understatement this
 * parameter was added to fix (2026-09-12 — the cushion landed on chain that
 * morning and this mirror was not updated with it, so the keeper believed a
 * tier was openable that the program then refused).
 */
export function idleTierReserve(
  config: ChainConfigView,
  exclude: { tier: number; mode: number } | null,
  vaultCushion: bigint
): bigint {
  let reserve = 0n;
  for (const mode of MODES) {
    const l = ladder(config, mode);
    for (let t = 0; t < l.openTiers.length; t++) {
      if (exclude !== null && exclude.tier === t && exclude.mode === mode) continue;
      if (l.openTiers[t] && l.activePoolByTier[t] === 0n) {
        reserve += (config.tierPotLamports[t] + vaultCushion) * BigInt(config.treasuryReservePots);
      }
    }
  }
  return reserve;
}

/**
 * Decide the next slot to open. Mirrors `open_pool`, per (mode, tier):
 *
 *   1. the tier is enabled on that ladder (R6; `set_open_tiers` /
 *      `set_hard_open_tiers`);
 *   2. SEQUENTIAL — no live pool in that slot (it clears only at
 *      Paid/Closed; `poolStates` is advisory context for the reason string
 *      — the SLOT is the gate, exactly as on-chain);
 *   3. the slot's cooldown has elapsed (prompt v2 §B.6) — when `now` is
 *      given; a slot still cooling down is treated like a busy one;
 *   4. available = platform balance − refundable entries;
 *      needed = pot + cushion + min + idle-tier reserve (this slot
 *      excluded, and every reserved pot cushioned too);
 *      available ≥ needed.
 *
 * The keeper gate itself is not mirrored: the daemon signs as the keeper,
 * and since 2026-09-07 no other signer may open a pool at all (audit O9b).
 *
 * The D2 pass-sale ceiling is deliberately NOT mirrored here: the keeper
 * lets the program rule on it (a ceiling change between poll and send
 * would make a local check a lie), and a ceiling rejection is loud.
 *
 * `hardPoolStates` is the hard ladder's advisory context; absent, its live
 * pools are described by id alone.
 */
export function nextOpenable(
  config: ChainConfigView,
  platformBalance: bigint,
  poolStates: TierPoolStates,
  now: bigint | undefined,
  vaultCushion: bigint,
  hardPoolStates?: TierPoolStates
): NextOpenable {
  const available = platformBalance - config.platformRefundable;
  let firstShort: { tier: number; mode: number; shortfall: bigint } | null = null;
  let sawBusy = false;
  const cooling: string[] = [];
  const busy: string[] = [];
  const label = (mode: number, t: number) => (mode === 1 ? `hard tier ${t}` : `tier ${t}`);
  // Lowest tier first, easy before hard at the same tier.
  for (let t = 0; t < config.openTiers.length; t++) {
    for (const mode of MODES) {
      const l = ladder(config, mode);
      if (!l.openTiers[t]) continue;
      if (l.activePoolByTier[t] !== 0n) {
        sawBusy = true;
        const states = mode === 1 ? hardPoolStates : poolStates;
        const s = states?.[t];
        busy.push(`${label(mode, t)}: ${s === undefined ? `pool ${l.activePoolByTier[t]}` : s}`);
        continue; // sequential: the prior pool is not yet Paid/Closed
      }
      if (now !== undefined && now < l.tierNextOpenAt[t]) {
        cooling.push(`${label(mode, t)}: cooling down until ${l.tierNextOpenAt[t]}`);
        continue; // the slot is free; the cooldown is not over
      }
      // `open_pool`: pot + cushion + min_platform + idle reserve (this slot
      // excluded). The pool being opened needs its OWN cushion too — the
      // vault is funded with pot + cushion so that draining the pot cannot
      // leave it rent-paying.
      const needed =
        config.tierPotLamports[t] +
        vaultCushion +
        config.treasuryMinPlatformLamports +
        idleTierReserve(config, { tier: t, mode }, vaultCushion);
      if (available >= needed) {
        return {
          tier: t,
          mode,
          reason: `${label(mode, t)} openable: available ${available} >= needed ${needed}`,
          shortfallLamports: 0n,
        };
      }
      if (!firstShort) firstShort = { tier: t, mode, shortfall: needed - available };
    }
  }
  if (firstShort) {
    return {
      tier: null,
      mode: null,
      reason: `${label(firstShort.mode, firstShort.tier)} short by ${firstShort.shortfall} lamports (policy floor)`,
      shortfallLamports: firstShort.shortfall,
    };
  }
  if (sawBusy || cooling.length > 0) {
    return {
      tier: null,
      mode: null,
      reason: `every enabled tier has a live pool or is cooling down (${busy.concat(cooling).join(', ')})`,
      shortfallLamports: 0n,
    };
  }
  return { tier: null, mode: null, reason: 'no tier is enabled', shortfallLamports: 0n };
}
