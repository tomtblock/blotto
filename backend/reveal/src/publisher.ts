/**
 * The reveal-bundle publisher seam (roadmap 2.4: "publish plaintext set +
 * salts + timings to Irys" — the timings left with bundle v2, B-31, 2026-09-12).
 *
 * PHASE-2-REVIEW: the Irys implementation needs a funded upload wallet —
 * founder-provisioned alongside the other Phase 5 credentials — so what
 * exists now is the seam plus the in-memory implementation the crank tests
 * run against, and `IrysPublisher` lands in the Phase 5 rehearsal. The
 * BUNDLE format is final here either way: the verify page consumes it, so
 * its shape is part of the recompute contract.
 */

import type { RevealBundle } from './bundle';

export interface BundlePublisher {
  /** Publish the bundle; returns a permanent URI. */
  publish(bundle: RevealBundle): Promise<string>;
}

/** In-memory publisher for tests and the rehearsal harness. */
export class MemoryPublisher implements BundlePublisher {
  readonly published = new Map<string, RevealBundle>();

  async publish(bundle: RevealBundle): Promise<string> {
    const uri = `memory://reveal/${bundle.pool_id}`;
    this.published.set(uri, JSON.parse(JSON.stringify(bundle)));
    return uri;
  }
}
