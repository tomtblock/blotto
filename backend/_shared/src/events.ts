/**
 * Anchor `emit!` event decoding — the generic half.
 *
 * Carried from the predecessor repository with **every product decoder removed**.
 * What remains is the mechanism, which is product-neutral and was the expensive
 * part to get right: Anchor writes each emitted event as a `Program data: <base64>`
 * log line whose bytes are `sha256("event:<Name>")[..8]` — the 8-byte discriminator
 * — followed by the Borsh-serialized fields in struct-declaration order.
 *
 * ## Where this product's layouts live
 *
 * This module is the mechanism only — an empty registry plus the register and
 * decode plumbing. The blotto_cup layouts are declared in `./blotto-events.ts`,
 * whose idempotent `registerBlottoEventLayouts()` (re-exported from the package
 * index) mirrors the `#[event]` structs in
 * `programs/blotto_cup/src/{events.rs, vrf.rs, pass.rs}` field for field. THAT
 * MODULE, NOT THIS COMMENT, IS THE EVENT LIST — do not duplicate the set here,
 * it will drift. Note it does not yet cover every emitted event:
 * `SanctionsHoldPlaced` and `SanctionsHoldLifted` have no layout. TECH-ARCH
 * §3.3's `Claimed` is not among them either: roadmap 1.8 replaced it with
 * `PrizesPaid` and R10 removed the claim step (prizes are pushed).
 *
 * Registration is per process: any service that calls `decodeEventsFromLogs`
 * must call `registerBlottoEventLayouts()` once at start, or it recognises
 * nothing and leaves its ledger empty.
 *
 * TECH-ARCH §3.3 states the property these events exist to satisfy: **every
 * recomputation input is in the log.** A player who does not trust the operator
 * reconstructs the whole pool from this stream — which is why a decoder that
 * silently drops a field is a correctness bug and not a display bug.
 *
 * Two hard-won constraints carried from the predecessor, both worth reading before
 * writing the first decoder:
 *
 *  1. **There is no committed IDL** (`target/` is gitignored build output), so the
 *     load-bearing contract is the `#[event]` structs in
 *     `programs/blotto_cup/src/`. Mirror them field for field and annotate each
 *     layout with its source struct. A wrong offset or width here is a SILENT
 *     decode bug.
 *  2. **Precision.** On-chain lamport amounts are `u64` and exceed
 *     `Number.MAX_SAFE_INTEGER`. Decode them as `bigint` and never coerce to
 *     `number`. The ingest layer serialises them as strings into the raw-jsonb
 *     ledger and into `NUMERIC` columns. A prize amount rounded by a float is a
 *     payment bug.
 */

import { sha256 } from '@noble/hashes/sha256';

/**
 * 8-byte Anchor event discriminator for `<Name>`: `sha256("event:<Name>")[..8]`.
 *
 * Hashed with `@noble/hashes` rather than Node's `crypto` (2026-09-27, page
 * speed): this module also runs in the browser — the app decodes the
 * register transaction's logs and reads published events — and Node's
 * `crypto` there is a 360 KB polyfill of the whole OpenSSL surface, loaded
 * by every page that reaches this file, to compute one SHA-256. The
 * digest is byte-identical.
 */
export function anchorEventDiscriminator(name: string): Buffer {
  return Buffer.from(sha256(`event:${name}`)).subarray(0, 8);
}

/** The `Program data: ` prefix Anchor writes for each emitted event. */
const PROGRAM_DATA_PREFIX = 'Program data: ';

/**
 * Extract the base64 payloads from a transaction's log lines, preserving order.
 *
 * The ordinal of a payload in this list is its `event_index` — stable across the
 * webhook and the backfill paths, because both observe the same committed log
 * order for a given signature. That stability is what makes
 * `(signature, event_index)` a safe idempotency key.
 */
export function extractProgramData(logs: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of logs) {
    if (line.startsWith(PROGRAM_DATA_PREFIX)) {
      out.push(line.slice(PROGRAM_DATA_PREFIX.length).trim());
    }
  }
  return out;
}

/**
 * A decoded event. Open-ended in Phase 0 because no layouts are registered yet;
 * Phase 2 replaces this with a discriminated union over the §3.3 event set, so
 * that a consumer switching on `event` is checked exhaustively.
 */
export interface DecodedEvent {
  /** The event name, which is also the ledger's `event_name` value. */
  event: string;
  [field: string]: unknown;
}

/** A decoded event tagged with its ordinal within the transaction. */
export interface IndexedEvent {
  eventIndex: number;
  event: DecodedEvent;
}

