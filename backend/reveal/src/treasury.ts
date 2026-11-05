/**
 * The treasury policy, off-chain (D-A1 revised, master prompt v2
 * 2026-08-27; per POOL TYPE since the Ladder, D-E19): a PURE function
 * deciding which pool type — (mode, tier, capacity) — if any, the keeper
 * should open next, mirroring `open_pool`'s on-chain gates EXACTLY. The
 * parity suite drives this and `FakeChain.openPool` through the same
 * scenarios and requires them to agree, so a drift between the keeper's
 * intention and the program's decision fails tests rather than burning a
 * transaction per tick.
 *
 * Since D-E19 every slot, cooldown clock and prize pool lives on a
 * `PoolType` account, one per (mode, tier, capacity). Config keeps only the
 * tier-level switches (`open_tiers`, `hard_open_tiers` — R6) and the tier's
 * price. A type is openable when its tier is open for its mode AND the type
 * is enabled, its slot is free, its cooldown has passed, its stored prize
 * pool still equals its table at the tier's current price, and the treasury
 * covers it plus the reserve for every OTHER idle enabled type
 * (`treasury.rs::idle_pool_type_reserve`, mirrored below).
 *
 * Priority: the LOWEST tier first (v2 — the small tiers are the revenue
 * engine that funds the ladder; a big prize pool never queue-jumps the pool
 * most players are waiting for); at one tier the EASY ladder before the hard
 * one; within a ladder the SMALLEST pool first.
 *
 * All lamport arithmetic is bigint; nothing here touches a float.
 */

import type { ChainConfigView, ChainPoolTypeView, PoolStateName } from './chain';

/** A pool type's coordinates — what its PDA is derived from. */
export interface PoolTypeCoordinates {
  mode: number;
  tier: number;
  capacity: number;
}

/** A stable key for a pool type (`mode:tier:capacity`). */
export function poolTypeKey(t: PoolTypeCoordinates): string {
  return `${t.mode}:${t.tier}:${t.capacity}`;
}

/** `Config::open_tiers_for`: the tier switch of the type's own ladder.
 * Anything not hard reads as easy, as on-chain (callers validate the mode). */
export function openTiersFor(
  config: Pick<ChainConfigView, 'openTiers' | 'hardOpenTiers'>,
  mode: number
): boolean[] {
  return mode === 1 ? config.hardOpenTiers : config.openTiers;
}

/** `PoolType::table_value`: Σ multiple × price, exact, in lamports — the
 * comparison partner of a type's stored `pot_lamports`. */
export function tableValue(prizeTable: readonly number[], priceLamports: bigint): bigint {
  let total = 0n;
  for (const m of prizeTable) total += BigInt(m) * priceLamports;
  return total;
}

export interface NextOpenable {
  /** The pool type to open, or nulls when nothing may open this tick. */
  tier: number | null;
  /** Its ladder (0 easy, 1 hard); null with `tier`. */
  mode: number | null;
  /** Its size (8, 16, 32 or 64); null with `tier`. */
  capacity: number | null;
  /** Why (for the log line and the treasury report), always set. */
  reason: string;
  /** For a 'short' verdict: lamports missing for the FIRST blocked type
   * (in priority order), so the report can say "short by X SOL". 0n
   * otherwise. */
  shortfallLamports: bigint;
}

/**
 * The on-chain idle reserve (`idle_pool_type_reserve`): `reserve_pots`
 * further prize pools — each with its vault cushion — of every ENABLED pool
 * type whose tier is open for its mode and whose slot is empty, optionally
 * excluding one (the type being opened, which the program receives
 * separately and refuses to see in the list).
 *
 * `poolTypes` may hold disabled types; they are skipped, exactly as the
 * program never receives them (its list must be the enabled set, no more,
 * no fewer — `Config.enabled_pool_types` proves the count).
 *
 * `vaultCushion` is the per-pool rent cushion — `vault::rent_floor()`, the
 * rent-exempt minimum for a zero-data account, read from the cluster rather
 * than pinned. Every reserved prize pool needs one, because opening that
 * pool will fund prize pool PLUS the cushion.
 *
 * IT IS A REQUIRED ARGUMENT, not a defaulted one. This mirror is checked
 * against the program by the parity suite, and a default of zero would let
 * a caller that forgot it reproduce exactly the understatement this
 * parameter was added to fix (2026-09-12 — the cushion landed on chain that
 * morning and this mirror was not updated with it, so the keeper believed a
 * tier was openable that the program then refused).
 */
export function idlePoolTypeReserve(
  config: ChainConfigView,
  poolTypes: readonly ChainPoolTypeView[],
  exclude: PoolTypeCoordinates | null,
  vaultCushion: bigint
): bigint {
  const skip = exclude === null ? null : poolTypeKey(exclude);
  let reserve = 0n;
  for (const t of poolTypes) {
    if (!t.enabled) continue;
    if (skip !== null && poolTypeKey(t) === skip) continue;
    if (openTiersFor(config, t.mode)[t.tier] && t.activePool === 0n) {
      reserve += (t.potLamports + vaultCushion) * BigInt(config.treasuryReservePots);
    }
  }
  return reserve;
}

/** Human-readable name of a pool type for log lines and hold reasons. */
export function poolTypeLabel(t: PoolTypeCoordinates): string {
  return `${t.mode === 1 ? 'hard' : 'easy'} tier ${t.tier} cap ${t.capacity}`;
}

