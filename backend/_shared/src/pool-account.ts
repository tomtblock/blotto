/**
 * The `Pool` account's byte layout, for every reader of it.
 *
 * Until R23 the offsets lived only inside the daemon's `Web3Chain.getPool`.
 * The watcher (`backend/watch`) reads pools too, and a second hand-copied
 * table of offsets is how two readers come to disagree silently about the
 * same bytes — the reason `config-account.ts` exists beside this file. The
 * daemon's full decode (payouts, paid mask, results root) stays in
 * `chain-web3.ts` and reads its head through `decodePoolHead` here.
 *
 * Borsh lays the struct out in declaration order with no padding:
 *
 *   disc 8 | id 8 (8) | tier 1 (16) | entry_lamports 8 (17) |
 *   pot_lamports 8 (25) | entrants 2 (33) | opened_at 8 (35) |
 *   fill_deadline 8 (43) | state 1 (51) | … | min_seats 2 (847, R7-b) |
 *   mode 1 (849, Phase B) | capacity 2 (850) | paid_places 1 (852) |
 *   prize_table 16 (853) — the Ladder (D-E19) — 869 in all.
 *
 * `backend/reveal/test/chain-web3.spec.ts` pins the sizes against
 * `state.rs`; `test/pool-account.spec.ts` pins these offsets.
 */

/**
 * `Pool::SPACE` — 8 discriminator + `Pool::LEN` 861 (`state.rs`). 839 until
 * R7-b appended `min_seats` (2026-09-13), 841 until Phase B appended `mode`
 * (2026-09-24), 842 until the Ladder appended `capacity`, `paid_places` and
 * `prize_table` (D-E19).
 */
export const POOL_SPACE = 869;

/**
 * `Pool::SPACE_V3` — the Phase B size (850): `mode` present, the Ladder
 * tail absent. Every devnet pool until `migrate_pool` runs after the Ladder
 * upgrade; read as what its players entered under — 64 seats, one paid
 * place, the prize pool in whole entries (the program's own migration rule).
 */
export const POOL_SPACE_V3 = 850;

/**
 * `Pool::SPACE_V2` — the pre-Phase-B size (849): `min_seats` present, `mode`
 * absent. A pool that predates the field played easy. The pre-R7-b 847 is
 * NOT accepted: a size no reader has met is what the guard exists to refuse.
 */
export const POOL_SPACE_V2 = 849;

/** Byte offset of `Pool.mode` (Phase B). */
export const POOL_MODE_OFFSET = 849;

/** The Ladder's tail (D-E19). */
export const POOL_LADDER_OFFSETS = {
  minSeats: 847,
  capacity: 850,
  paidPlaces: 852,
  prizeTable: 853,
} as const;

/** The on-chain prize table's width: `[u8; 16]`. */
export const PRIZE_TABLE_BYTES = 16;

/** `PoolState`, in the program's declaration order (the state byte indexes it). */
export const POOL_STATE_NAMES = ['Open', 'Sealed', 'Scored', 'Paid', 'Refunding', 'Closed'] as const;
export type PoolStateName = (typeof POOL_STATE_NAMES)[number];

export const POOL_OFFSETS = {
  id: 8,
  tier: 16,
  entryLamports: 17,
  potLamports: 25,
  entrants: 33,
  openedAt: 35,
  fillDeadline: 43,
  state: 51,
} as const;

/** The fields every reader needs, decoded once. */
export interface PoolHead {
  id: bigint;
  tier: number;
  entryLamports: bigint;
  potLamports: bigint;
  entrants: number;
  openedAt: bigint;
  fillDeadline: bigint;
  state: PoolStateName;
  /** 0 easy, 1 hard; a pre-Phase-B account is easy by construction. */
  mode: number;
  /** The pool's own minimum field (R7-b), copied at open. */
  minSeats: number;
  /** 8, 16, 32 or 64 (D-E19); 64 on a pre-Ladder account. */
  capacity: number;
  /** Places paid. 0 only for a pre-Ladder pool that never played and whose
   * prize pool is not a whole number of entries (it has no table). */
  paidPlaces: number;
  /** The raw `[u8; 16]` table, whole multiples of the entry, rank 1 first,
   * zero-padded. Read it through `@blotto/scoring`'s `prizeTableFromChain`. */
  prizeTable: number[];
  /** True when the account carries the Ladder tail itself; false when the
   * three fields above were reconstructed for a pre-Ladder account. */
  ladderPresent: boolean;
}