/**
 * Called when a payload carries a discriminator we RECOGNISE but whose body will
 * not decode — a decoder lagging the deployed layout.
 *
 * This observer exists because that failure is otherwise invisible: the event is
 * dropped, the ledger looks healthy, and the gap is found much later. Wiring it to
 * a counter turns a silent hole into an alert.
 */
export type UndecodableObserver = (eventName: string) => void;

/**
 * One event's decoder, keyed by the hex of its 8-byte discriminator.
 *
 * `body` receives the payload with the discriminator already stripped. Register
 * one with `registerEventLayout`; this product's layouts are declared in
 * `./blotto-events.ts` — see the header of this file.
 */
export interface EventLayout {
  name: string;
  decode(body: Buffer): DecodedEvent;
}

const EVENT_LAYOUTS = new Map<string, EventLayout>();

/**
 * Register one event's layout, keyed by its discriminator.
 *
 * Phase 2 calls this once per event in TECH-ARCH §3.3. Registering the same name
 * twice throws rather than silently replacing: two layouts for one event means
 * one of them is wrong, and the ledger would carry a mix of both.
 */
export function registerEventLayout(layout: EventLayout): void {
  const key = anchorEventDiscriminator(layout.name).toString('hex');
  if (EVENT_LAYOUTS.has(key)) {
    throw new Error(`event layout already registered: ${layout.name}`);
  }
  EVENT_LAYOUTS.set(key, layout);
}

/** The names of every registered event. */
export function registeredEventNames(): string[] {
  return [...EVENT_LAYOUTS.values()].map((l) => l.name);
}

/** Drop every registration. Test helper — production code registers once at import. */
export function clearEventLayouts(): void {
  EVENT_LAYOUTS.clear();
}

/** Look up a layout by the leading 8 discriminator bytes. */
function layoutFor(disc: Buffer): EventLayout | null {
  return EVENT_LAYOUTS.get(disc.toString('hex')) ?? null;
}

/**
 * Decode one raw Anchor event payload (discriminator + Borsh body).
 *
 * Returns `null` for an unrecognised discriminator — that is the normal case for
 * another program's event sharing the transaction, not an error. A RECOGNISED
 * discriminator whose body fails to decode also returns `null`, but notifies
 * `onUndecodable` first, because that one IS a defect.
 */
export function decodeAnchorEvent(
  raw: Buffer,
  onUndecodable?: UndecodableObserver
): DecodedEvent | null {
  if (raw.length < 8) return null;
  const layout = layoutFor(raw.subarray(0, 8));
  if (!layout) return null;
  try {
    return layout.decode(raw.subarray(8));
  } catch {
    onUndecodable?.(layout.name);
    return null;
  }
}

/** Decode one base64 `Program data:` payload. */
export function decodeProgramData(
  base64: string,
  onUndecodable?: UndecodableObserver
): DecodedEvent | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
  return decodeAnchorEvent(raw, onUndecodable);
}

/**
 * Decode every recognised event in a transaction's logs, tagged with its
 * `event_index` — the ordinal of its `Program data` line within the transaction.
 *
 * The index is taken over ALL payloads, not only recognised ones, so it stays
 * stable as decoder coverage grows. Registering a new decoder must never
 * renumber events already in the ledger.
 */
export function decodeEventsFromLogs(
  logs: readonly string[],
  onUndecodable?: UndecodableObserver
): IndexedEvent[] {
  const out: IndexedEvent[] = [];
  const payloads = extractProgramData(logs);
  for (let i = 0; i < payloads.length; i++) {
    const event = decodeProgramData(payloads[i], onUndecodable);
    if (event) {
      out.push({ eventIndex: i, event });
    }
  }
  return out;
}

/**
 * Serialize a decoded event for the raw-jsonb ledger column: every `bigint`
 * becomes a decimal string.
 *
 * JSON cannot represent `bigint`. Stringifying preserves full `u64` precision
 * losslessly; letting it become a `number` would not.
 */
export function eventToJson(event: DecodedEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event)) {
    out[k] = typeof v === 'bigint' ? v.toString() : v;
  }
  return out;
}

/**
 * Rehydrate a decoded event from its ledger JSON.
 *
 * TODO(phase-2): reverse `eventToJson`'s bigint stringification per registered
 * layout. Today every event is `{ event, ...strings }` and there are no layouts,
 * so the identity read is correct; the moment a layout declares a `u64` field,
 * this must widen that field back to `bigint` or downstream arithmetic silently
 * operates on strings.
 */
export function eventFromJson(json: Record<string, unknown>): DecodedEvent {
  const event = json.event;
  if (typeof event !== 'string') {
    throw new Error('ledger row has no event name');
  }
  return { ...json, event };
}
