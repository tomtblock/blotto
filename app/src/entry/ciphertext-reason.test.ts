/**
 * The allowlist that stands between the entry service's response body and the
 * sentence a player reads.
 *
 * `EntryServiceError.reason` is a deliberate, narrow exception to the rule
 * that a refusal never carries its reason (PID §8 — see `services.ts`). The
 * exception is only safe because the set is CLOSED: the three strings the
 * ciphertext route actually sends, and nothing else. If an unrecognised value
 * could get through, a compromised or simply changed service could choose
 * which of our sentences a player is shown, and this field would be exactly
 * the channel the rule exists to prevent.
 *
 * So these assert the closing, not the opening. The happy path is one test;
 * the rest are things that must come back null.
 */

import { describe, it, expect } from 'vitest';
import {
  CIPHERTEXT_REASONS,
  EntryServiceError,
  knownCiphertextReason,
} from './services';

describe('knownCiphertextReason', () => {
  it('passes exactly the three reasons the route sends', () => {
    for (const reason of CIPHERTEXT_REASONS) {
      expect(knownCiphertextReason({ error: reason })).toBe(reason);
    }
    expect(CIPHERTEXT_REASONS).toHaveLength(3);
  });

  it('drops anything it does not recognise, including near misses', () => {
    for (const error of [
      'Pool Filled',          // case matters: the wire format is exact
      'pool filled ',         // trailing space
      'pool is full',         // plausible, never sent
      'sanctions',            // the one kind of reason that must NEVER surface
      'unknown pool',         // a real route answer, but a 400 and not a player-facing cause
      '',
    ]) {
      expect(knownCiphertextReason({ error }), error).toBeNull();
    }
  });

  it('drops anything that is not a string in an object', () => {
    for (const body of [
      null,
      undefined,
      'pool filled',                    // the bare string, not the envelope
      ['pool filled'],
      { error: 123 },
      { error: ['pool filled'] },
      { error: { toString: () => 'pool filled' } },
      { message: 'pool filled' },       // right value, wrong key
      {},
    ]) {
      expect(knownCiphertextReason(body), JSON.stringify(body) ?? 'undefined').toBeNull();
    }
  });

  it('ignores an INHERITED error key — the reason must be the body\'s own', () => {
    // Plain member access walks the prototype chain, so before this was
    // closed an `Object.prototype.error` planted anywhere on the page would
    // have been read out of a response that carried no error at all. The set
    // is only closed if the server is the one choosing from it.
    expect(knownCiphertextReason(Object.create({ error: 'pool filled' }))).toBeNull();
  });

  it('ignores a planted Object.prototype.error, even on an empty body', () => {
    const proto = Object.prototype as unknown as { error?: unknown };
    try {
      proto.error = 'pool filled';
      expect(knownCiphertextReason({})).toBeNull();
      // And the real thing still works while the pollution is in place.
      expect(knownCiphertextReason({ error: 'already sealed' })).toBe('already sealed');
    } finally {
      delete proto.error;
    }
  });
});

describe('EntryServiceError carries a reason only where it is safe', () => {
  it('keeps a ciphertext-stage reason', () => {
    expect(new EntryServiceError('ciphertext', 409, 'x', 'pool filled').reason).toBe(
      'pool filled'
    );
  });

  it('DROPS a packet-stage reason, so no caller can leak an eligibility cause', () => {
    // The drop is in the constructor on purpose. A rule enforced by every
    // call site's good manners is a rule that lasts until the next call site.
    for (const reason of CIPHERTEXT_REASONS) {
      expect(new EntryServiceError('packet', 409, 'x', reason).reason, reason).toBeNull();
    }
  });

  it('defaults to no reason at all', () => {
    expect(new EntryServiceError('ciphertext', 500, 'x').reason).toBeNull();
    expect(new EntryServiceError('packet', null, 'x').reason).toBeNull();
  });
});
