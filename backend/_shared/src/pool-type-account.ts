/**
 * The `PoolType` account (D-E19, the Ladder) — one per (mode, tier,
 * capacity) — for every reader of it: the daemon (which opens pools and must
 * pass the enabled types to `open_pool`), the indexer's read API (the lobby
 * lists pool types, not tiers), the watcher, the admin CLI.
 *
 * Borsh lays the struct out in declaration order with no padding:
 *
 *   disc 8 | mode 1 (8) | tier 1 (9) | capacity 2 (10) | min_seats 2 (12) |
 *   paid_places 1 (14) | prize_table 16 (15) | pot_lamports 8 (31) |
 *   enabled 1 (39) | active_pool 8 (40) | next_open_at 8 (48) | bump 1 (56)
 *   — 57 in all (`PoolType::SPACE`, pinned in `state.rs`).
 *
 * PDA: `[POOL_TYPE_SEED, [mode], [tier], capacity u16 LE]` under the program
 * id. The seed is `ptype`, not `pool_type`: `pool` is already a PDA prefix,
 * and Solana concatenates seeds without length prefixes (threat-tm-401).
 */

/** `PoolType::SPACE` — 8 discriminator + `PoolType::LEN` 49. */
export const POOL_TYPE_SPACE = 57;

/** `state.rs::POOL_TYPE_SEED`. */
export const POOL_TYPE_SEED = 'ptype';

export const POOL_TYPE_OFFSETS = {
  mode: 8,
  tier: 9,
  capacity: 10,
  minSeats: 12,
  paidPlaces: 14,
  prizeTable: 15,
  potLamports: 31,
  enabled: 39,
  activePool: 40,
  nextOpenAt: 48,
  bump: 56,
} as const;

export interface PoolTypeView {
  /** 0 easy, 1 hard. */
  mode: number;
  tier: number;
  /** 8, 16, 32 or 64. */
  capacity: number;
  /** 0 until `set_pool_type_economics` has run. */
  minSeats: number;
  /** 0 until economics are set; `capacity / 4` after. */
  paidPlaces: number;
  /** Raw `[u8; 16]`: whole multiples of the entry, rank 1 first, zero-padded. */
  prizeTable: number[];
  /** The FIXED prize pool the next pool of this type is funded with. */
  potLamports: bigint;
  enabled: boolean;
  /** The live pool's id; 0n = none. */
  activePool: bigint;
  /** Unix seconds; 0n = never settled a pool. */
  nextOpenAt: bigint;
  bump: number;
}

/**
 * Decode a fetched `PoolType` account. Refuses by LENGTH first (audit
 * 2026-09-11, G-06): every read is a fixed offset, and an account of the
 * wrong type decodes into plausible numbers rather than into an error.
 */
export function decodePoolTypeAccount(data: Uint8Array, what = 'pool type'): PoolTypeView {
  if (data.length !== POOL_TYPE_SPACE) {
    throw new Error(
      `${what} account is ${data.length} bytes; PoolType::SPACE is ${POOL_TYPE_SPACE} — refusing to decode it`
    );
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const O = POOL_TYPE_OFFSETS;
  return {
    mode: data[O.mode],
    tier: data[O.tier],
    capacity: dv.getUint16(O.capacity, true),
    minSeats: dv.getUint16(O.minSeats, true),
    paidPlaces: data[O.paidPlaces],
    prizeTable: Array.from(data.subarray(O.prizeTable, O.prizeTable + 16)),
    potLamports: dv.getBigUint64(O.potLamports, true),
    enabled: data[O.enabled] !== 0,
    activePool: dv.getBigUint64(O.activePool, true),
    nextOpenAt: dv.getBigInt64(O.nextOpenAt, true),
    bump: data[O.bump],
  };
}

/**
 * The PDA seeds of a pool type, for whichever web3 library the caller uses
 * to derive the address (`findProgramAddressSync(poolTypeSeeds(…), id)`).
 * Validates the coordinates the program would refuse by name.
 */
export function poolTypeSeeds(mode: number, tier: number, capacity: number): Uint8Array[] {
  if (mode !== 0 && mode !== 1) throw new Error(`unknown mode ${mode}`);
  if (!Number.isInteger(tier) || tier < 0 || tier > 6) throw new Error(`unknown tier ${tier}`);
  if (![8, 16, 32, 64].includes(capacity)) throw new Error(`no pool of ${capacity} players exists`);
  const cap = new Uint8Array(2);
  new DataView(cap.buffer).setUint16(0, capacity, true);
  return [new TextEncoder().encode(POOL_TYPE_SEED), Uint8Array.of(mode), Uint8Array.of(tier), cap];
}

/**
 * Sort pool-type addresses the way `open_pool` and `withdraw_platform`
 * require their remaining accounts: strictly ascending by the 32 raw bytes
 * (the program compares `Pubkey`s, which order lexicographically by byte).
 * Takes the raw bytes so it needs no web3 library.
 */
export function compareAddressBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < 32; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}
