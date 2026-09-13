/**
 * The blotto_cup event decoders (roadmap 2.5) — one layout per `#[event]`
 * struct in `programs/blotto_cup/src/{events.rs, vrf.rs, pass.rs}`.
 *
 * THERE IS NO COMMITTED IDL: these structs are the wire contract, mirrored
 * field-for-field, in declaration order, with Borsh encodings —
 * u16/u64/i64 little-endian, `Vec` length-prefixed u32 LE, `String` as
 * u32-length utf8, `[u8; 32]` raw, `Pubkey` raw 32.  Change an event struct
 * and this file changes in the same commit (events.rs says the same in the
 * other direction).
 *
 * Serialization into the ledger: `u64`/`i64` become DECIMAL STRINGS (they
 * exceed 2^53 — the ingest convention), `[u8; 32]` becomes hex, `Pubkey`
 * becomes base58. The decode suite pins these against binary fixtures
 * captured from the REAL program executing in LiteSVM
 * (`backend/indexer/test/fixtures/lifecycle-logs.json`), so Rust emit and
 * TypeScript decode are checked against each other, not against themselves.
 */

import { registerEventLayout, type DecodedEvent } from './events';

// ---------------------------------------------------------------------------
// base58 (no dependency — this module must stay browser-bundleable)
// ---------------------------------------------------------------------------

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Encode bytes as base58 (the Pubkey display encoding). */
export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

/** Decode base58 back to bytes (inverse of `base58Encode`). */
export function base58Decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    let carry = B58.indexOf(s[i]);
    if (carry < 0) throw new Error(`bad base58 character: ${s[i]}`);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
  return out;
}

// ---------------------------------------------------------------------------
// Borsh reader
// ---------------------------------------------------------------------------

class Reader {
  private o = 0;
  constructor(private readonly b: Buffer) {}

