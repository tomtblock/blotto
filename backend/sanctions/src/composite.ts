/**
 * Several sources, one verdict.
 *
 * Every configured source is asked. `listed` is true if ANY source that
 * answered lists the address — a cross-check can add a match and can never
 * remove one. A source that throws lands in `failed` and the others still
 * decide; only when EVERY source throws does the composite throw
 * (`SanctionsUnavailableError`), because then there is no answer to give and
 * the call site must apply its own fail-closed rule.
 *
 * Order is irrelevant to the answer, so the sources run concurrently. The
 * mirrored OFAC list is what makes this robust: a vendor outage leaves a
 * local, recently refreshed answer standing, and the verdict says so.
 */

import {
  SanctionsUnavailableError,
  type SanctionsCheck,
  type SanctionsMatch,
  type SanctionsSource,
  type SanctionsVerdict,
} from './seam';

export interface NamedSource {
  readonly name: SanctionsSource;
  readonly check: SanctionsCheck;
}

export class CompositeSanctionsCheck implements SanctionsCheck {
  constructor(
    private readonly sources: readonly NamedSource[],
    private readonly now: () => Date = () => new Date()
  ) {
    if (sources.length === 0) throw new Error('CompositeSanctionsCheck: no sources');
  }

  async screen(address: string): Promise<SanctionsVerdict> {
    const settled = await Promise.allSettled(this.sources.map((s) => s.check.screen(address)));
    const consulted: SanctionsSource[] = [];
    const failed: SanctionsSource[] = [];
    const causes: Error[] = [];
    const matches: SanctionsMatch[] = [];
    let listed = false;

    settled.forEach((r, i) => {
      const name = this.sources[i].name;
      if (r.status === 'fulfilled') {
        consulted.push(name);
        if (r.value.listed) listed = true;
        matches.push(...r.value.matches);
      } else {
        failed.push(name);
        causes.push(r.reason instanceof Error ? r.reason : new Error(String(r.reason)));
      }
    });

    if (consulted.length === 0) throw new SanctionsUnavailableError(failed, causes);
    return { address, listed, matches, consulted, failed, checkedAt: this.now().toISOString() };
  }
}
