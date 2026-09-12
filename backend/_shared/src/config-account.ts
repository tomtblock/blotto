/**
 * The `Config` account's byte layout — ONE TypeScript copy, shared.
 *
 * `Config` is the program's global singleton (`state.rs`), and every
 * off-chain service that wants the live treasury policy has to decode it by
 * fixed byte offset: there is no IDL-driven client in this repository. Until
 * 2026-09-12 the decode lived in `backend/reveal/src/chain-web3.ts` alone, so
 * the indexer's treasury report either grew a second copy of the layout or
 * kept believing the launch constants. It does neither now — both packages
 * consume this module by relative source path, the way they already consume
 * the rest of `_shared`.
 *
 * Pure bytes in, plain values out: no `@solana/web3.js` (this package does
 * not depend on it), no RPC, no I/O. The caller fetches the account; this
 * turns its data into numbers. That keeps the layout testable offline, which
 * is the half that has never been pinned — `Entry`'s offsets have
 * `backend/reveal/test/entry-layout.spec.ts`, `Config`'s had nothing.
 *
 * Every lamport is a bigint. A u64 does not fit in a JS number and a treasury
 * floor rounded by a float is a money bug (CLAUDE.md: no floats in a money
 * path).
 */

import { base58Encode } from './blotto-events';

/** `constants.rs::N_TIERS`. */
export const N_TIERS = 7;

/**
 * `Config::SPACE` since the 2026-09-07 upgrade (`state.rs`): 8 discriminator
 * + `LEN_V1` 372 + `TAIL_LEN` 104.
 */
export const CONFIG_SPACE = 484;

/**
 * `Config::SPACE_V1` — the PRE-MIGRATION size (8 + 372). An account still at
 * this length has not been through `migrate_config`, so the appended tail
 * (keeper, the two timing fields, `tier_next_open_at`) is not there to read.
 * Refused BY NAME rather than decoded partially, so an operator is told to
 * run `admin.ts migrate-config` instead of being handed silent zeroes.
 */
export const CONFIG_SPACE_V1 = 380;

/**
 * The decoded `Config`. Field names follow the Rust struct; the bigint
 * fields are exactly the u64/i64 ones.
 */
export interface ConfigAccountView {
  paused: boolean;
  /** R6/D1 switchboard: which tiers may open pools. */
  openTiers: boolean[];
  /** Per-tier entry price and FIXED pot, as the live Config holds them —
   * NOT the launch tables in `backend/scoring/src/prizes.ts`, which
   * `init_config` seeds from and `set_tier_economics` then moves. */
  tierPriceLamports: bigint[];
  tierPotLamports: bigint[];
  /** Treasury policy (`set_treasury_policy`, and seeded by `init_config`). */
  treasuryReservePots: number;
  treasuryMinPlatformLamports: bigint;
  /** Pots currently locked in live pools' prize vaults. */
  platformReserved: bigint;
  /** Entry payments of pools that can still refund — program-held (R7). */
  platformRefundable: bigint;
  /** The id `open_pool` must be called with next (gapless, monotonic). */
  nextPoolId: bigint;
  /** The tier's LIVE pool id; 0n = none (SEQUENTIAL — the slot clears only
   * when the pool reaches Paid or Closed). */
  activePoolByTier: bigint[];
  /** The only key `open_pool` accepts, base58. */
  keeper: string;
  fillDeadlineSeconds: bigint;
  cooldownSeconds: bigint;
  /** Per tier: the earliest unix second its next pool may open; 0n = never
   * settled a pool. */
  tierNextOpenAt: bigint[];
}