  u8(): number {
    const v = this.b.readUInt8(this.o);
    this.o += 1;
    return v;
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  u16(): number {
    const v = this.b.readUInt16LE(this.o);
    this.o += 2;
    return v;
  }
  u64(): string {
    const v = this.b.readBigUInt64LE(this.o);
    this.o += 8;
    return v.toString();
  }
  i64(): string {
    const v = this.b.readBigInt64LE(this.o);
    this.o += 8;
    return v.toString();
  }
  bytes32hex(): string {
    const v = this.b.subarray(this.o, this.o + 32);
    if (v.length !== 32) throw new Error('short read');
    this.o += 32;
    return v.toString('hex');
  }
  pubkey(): string {
    const v = this.b.subarray(this.o, this.o + 32);
    if (v.length !== 32) throw new Error('short read');
    this.o += 32;
    return base58Encode(new Uint8Array(v));
  }
  vecLen(): number {
    const v = this.b.readUInt32LE(this.o);
    this.o += 4;
    return v;
  }
  string(): string {
    const len = this.vecLen();
    const v = this.b.subarray(this.o, this.o + len);
    if (v.length !== len) throw new Error('short read');
    this.o += len;
    return v.toString('utf8');
  }
  /** Bytes not yet consumed. Used only by layouts that must decode MORE
   * THAN ONE SHAPE of the same event — see `PoolSealed`. Everywhere else a
   * remainder is drift and `end()` refuses it. */
  remaining(): number {
    return this.b.length - this.o;
  }
  /** Every byte must be consumed — a trailing remainder is a layout drift. */
  end(): void {
    if (this.o !== this.b.length) {
      throw new Error(`layout drift: ${this.b.length - this.o} undecoded bytes`);
    }
  }
}

// ---------------------------------------------------------------------------
// Layouts — declaration order mirrors the Rust structs
// ---------------------------------------------------------------------------

/**
 * `events.rs::SealReason`, by discriminant. Borsh writes a payload-free enum
 * as one byte in DECLARATION ORDER, so this array is the wire contract: a
 * variant inserted rather than appended on the Rust side renumbers every
 * one after it, exactly like the error enum. Appended variants land here in
 * the same order; an unknown byte decodes to 'Unknown' rather than throwing,
 * because an indexer that cannot read one field of one event must not stop
 * ingesting the ledger.
 */
const SEAL_REASONS = ['Capacity', 'DeadlineMinFill'] as const;

function layout(name: string, decode: (r: Reader) => Record<string, unknown>) {
  registerEventLayout({
    name,
    decode(body: Buffer): DecodedEvent {
      const r = new Reader(body);
      const fields = decode(r);
      r.end();
      return { event: name, ...fields };
    },
  });
}

/** Idempotent guard: importing twice must not double-register. */
let registered = false;

/** Register every blotto_cup event layout. Call once at service start. */
export function registerBlottoEventLayouts(): void {
  if (registered) return;
  registered = true;

  layout('PoolOpened', (r) => ({
    pool: r.pubkey(),
    id: r.u64(),
    tier: r.u8(),
    entry_lamports: r.u64(),
    // D-A1 revised: the FIXED pot, moved treasury → prize vault at open.
    pot_lamports: r.u64(),
    fill_deadline: r.i64(),
    timer_seconds: r.u8(),
    sealing_pubkey: r.bytes32hex(),
    sealing_secret_hash: r.bytes32hex(),
  }));

  // vrf.rs
  layout('PoolVrfSeeded', (r) => ({
    pool: r.pubkey(),
    randomness_account: r.pubkey(),
    vrf_seed: r.bytes32hex(),
    slot: r.u64(),
  }));

  // pass.rs
  layout('PassCollectionCreated', (r) => ({
    pool: r.pubkey(),
    pass_collection: r.pubkey(),
    name: r.string(),
    uri: r.string(),
  }));

  layout('EntryRegistered', (r) => ({
    pool: r.pubkey(),
    player: r.pubkey(),
    index: r.u16(),
    battles_hash: r.bytes32hex(),
    class: r.u8(),
    slot_hash: r.bytes32hex(),
    pass_asset: r.pubkey(),
    // D-B4: the accepted terms version from the verified entry packet.
    terms_version: r.u16(),
  }));

  // D-E4: `entrants` is the field the pool plays with — 64 at the 64th
  // register, MIN_SEATS..63 when `seal_at_deadline` closed it.
  // TWO SHAPES, ON PURPOSE. `pot_lamports` and `reason` were appended by
  // R7-b (founder instruction 2026-09-12), and appending to an event is a
  // WIRE-FORMAT CHANGE that reaches backwards: every `PoolSealed` already in
  // a ledger — every pool devnet had opened by then — was emitted at the old
  // 34-byte shape,
  // and the indexer replays from the ledger. A decoder that insisted on the
  // new shape would make those events undecodable for ever, which is how a
  // backfill loses the record that a pool ever sealed.
  //
  // So the tail is read only when the bytes are there. An old event reports
  // `reason: null`, which is the honest answer — that pool's seal path was
  // not recorded — rather than a guess dressed as data. `pot_lamports` is
  // null for the same reason and is on the pool account anyway.
  //
  // `reason` is a Borsh enum with no payload, so it is one byte on the wire:
  // 0 = Capacity (the 64th register), 1 = DeadlineMinFill (the deadline
  // passed at or above the pool's floor). Decoded to the NAME — every
  // consumer reads a string, and a raw discriminant would put the enum's
  // declaration order into the indexer and the results page.
  layout('PoolSealed', (r) => {
    const pool = r.pubkey();
    const entrants = r.u16();
    // The tail is a u64 plus a one-byte enum. Fewer bytes than that means a
    // pre-R7-b event; anything in between is drift, and `end()` says so.
    //
    // Written out field by field rather than spread over a shared head:
    // `check-mirrors.py` reads THIS literal to compare the layout against
    // `events.rs`, so a field that only exists inside a spread is a field
    // the drift check cannot see. Property order is source order in JS, so
    // the two reads below still happen in wire order.
    const preR7b = r.remaining() < 9;
    return {
      pool,
      entrants,
      pot_lamports: preR7b ? null : r.u64(),
      reason: preR7b ? null : SEAL_REASONS[r.u8()] ?? 'Unknown',
    };
  });

  // One pool grown to carry `min_seats` (R7-b). Emitted once per pre-R7-b
  // pool by `migrate_pool`; the value is always the floor that pool's
  // players entered under.
  layout('PoolMigrated', (r) => ({
    pool: r.pubkey(),
    min_seats: r.u16(),
  }));

  // (`GoTimerStarted` — the first cut's option-B go-timer — was removed by
  // the 2026-09-07 ruling before any deployment emitted it; no ledger holds
  // one, so its layout is simply gone.)

  // Prompt v2 §B.6: a tier's slot freed (Paid or Closed) and its cooldown
  // started — the "next pool in" countdown's source. `next_open_at` is unix
  // seconds as a decimal string.
  layout('TierSlotFreed', (r) => ({
    tier: r.u8(),
    pool_id: r.u64(),
    next_open_at: r.i64(),
  }));

  layout('PoolSecretRevealed', (r) => ({
    pool: r.pubkey(),
    secret: r.bytes32hex(),
  }));

  layout('ResultsCommitted', (r) => {
    const pool = r.pubkey();
    const root = r.bytes32hex();
    // D3-B: the committed payout list — Vec<Payout { entry_index: u16,
    // amount: u64 }>, seat-sorted, amounts summing to the pot.
    const n = r.vecLen();
    const payouts = [];
    for (let i = 0; i < n; i++) {
      payouts.push({ entry_index: r.u16(), amount: r.u64() });
    }
    return { pool, root, payouts };
  });

  layout('PrizesPaid', (r) => {
    const pool = r.pubkey();
    const n = r.vecLen();
    const payouts = [];
    for (let i = 0; i < n; i++) {
      payouts.push({
        player: r.pubkey(),
        entry_index: r.u16(),
        amount: r.u64(),
        escrowed: r.bool(),
      });
    }
    // One bit per SEAT — u64 on-chain, decoded as a decimal string.
    const paid_mask = r.u64();
    return { pool, payouts, paid_mask };
  });

  layout('EntryFlagged', (r) => ({
    pool: r.pubkey(),
    player: r.pubkey(),
    flagged: r.bool(),
  }));

  layout('EscrowReleased', (r) => ({
    pool: r.pubkey(),
    player: r.pubkey(),
    amount: r.u64(),
  }));

  // Since 2026-09-07 (founder ruling 4) a forfeit moves NOTHING: the share
  // stays in the pool's vault (`destination` = the vault itself) until
  // `NextPlacePaid` pays it to the next eligible place. The treasury report
  // must NOT credit the platform on this event.
  layout('EscrowForfeited', (r) => ({
    pool: r.pubkey(),
    player: r.pubkey(),
    amount: r.u64(),
    destination: r.pubkey(),
  }));

  // One member's portion of a forfeited share (addendum ruling 3): `rank`
  // is the paid player's committed competition rank (1 for a tied
  // first-place member, 1 + k for the next rank after a k-way tie);
  // `amount` is this member's portion — the share over `group_size`, plus
  // the remainder for the lowest entry number. The events for one forfeited
  // share sum to that share exactly.
  layout('NextPlacePaid', (r) => ({
    pool: r.pubkey(),
    from: r.pubkey(),
    to: r.pubkey(),
    rank: r.u8(),
    amount: r.u64(),
    group_size: r.u16(),
  }));

  layout('RefundTriggered', (r) => ({
    pool: r.pubkey(),
    entrants: r.u16(),
  }));

  layout('Refunded', (r) => ({
    pool: r.pubkey(),
    player: r.pubkey(),
    amount: r.u64(),
  }));

  // ---- Sanctions holds (Phase 2 Stage F) -------------------------------
  //
  // The program has emitted both since Stage F and nothing off chain could
  // read either (audit 2026-09-11, D-20 / F-08): no decoder, so no ledger
  // row, so no projection, so `lift_sanctions_hold` — the ONE instruction
  // that can free a held share — could not be aimed from any operator tool,
  // and a held player's own results page could say nothing about why their
  // prize had not moved.
  //
  // Deliberately kept distinct from `EntryFlagged` at every layer, as the
  // program keeps them distinct: a sanctions hold is not an integrity flag,
  // it does not go to the reviewer's desk, and it is not appealable through
  // the review service. They project to different columns for the same
  // reason.
  layout('SanctionsHoldPlaced', (r) => ({
    pool: r.pubkey(),
    player: r.pubkey(),
    placed_at: r.i64(),
  }));

  layout('SanctionsHoldLifted', (r) => ({
    pool: r.pubkey(),
    player: r.pubkey(),
    lifted_at: r.i64(),
  }));

  // ---- Platform treasury (D-A1 revised, master prompt v2 2026-08-27) ----

  layout('PlatformFunded', (r) => ({
    funder: r.pubkey(),
    amount: r.u64(),
    platform_balance: r.u64(),
  }));

  layout('PlatformWithdrawn', (r) => ({
    destination: r.pubkey(),
    amount: r.u64(),
    platform_balance: r.u64(),
  }));

  layout('TierEconomicsSet', (r) => ({
    tier: r.u8(),
    price_lamports: r.u64(),
    pot_lamports: r.u64(),
  }));

  layout('TreasuryPolicySet', (r) => ({
    reserve_pots: r.u8(),
    min_platform_lamports: r.u64(),
  }));

  // Tier enablement (`set_open_tiers`), so the ledger can tell an
  // enabled-idle tier from a disabled one — the PHASE-A1-REVIEW phantom
  // floor in the treasury report ends here. `[bool; N_TIERS]` is seven
  // Borsh bools, one byte each.
  layout('TiersOpened', (r) => ({
    open_tiers: Array.from({ length: 7 }, () => r.bool()),
  }));

  // ---- 2026-09-07 admin events (prompt v2 §A, §B, §G) ----

  layout('KeeperSet', (r) => ({
    keeper: r.pubkey(),
  }));

  layout('PoolTimingSet', (r) => ({
    fill_deadline_seconds: r.i64(),
    cooldown_seconds: r.i64(),
  }));

  layout('ConfigMigrated', (r) => ({
    keeper: r.pubkey(),
    fill_deadline_seconds: r.i64(),
    cooldown_seconds: r.i64(),
  }));
}
