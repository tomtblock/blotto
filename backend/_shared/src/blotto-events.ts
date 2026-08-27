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
  }));

  layout('PoolSealed', (r) => ({
    pool: r.pubkey(),
    entrants: r.u16(),
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

  layout('EscrowForfeited', (r) => ({
    pool: r.pubkey(),
    player: r.pubkey(),
    amount: r.u64(),
    destination: r.pubkey(),
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
}
