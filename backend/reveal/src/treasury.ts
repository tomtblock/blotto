/**
 * The treasury policy, off-chain (D-A1 revised, master prompt v2
 * 2026-08-27): a PURE function deciding which tier — if any — the keeper
 * should open next, mirroring `open_pool`'s on-chain gates EXACTLY. The
 * parity suite drives this and `FakeChain.openPool` through the same
 * scenarios and requires them to agree, so a drift between the keeper's
 * intention and the program's decision fails tests rather than burning a
 * transaction per tick.
 *
 * Priority: the LOWEST openable tier first (v2 — the small tiers are the
 * revenue engine that funds the ladder; a big pot never queue-jumps the
 * pool most players are waiting for).
 *
 * All lamport arithmetic is bigint; nothing here touches a float.
 */

import type { ChainConfigView, PoolStateName } from './chain';

/** What the keeper knows about each tier's live pool ('none' if no slot). */
export type TierPoolStates = (PoolStateName | 'none')[];

export interface NextOpenable {
  /** Tier index to open, or null when nothing may open this tick. */
  tier: number | null;
  /** Why (for the log line and the treasury report), always set. */
  reason: string;
  /** For a 'short' verdict: lamports missing for the FIRST blocked tier
   * (lowest first), so the report can say "short by X SOL". 0n otherwise. */
  shortfallLamports: bigint;
}

/**
 * The on-chain idle-tier reserve (`idle_tier_reserve`): `reserve_pots`
 * further pots of every ENABLED tier with no live pool, optionally
 * excluding the tier being opened.
 *
 * `vaultCushion` is the per-pool rent cushion — `vault::rent_floor()`, the
 * rent-exempt minimum for a zero-data account, read from the cluster rather
 * than pinned. Every reserved pot needs one, because opening that pool will
 * fund pot PLUS the cushion, so the program counts
 * `(pot + cushion) * reserve_pots` per idle enabled tier.
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
  excludeTier: number | null,
  vaultCushion: bigint
): bigint {
  let reserve = 0n;
  for (let t = 0; t < config.openTiers.length; t++) {
    if (t === excludeTier) continue;
    if (config.openTiers[t] && config.activePoolByTier[t] === 0n) {
      reserve += (config.tierPotLamports[t] + vaultCushion) * BigInt(config.treasuryReservePots);
    }
  }
  return reserve;
}

/**
 * Decide the next tier to open. Mirrors `open_pool`:
 *
 *   1. the tier is enabled (R6);
 *   2. SEQUENTIAL — no live pool in the tier (`active_pool_by_tier` clears
 *      only at Paid/Closed; `poolStates` is advisory context for the
 *      reason string — the SLOT is the gate, exactly as on-chain);
 *   3. the tier's cooldown has elapsed (`tier_next_open_at`, prompt v2
 *      §B.6) — when `now` is given; a tier still cooling down is treated
 *      like a busy one (the slot is free, the clock is not);
 *   4. available = platform balance − refundable entries;
 *      needed = pot + cushion + min + idle-tier reserve (this tier
 *      excluded, and every reserved pot cushioned too);
 *      available ≥ needed.
 *
 * The keeper gate itself is not mirrored: the daemon signs as the keeper,
 * and since 2026-09-07 no other signer may open a pool at all (audit O9b).
 *
 * The D2 pass-sale ceiling is deliberately NOT mirrored here: the keeper
 * lets the program rule on it (a ceiling change between poll and send
 * would make a local check a lie), and a ceiling rejection is loud.
 */
export function nextOpenable(
  config: ChainConfigView,
  platformBalance: bigint,
  poolStates: TierPoolStates,
  now: bigint | undefined,
  vaultCushion: bigint
): NextOpenable {
  const available = platformBalance - config.platformRefundable;
  let firstShort: { tier: number; shortfall: bigint } | null = null;
  let sawBusy = false;
  const cooling: string[] = [];
  for (let t = 0; t < config.openTiers.length; t++) {
    if (!config.openTiers[t]) continue;
    if (config.activePoolByTier[t] !== 0n) {
      sawBusy = true;
      continue; // sequential: the prior pool is not yet Paid/Closed
    }
    if (now !== undefined && now < config.tierNextOpenAt[t]) {
      cooling.push(`tier ${t}: cooling down until ${config.tierNextOpenAt[t]}`);
      continue; // the slot is free; the cooldown is not over
    }
    // `open_pool`: pot + cushion + min_platform + idle reserve (this tier
    // excluded). The pool being opened needs its OWN cushion too — the
    // vault is funded with pot + cushion so that draining the pot cannot
    // leave it rent-paying.
    const needed =
      config.tierPotLamports[t] +
      vaultCushion +
      config.treasuryMinPlatformLamports +
      idleTierReserve(config, t, vaultCushion);
    if (available >= needed) {
      return {
        tier: t,
        reason: `tier ${t} openable: available ${available} >= needed ${needed}`,
        shortfallLamports: 0n,
      };
    }
    if (!firstShort) firstShort = { tier: t, shortfall: needed - available };
  }
  if (firstShort) {
    return {
      tier: null,
      reason: `tier ${firstShort.tier} short by ${firstShort.shortfall} lamports (policy floor)`,
      shortfallLamports: firstShort.shortfall,
    };
  }
  if (sawBusy || cooling.length > 0) {
    const busy = poolStates
      .map((s, t) => (config.activePoolByTier[t] !== 0n ? `tier ${t}: ${s}` : null))
      .filter((x): x is string => x !== null)
      .concat(cooling)
      .join(', ');
    return {
      tier: null,
      reason: `every enabled tier has a live pool or is cooling down (${busy})`,
      shortfallLamports: 0n,
    };
  }
  return { tier: null, reason: 'no tier is enabled', shortfallLamports: 0n };
}