/**
 * Byte offsets from the start of the account, the 8-byte discriminator
 * included. Borsh lays the struct out in declaration order with no padding,
 * so each offset is the running sum of the sizes before it:
 *
 *   disc 8 | admin 32 | entry_signer 32 | settlement_signer 32 |
 *   paused 1 (104) | open_tiers 7 (105) | vault_ceilings 7x8 (112) |
 *   tier_price 7x8 (168) | tier_pot 7x8 (224) | reserve_pots 1 (280) |
 *   min_platform 8 (281) | platform_reserved 8 (289) |
 *   platform_refundable 8 (297) | platform_bump 1 (305) |
 *   kyc_required_above 8 (306) | detection_hard_block 1 (314) |
 *   next_pool_id 8 (315) | active_pool_by_tier 7x8 (323) | bump 1 (379) |
 *   — the 2026-09-07 tail, appended AFTER bump so no offset above moved:
 *   keeper 32 (380) | fill_deadline_seconds 8 (412) |
 *   cooldown_seconds 8 (420) | tier_next_open_at 7x8 (428) — 484 in all.
 *
 * A wrong offset here does not throw: it reads a neighbouring field as if it
 * were the one asked for. `backend/indexer/test/treasury-report.spec.ts`
 * builds an account from these names and reads it back, and the size guards
 * below catch the layout change that would move them all at once.
 */
const OFF = {
  paused: 104,
  openTiers: 105,
  tierPrice: 168,
  tierPot: 224,
  reservePots: 280,
  minPlatform: 281,
  platformReserved: 289,
  platformRefundable: 297,
  nextPoolId: 315,
  activePoolByTier: 323,
  keeper: 380,
  fillDeadlineSeconds: 412,
  cooldownSeconds: 420,
  tierNextOpenAt: 428,
} as const;

/**
 * Decode a fetched `Config` account.
 *
 * Throws — never returns a partial view — when the account is the
 * pre-migration size or any size other than `CONFIG_SPACE`. A treasury floor
 * read out of the wrong bytes is worse than no floor at all, because the
 * caller cannot tell it apart from a real one.
 */
export function decodeConfigAccount(data: Uint8Array): ConfigAccountView {
  if (data.length === CONFIG_SPACE_V1) {
    throw new Error(
      'Config is the pre-migration layout (380 bytes): run `admin.ts migrate-config` ' +
        'before anything else (runbook step 3b)'
    );
  }
  if (data.length !== CONFIG_SPACE) {
    throw new Error(`Config account is ${data.length} bytes; source says ${CONFIG_SPACE}`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u64 = (offset: number): bigint => view.getBigUint64(offset, true);
  const i64 = (offset: number): bigint => view.getBigInt64(offset, true);

  const openTiers: boolean[] = [];
  const tierPriceLamports: bigint[] = [];
  const tierPotLamports: bigint[] = [];
  const activePoolByTier: bigint[] = [];
  const tierNextOpenAt: bigint[] = [];
  for (let t = 0; t < N_TIERS; t++) {
    openTiers.push(data[OFF.openTiers + t] !== 0);
    tierPriceLamports.push(u64(OFF.tierPrice + 8 * t));
    tierPotLamports.push(u64(OFF.tierPot + 8 * t));
    activePoolByTier.push(u64(OFF.activePoolByTier + 8 * t));
    tierNextOpenAt.push(i64(OFF.tierNextOpenAt + 8 * t));
  }

  return {
    paused: data[OFF.paused] !== 0,
    openTiers,
    tierPriceLamports,
    tierPotLamports,
    treasuryReservePots: data[OFF.reservePots],
    treasuryMinPlatformLamports: u64(OFF.minPlatform),
    platformReserved: u64(OFF.platformReserved),
    platformRefundable: u64(OFF.platformRefundable),
    nextPoolId: u64(OFF.nextPoolId),
    activePoolByTier,
    keeper: base58Encode(data.subarray(OFF.keeper, OFF.keeper + 32)),
    fillDeadlineSeconds: i64(OFF.fillDeadlineSeconds),
    cooldownSeconds: i64(OFF.cooldownSeconds),
    tierNextOpenAt,
  };
}

/**
 * The byte offsets, exported for the layout test ONLY. Nothing in a service
 * should address `Config` by number: call `decodeConfigAccount`.
 */
export const CONFIG_OFFSETS = OFF;
