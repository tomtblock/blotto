/**
 * INCIDENT 2026-09-09 — the service must register the event layouts itself.
 *
 * `registerBlottoEventLayouts()` was called only by `projection.spec.ts`, never by
 * `src/index.ts`, so the deployed indexer decoded nothing: `backfill: 16 tx,
 * 0 inserted` against a chain holding a real `PoolOpened`. Every other suite
 * registers the layouts by hand, which is exactly how the gap stayed invisible.
 *
 * This spec does NOT call the registrar. It imports the service entry the way
 * `ts-node src/index.ts <command>` does and then decodes the genuine log line of
 * pool 1's `open_pool` (devnet signature 3gF1C9qa…, slot 493895192, 2026-09-06
 * 04:47:22Z), so it passes only if importing the service is enough.
 *
 * Import order matters: `../src/index` is loaded FIRST and must not run `main`
 * (it is guarded by `require.main === module`).
 */

import '../src/index';
import { expect } from 'chai';
import { decodeEventsFromLogs } from '../src/shared';

/** The real `Program data:` line from the pool-1 `OpenPool` transaction (138 bytes). */
const POOL_OPENED_LINE =
  'Program data: LDXF1x89OKqfQPKBrSAnmWRutMDR0bkzw9Pf+aoPotvN0kMR8TAnGQEAAAAAAAAAAADh9QUAAAAAAAAtMQEAAADa5KBqAAAAAA8mYJpb0NC+Ww9YG1M2SffMRdq3W71nD2wtRdRf1jRhep4v/Y40sLlA4fuOkpzAwlkVH+gHPt+8nA8XBBn21Kfr';

/** The real `Program data:` line from the tier-1 `SetTierEconomics` transaction. */
const TIER_ECONOMICS_LINE = 'Program data: WygVY55P+N4AAOH1BQAAAAAAKGvuAAAAAA==';

describe('event layouts are registered by importing the service (incident 2026-09-09)', () => {
  it('decodes a real devnet PoolOpened line without any test-side registration', () => {
    const events = decodeEventsFromLogs([
      'Program 5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17 invoke [1]',
      'Program log: Instruction: OpenPool',
      POOL_OPENED_LINE,
      'Program 5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17 success',
    ]);
    expect(events).to.have.length(1);
    expect(events[0].eventIndex).to.equal(0);
    const e = events[0].event;
    expect(e.event).to.equal('PoolOpened');
    // Pool 1 as it was opened on 2026-09-06: id 1, tier 0, entry 0.1 SOL, the
    // OLD 5.12 SOL pot (opened before the tier table changed — the runbook's
    // "carries the old 5.12 SOL pot"), deadline 2026-09-09 04:47:22Z, 15 s
    // timer (R9). Every value is read back from the chain, not from memory.
    expect(e.pool).to.equal('BifGHwmQqc5ebEMsMJEq4Srg42bVizcZx4wH85rnMae4');
    expect(e.id).to.equal('1');
    expect(e.tier).to.equal(0);
    expect(e.entry_lamports).to.equal('100000000');
    expect(e.pot_lamports).to.equal('5120000000');
    expect(e.fill_deadline).to.equal('1788929242');
    expect(e.timer_seconds).to.equal(15);
  });

  it('decodes a real devnet TierEconomicsSet line too', () => {
    const events = decodeEventsFromLogs([TIER_ECONOMICS_LINE]);
    expect(events).to.have.length(1);
    expect(events[0].event.event).to.equal('TierEconomicsSet');
  });

  it('still treats an unknown discriminator as another program (no throw, no event)', () => {
    expect(decodeEventsFromLogs(['Program data: AAAAAAAAAAAAAA=='])).to.deep.equal([]);
  });
});