/** Advisory context for `nextOpenable`'s reason string. */
export interface NextOpenableOptions {
  /** What the keeper knows about live pools, by id — busy types are named
   * with their pool's state when it is here, by id otherwise. */
  poolStates?: ReadonlyMap<bigint, PoolStateName>;
  /** Types (`poolTypeKey`) not to offer again this tick — one whose open
   * the program refused for a reason this mirror does not model (the D2
   * ceiling) must not starve every type behind it. */
  skip?: ReadonlySet<string>;
}

/**
 * Decide the next pool type to open. Mirrors `open_pool`, per pool type:
 *
 *   1. the tier is open for the type's mode (R6; `set_open_tiers` /
 *      `set_hard_open_tiers`) AND the type is enabled (D-E19);
 *   2. SEQUENTIAL — no live pool in the type's slot (it clears only at
 *      Paid/Closed; `poolStates` is advisory context for the reason string
 *      — the SLOT is the gate, exactly as on-chain);
 *   3. the type's cooldown has elapsed (prompt v2 §B.6) — when `now` is
 *      given; a type still cooling down is treated like a busy one;
 *   4. its economics are set and CURRENT: Σ table × the tier's price equals
 *      its stored prize pool (`PoolTypeEconomicsStale` otherwise);
 *   5. available = platform balance − refundable entries;
 *      needed = prize pool + cushion + min + idle reserve (this type
 *      excluded, and every reserved prize pool cushioned too);
 *      available ≥ needed.
 *
 * The keeper gate itself is not mirrored: the daemon signs as the keeper,
 * and since 2026-09-07 no other signer may open a pool at all (audit O9b).
 *
 * The D2 pass-sale ceiling (price × capacity) is deliberately NOT mirrored
 * here: the keeper lets the program rule on it (a ceiling change between
 * poll and send would make a local check a lie), and a ceiling rejection is
 * loud — and, since one refused type is `skip`ped for the rest of the tick,
 * it no longer holds up the types behind it.
 */
export function nextOpenable(
  config: ChainConfigView,
  poolTypes: readonly ChainPoolTypeView[],
  platformBalance: bigint,
  now: bigint | undefined,
  vaultCushion: bigint,
  options: NextOpenableOptions = {}
): NextOpenable {
  const available = platformBalance - config.platformRefundable;
  let firstShort: { t: ChainPoolTypeView; shortfall: bigint } | null = null;
  const busy: string[] = [];
  const cooling: string[] = [];
  const blocked: string[] = [];
  // PHASE-D-E19-REVIEW: within a tier and mode the smallest pool opens first
  // (the cheapest prize pool, and the field that fills soonest). With
  // reserve_pots = 1 the order cannot change WHICH types open — the reserve
  // makes the cascade exact — only the order of their ids.
  const candidates = poolTypes
    .filter((t) => t.enabled && openTiersFor(config, t.mode)[t.tier] === true)
    .sort((a, b) => a.tier - b.tier || a.mode - b.mode || a.capacity - b.capacity);
  for (const t of candidates) {
    const label = poolTypeLabel(t);
    if (options.skip?.has(poolTypeKey(t))) {
      blocked.push(`${label}: refused earlier this tick`);
      continue;
    }
    if (t.activePool !== 0n) {
      const s = options.poolStates?.get(t.activePool);
      busy.push(`${label}: ${s === undefined ? `pool ${t.activePool}` : s}`);
      continue; // sequential: the prior pool is not yet Paid/Closed
    }
    if (now !== undefined && now < t.nextOpenAt) {
      cooling.push(`${label}: cooling down until ${t.nextOpenAt}`);
      continue; // the slot is free; the cooldown is not over
    }
    if (!(t.paidPlaces > 0 && t.potLamports > 0n)) {
      blocked.push(`${label}: economics unset`);
      continue;
    }
    const price = config.tierPriceLamports[t.tier];
    if (tableValue(t.prizeTable, price) !== t.potLamports) {
      // A price moved under a published table: the program refuses until
      // `set_pool_type_economics` restates it. A founder action, not ours.
      blocked.push(`${label}: economics stale at the tier's current price`);
      continue;
    }
    // `open_pool`: prize pool + cushion + min_platform + idle reserve (this
    // type excluded). The pool being opened needs its OWN cushion too — the
    // vault is funded with prize pool + cushion so that draining the prize
    // pool cannot leave it rent-paying.
    const needed =
      t.potLamports +
      vaultCushion +
      config.treasuryMinPlatformLamports +
      idlePoolTypeReserve(config, poolTypes, t, vaultCushion);
    if (available >= needed) {
      return {
        tier: t.tier,
        mode: t.mode,
        capacity: t.capacity,
        reason: `${label} openable: available ${available} >= needed ${needed}`,
        shortfallLamports: 0n,
      };
    }
    if (!firstShort) firstShort = { t, shortfall: needed - available };
  }
  const none = { tier: null, mode: null, capacity: null } as const;
  if (firstShort) {
    return {
      ...none,
      reason: `${poolTypeLabel(firstShort.t)} short by ${firstShort.shortfall} lamports (policy floor)`,
      shortfallLamports: firstShort.shortfall,
    };
  }
  const waiting = busy.concat(cooling, blocked);
  if (waiting.length > 0) {
    return {
      ...none,
      reason: `every enabled pool type on an open tier has a live pool, is cooling down or is blocked (${waiting.join(', ')})`,
      shortfallLamports: 0n,
    };
  }
  return {
    ...none,
    reason: 'no pool type is enabled on an open tier',
    shortfallLamports: 0n,
  };
}
