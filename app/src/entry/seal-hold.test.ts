import { describe, expect, it } from 'vitest';
import { needsAttestation, sealHold } from './seal-hold';

describe('the seal hold beyond the board', () => {
  it('asks nothing of a wallet whose acceptance is on record', () => {
    const input = { attested: true, ageChecked: false, termsChecked: false };
    expect(sealHold(input)).toBeNull();
    expect(needsAttestation(input)).toBe(false);
  });

  it('holds until BOTH statements are confirmed', () => {
    expect(sealHold({ attested: false, ageChecked: false, termsChecked: false })).toBe('statements');
    expect(sealHold({ attested: false, ageChecked: true, termsChecked: false })).toBe('statements');
    expect(sealHold({ attested: false, ageChecked: false, termsChecked: true })).toBe('statements');
    expect(sealHold({ attested: false, ageChecked: true, termsChecked: true })).toBeNull();
  });

  it('routes the seal press through the statement signature only when the statements were confirmed here', () => {
    expect(needsAttestation({ attested: false, ageChecked: true, termsChecked: true })).toBe(true);
    // Not satisfied: the key is held, so no press reaches the wallet at all.
    expect(needsAttestation({ attested: false, ageChecked: true, termsChecked: false })).toBe(false);
  });
});
