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
 *   fill_deadline 8 (43) | state 1 (51) | … | mode 1 (849, Phase B)
 *
 * `backend/reveal/test/chain-web3.spec.ts` pins the sizes against
 * `state.rs`; `test/pool-account.spec.ts` pins these offsets.
 */

/**
 * `Pool::SPACE` — 8 discriminator + `Pool::LEN` 842 (`state.rs`). 839 until
 * R7-b appended `min_seats` (2026-09-13), 841 until Phase B appended `mode`
 * (2026-09-24).
 */
export const POOL_SPACE = 850;

/**
 * `Pool::SPACE_V2` — the pre-Phase-B size (849): `min_seats` present, `mode`
 * absent. A pool that predates the field played easy. The pre-R7-b 847 is
 * NOT accepted: a size no reader has met is what the guard exists to refuse.
 */
export const POOL_SPACE_V2 = 849;

/** Byte offset of `Pool.mode` (Phase B): the last byte of the account. */
export const POOL_MODE_OFFSET = 849;

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
}

/**
 * Decode a Pool's head. Refuses by LENGTH first (audit 2026-09-11, G-06):
 * every read is a fixed offset, and an account of the wrong type decodes
 * into plausible numbers rather than into an error.
 */
export function decodePoolHead(data: Uint8Array, what = 'pool'): PoolHead {
  if (data.length !== POOL_SPACE && data.length !== POOL_SPACE_V2) {
    throw new Error(
      `${what} account is ${data.length} bytes; Pool::SPACE is ${POOL_SPACE} ` +
        `(or ${POOL_SPACE_V2} before Phase B) — refusing to decode it`
    );
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const state = POOL_STATE_NAMES[data[POOL_OFFSETS.state]];
  if (state === undefined) {
    throw new Error(`${what}: state byte ${data[POOL_OFFSETS.state]} is not a PoolState`);
  }
  return {
    id: dv.getBigUint64(POOL_OFFSETS.id, true),
    tier: data[POOL_OFFSETS.tier],
    entryLamports: dv.getBigUint64(POOL_OFFSETS.entryLamports, true),
    potLamports: dv.getBigUint64(POOL_OFFSETS.potLamports, true),
    entrants: dv.getUint16(POOL_OFFSETS.entrants, true),
    openedAt: dv.getBigInt64(POOL_OFFSETS.openedAt, true),
    fillDeadline: dv.getBigInt64(POOL_OFFSETS.fillDeadline, true),
    state,
    mode: data.length > POOL_MODE_OFFSET ? data[POOL_MODE_OFFSET] : 0,
  };
}
