/*
 * D-14 (audit 2026-09-11): both funding buttons swallowed the provider's
 * refusal into the console. With funding switched off in the provider
 * dashboard — its state today — the balance wall's only control was a
 * button that did nothing visible at all.
 *
 * The seam has to ANSWER, or no surface can say anything.
 */
import { describe, expect, it, vi } from 'vitest';
import { openFunding } from './funding';
import { COPY } from '@/copy';

const WALLET = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';

describe('openFunding', () => {
  it('reports the provider REFUSAL instead of hiding it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refusing = async () => {
      throw new Error('Wallet funding is not enabled');
    };
    expect(await openFunding(refusing, WALLET, { method: 'receive' })).toBe('unavailable');
    // Still logged: an operator has a dashboard setting to change.
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('reports a build with no funding seam at all', async () => {
    expect(await openFunding(undefined, WALLET, { method: 'any' })).toBe('no-provider');
  });

  it('reports the window opening, and passes the method through', async () => {
    const calls: Array<[string, unknown]> = [];
    const opening = async (address: string, options?: unknown) => {
      calls.push([address, options]);
    };
    expect(await openFunding(opening, WALLET, { method: 'receive' })).toBe('opened');
    expect(calls).toEqual([[WALLET, { method: 'receive' }]]);
  });

  it('both surfaces have a sentence for the refusal', () => {
    // A missing string would render an empty line, which is the defect
    // again in a different shape.
    expect(COPY.wallet.addSolUnavailable).toMatch(/did not open/);
    expect(COPY.gate.topUpUnavailable).toMatch(/did not open/);
    // Each names a route that does not depend on the provider.
    expect(COPY.wallet.addSolUnavailable).toMatch(/address/i);
    expect(COPY.gate.topUpWalletPage).toBeTruthy();
  });
});
