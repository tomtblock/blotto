/**
 * Test-side event encoder — the mirror image of the decoder in
 * `backend/_shared/src/events.ts`.
 *
 * The predecessor's version of this file encoded that product's six events with
 * their exact Borsh layouts. None of those events exist here, so what is carried
 * is the MECHANISM: build a `Program data:` line the way Anchor's `emit!` does,
 * so the ingest path can be exercised end to end without a chain.
 *
 * Phase 2 adds a real layout per event in TECH-ARCH §3.3 and encodes against it
 * here. Until then the test event below is deliberately trivial — the pipeline
 * being tested does not care what an event MEANS, only that it round-trips and
 * that its `(signature, event_index)` is stable.
 */

import { anchorEventDiscriminator, registerEventLayout, type DecodedEvent } from '../src/shared';

/** The name of the fixture event these tests register and emit. */
export const TEST_EVENT = 'TestEvent';

/** The fixture event's decoded shape: one string and one u64-as-bigint. */
export interface TestEvent extends DecodedEvent {
  event: typeof TEST_EVENT;
  pool: string;
  amount: bigint;
}

/**
 * Body layout: `pool` as a 4-byte little-endian length + UTF-8 bytes (Borsh's
 * string encoding), then `amount` as a little-endian u64.
 *
 * Deliberately mirrors Borsh rather than using JSON: the failure this pipeline
 * has to survive is a decoder disagreeing with the on-chain layout by a byte, and
 * a JSON stand-in could not reproduce it.
 */
function encodeBody(pool: string, amount: bigint): Buffer {
  const poolBytes = Buffer.from(pool, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(poolBytes.length);
  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(amount);
  return Buffer.concat([len, poolBytes, amountBytes]);
}

function decodeBody(body: Buffer): TestEvent {
  const len = body.readUInt32LE(0);
  const pool = body.subarray(4, 4 + len).toString('utf8');
  const amount = body.readBigUInt64LE(4 + len);
  return { event: TEST_EVENT, pool, amount };
}

/**
 * Register the fixture event's layout. Idempotent, so a suite that calls it in
 * more than one `before` hook does not trip the duplicate-registration guard.
 */
export function registerTestEvent(): void {
  try {
    registerEventLayout({ name: TEST_EVENT, decode: decodeBody });
  } catch {
    // Already registered by another spec file in the same process.
  }
}

/** Encode one fixture event as raw Anchor event bytes (discriminator + body). */
export function encodeTestEvent(pool: string, amount: bigint): Buffer {
  return Buffer.concat([anchorEventDiscriminator(TEST_EVENT), encodeBody(pool, amount)]);
}

/** Wrap raw event bytes in the `Program data:` log line Anchor emits. */
export function programDataLine(raw: Buffer): string {
  return `Program data: ${raw.toString('base64')}`;
}

/**
 * A `Program data:` line carrying an UNREGISTERED discriminator — another
 * program's event sharing the transaction. Must be skipped without error, and
 * without shifting the `event_index` of anything that follows it.
 */
export function foreignProgramDataLine(): string {
  return programDataLine(
    Buffer.concat([anchorEventDiscriminator('SomeOtherProgramEvent'), Buffer.alloc(8)])
  );
}