/**
 * What the program's `migrate_pool` would write for a pre-Ladder pool
 * (`instructions/migrate.rs::pre_ladder_table`), so a reader in the window
 * between the upgrade and the migration sees the same thing it will see
 * after: 64 seats; one place worth the whole prize pool when that is a whole
 * number of entries (1..=255); otherwise no table.
 */
export function preLadderTable(entryLamports: bigint, potLamports: bigint): { paidPlaces: number; prizeTable: number[] } {
  const prizeTable = new Array<number>(PRIZE_TABLE_BYTES).fill(0);
  if (entryLamports > 0n && potLamports % entryLamports === 0n) {
    const m = potLamports / entryLamports;
    if (m >= 1n && m <= 255n) {
      prizeTable[0] = Number(m);
      return { paidPlaces: 1, prizeTable };
    }
  }
  return { paidPlaces: 0, prizeTable };
}

/**
 * Decode a Pool's head. Refuses by LENGTH first (audit 2026-09-11, G-06):
 * every read is a fixed offset, and an account of the wrong type decodes
 * into plausible numbers rather than into an error.
 */
export function decodePoolHead(data: Uint8Array, what = 'pool'): PoolHead {
  if (data.length !== POOL_SPACE && data.length !== POOL_SPACE_V3 && data.length !== POOL_SPACE_V2) {
    throw new Error(
      `${what} account is ${data.length} bytes; Pool::SPACE is ${POOL_SPACE} ` +
        `(or ${POOL_SPACE_V3} before the Ladder, ${POOL_SPACE_V2} before Phase B) — refusing to decode it`
    );
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const state = POOL_STATE_NAMES[data[POOL_OFFSETS.state]];
  if (state === undefined) {
    throw new Error(`${what}: state byte ${data[POOL_OFFSETS.state]} is not a PoolState`);
  }
  const entryLamports = dv.getBigUint64(POOL_OFFSETS.entryLamports, true);
  const potLamports = dv.getBigUint64(POOL_OFFSETS.potLamports, true);
  const ladderPresent = data.length === POOL_SPACE;
  let capacity = 64;
  let paidPlaces: number;
  let prizeTable: number[];
  if (ladderPresent) {
    capacity = dv.getUint16(POOL_LADDER_OFFSETS.capacity, true);
    paidPlaces = data[POOL_LADDER_OFFSETS.paidPlaces];
    prizeTable = Array.from(
      data.subarray(POOL_LADDER_OFFSETS.prizeTable, POOL_LADDER_OFFSETS.prizeTable + PRIZE_TABLE_BYTES)
    );
  } else {
    ({ paidPlaces, prizeTable } = preLadderTable(entryLamports, potLamports));
  }
  return {
    id: dv.getBigUint64(POOL_OFFSETS.id, true),
    tier: data[POOL_OFFSETS.tier],
    entryLamports,
    potLamports,
    entrants: dv.getUint16(POOL_OFFSETS.entrants, true),
    openedAt: dv.getBigInt64(POOL_OFFSETS.openedAt, true),
    fillDeadline: dv.getBigInt64(POOL_OFFSETS.fillDeadline, true),
    state,
    mode: data.length > POOL_MODE_OFFSET ? data[POOL_MODE_OFFSET] : 0,
    minSeats: dv.getUint16(POOL_LADDER_OFFSETS.minSeats, true),
    capacity,
    paidPlaces,
    prizeTable,
    ladderPresent,
  };
}
