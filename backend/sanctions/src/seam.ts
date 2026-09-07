/**
 * The sanctions-screening seam (Phase 2 — the published-claims register).
 *
 * The rules page promises that "we check the winning wallet against
 * published sanctions LISTS". A list is a membership test, and that one word
 * is what makes the property this module exists for buildable: **a verdict
 * carries whether an address is LISTED and never carries a risk score.**
 * Vendors return scores; every adapter drops them at the boundary; nothing
 * downstream can reach one because none survives. That is how "a risk score
 * can never withhold a payment" is a fact about the types rather than a
 * policy — and `test/verdict.spec.ts` pins the shape so a future field cannot
 * creep in unnoticed.
 *
 * Kept in its own package, apart from `@blotto/detection`, because a
 * sanctions match must share NOTHING with the integrity-flag mechanism
 * (implementation prompt v2, Phase 2): not the log, not the criteria, not the
 * on-chain lever. Two call sites consume it through the same one method:
 *
 *   - the packet service at ENTRY, through `asSanctionsList` — the thin
 *     boolean view its existing `SanctionsList` seam already expects;
 *   - the settlement daemon at RESOLVING (Stage F), which needs the whole
 *     verdict so the published log can name which list matched.
 *
 * Every adapter THROWS on every failure path. What a throw means is decided
 * at the call site, deliberately not here: at entry it refuses the entry
 * (`issuePacket` already does exactly that for the geo gate); at settlement
 * it must hold one payment for a human and never strand the pool.
 */

/** A list we consult. `stub` exists so a test double can say who it is. */
export type SanctionsSource = 'chainalysis' | 'ofac-sdn' | 'opensanctions' | 'stub';

/** One listing that matched the screened address. */
export interface SanctionsMatch {
  readonly source: SanctionsSource;
  /** The programme or dataset the listing belongs to, as the source names it. */
  readonly listName: string;
  /** The listed party, as the source names it. */
  readonly entityName: string;
  /** The source's own identifier for the listing, where it has one. */
  readonly entityId?: string;
  /** The address the source matched — the query, normalised as the source saw it. */
  readonly addressMatched: string;
}

/**
 * The verdict. Note what is NOT here: no score, no risk band, no
 * "exposure", no confidence. `listed` is the only field a decision may read,
 * and `isListed` below is the only decision.
 */
export interface SanctionsVerdict {
  /** The address as screened. */
  readonly address: string;
  /** True iff at least one consulted source lists the address. */
  readonly listed: boolean;
  readonly matches: readonly SanctionsMatch[];
  /** Sources that ANSWERED. A source that threw is in `failed`, not here. */
  readonly consulted: readonly SanctionsSource[];
  /** Sources that were configured and threw. Disclosed, never silently dropped. */
  readonly failed: readonly SanctionsSource[];
  /** ISO-8601, from the injected clock. */
  readonly checkedAt: string;
}

/** Address in, verdict out. Throws when NO configured source could answer. */
export interface SanctionsCheck {
  screen(address: string): Promise<SanctionsVerdict>;
}

/**
 * The one decision. It reads `listed` and nothing else — and it is a
 * function rather than a property access precisely so a test can assert
 * that a verdict decorated with every score-like field a vendor could return
 * still pays when `listed` is false.
 */
export function isListed(verdict: SanctionsVerdict): boolean {
  return verdict.listed === true;
}

/**
 * Thrown by a composite when every configured source failed. A single
 * failed source with another answering is NOT this — it is a verdict with a
 * non-empty `failed` list, which the caller sees and the log records.
 */
export class SanctionsUnavailableError extends Error {
  constructor(readonly failed: readonly SanctionsSource[], causes: readonly Error[]) {
    super(
      `sanctions: no source could answer (${failed.join(', ')}) — ` +
        causes.map((c) => c.message).join(' | ')
    );
    this.name = 'SanctionsUnavailableError';
  }
}

/**
 * The packet service's view. Structurally identical to its `SanctionsList`
 * seam (`backend/packet/src/service.ts`) without importing it, so the
 * dependency runs one way: packet → sanctions, never back. `country` is
 * accepted for signature compatibility and deliberately unused — list
 * membership does not depend on where the request came from.
 */
export function asSanctionsList(check: SanctionsCheck): {
  isSanctioned(wallet: string, country: string): Promise<boolean>;
} {
  return {
    async isSanctioned(wallet: string, _country: string): Promise<boolean> {
      return isListed(await check.screen(wallet));
    },
  };
}

/**
 * Test/dev stub, shaped like `StubGeoLookup`: configured from the
 * constructor or from `SANCTIONS_STUB_LISTED` (comma-separated addresses; an
 * EMPTY string is a valid configuration meaning "nobody is listed"), and it
 * THROWS when neither is present. An unconfigured stub must block, not admit.
 */
export class StubSanctionsCheck implements SanctionsCheck {
  private readonly listed: ReadonlySet<string> | null;

  constructor(
    listed?: readonly string[],
    private readonly now: () => Date = () => new Date()
  ) {
    if (listed !== undefined) {
      this.listed = new Set(listed);
    } else if (process.env.SANCTIONS_STUB_LISTED !== undefined) {
      this.listed = new Set(
        process.env.SANCTIONS_STUB_LISTED.split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      );
    } else {
      this.listed = null;
    }
  }

  async screen(address: string): Promise<SanctionsVerdict> {
    if (this.listed === null) {
      throw new Error('StubSanctionsCheck: no listed set configured (SANCTIONS_STUB_LISTED)');
    }
    const hit = this.listed.has(address);
    return {
      address,
      listed: hit,
      matches: hit
        ? [{ source: 'stub', listName: 'stub', entityName: 'stub', addressMatched: address }]
        : [],
      consulted: ['stub'],
      failed: [],
      checkedAt: this.now().toISOString(),
    };
  }
}
