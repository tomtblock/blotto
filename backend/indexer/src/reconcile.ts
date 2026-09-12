/**
 * The recurring reconciliation walk (audit 2026-09-11, C-11 / C-21).
 *
 * Helius is documented as lossy and this service has always known it, but the
 * only automatic repair ran ONCE, at boot, bounded by the ingest watermark.
 * A bounded walk stops at the highest slot the ledger holds, so the exact
 * failure it needed to catch — a delivery dropped for slot N while slot N+1
 * arrived — is the one it cannot reach: N is below the watermark for ever.
 * The unbounded walk that CAN reach it existed only as a CLI command that
 * nothing scheduled, so a dropped delivery was silently permanent until a
 * human noticed something missing and dispatched a workflow.
 *
 * This is that walk, on a timer, inside the process that serves. Three
 * properties make it affordable to run often:
 *
 *   - it SKIPS what the ledger already has (`skipKnown`), so a healthy run
 *     costs one signature page and no transaction fetches at all. Without
 *     that, a full-history walk issues one `getTransaction` per transaction
 *     the program has ever sent, every time it runs;
 *   - it never overlaps itself — a run still going when the timer fires is
 *     left alone rather than raced, because a walk that takes longer than the
 *     interval would otherwise stack up until the RPC quota ends it;
 *   - it cannot take the service down. A throw is logged and alerted; the
 *     webhook and the read API are unaffected, because this repairs the
 *     ledger rather than serving from it.
 *
 * Split from `index.ts` so the tick is reachable without a timer: the
 * properties above are exactly the ones a test has to drive directly.
 */

import {
  ALERT,
  METRIC,
  type Monitor,
} from './shared';
import { backfillAndRederive, type BackfillRpc } from './backfill';
import type { IngestContext } from './ingest';
import type { EventStore } from './store';

export interface ReconcilerDeps {
  store: EventStore;
  monitor: Monitor;
  ctx: IngestContext;
  /**
   * Built per tick rather than held, so a client that has gone bad with its
   * connection does not poison every future run.
   */
  rpc: () => BackfillRpc;
  log?: (line: string) => void;
  error?: (line: string, err: unknown) => void;
}

export interface ReconcileTick {
  /** One walk. Never throws: a failure is alerted and reported as `failed`. */
  run(): Promise<'walked' | 'skipped-overlap' | 'failed'>;
}

export function makeReconciler(deps: ReconcilerDeps): ReconcileTick {
  const log = deps.log ?? ((l: string) => console.log(l));
  const error = deps.error ?? ((l: string, e: unknown) => console.error(l, e));
  let running = false;

  return {
    async run() {
      if (running) {
        log('indexer: reconciliation still running from the last tick — skipping this one');
        return 'skipped-overlap';
      }
      running = true;
      try {
        // No `minSlot`: reaching BELOW the watermark is the entire point.
        const result = await backfillAndRederive(deps.store, deps.monitor, deps.ctx, deps.rpc(), {
          skipKnown: true,
        });
        deps.monitor.recordEvent(METRIC.indexer.reconciled);
        if (result.inserted > 0) {
          // Healthy is zero, for ever. Anything else says the live feed lost a
          // delivery that this walk has just repaired — worth a metric of its
          // own, because the number over time is how lossy the feed really is.
          deps.monitor.recordEvent(METRIC.indexer.reconciledGap);
          log(
            `indexer: reconciliation repaired a gap — ${result.inserted} event(s) the webhook ` +
              `never delivered, ${result.rederived} replayed`
          );
        }
        return 'walked';
      } catch (err: unknown) {
        error('indexer: reconciliation walk failed (service is serving):', err);
        deps.monitor.alert(ALERT.indexer.reconcileFailed, {
          error: err instanceof Error ? err.message : String(err),
        });
        return 'failed';
      } finally {
        running = false;
      }
    },
  };
}

/**
 * Start the timer. Returns a stop function for a caller that owns a lifecycle;
 * the service itself never calls it.
 *
 * `unref()` so the timer never holds the process open by itself: a service
 * whose only remaining reason to live is its repair job should exit.
 */
export function startReconciler(deps: ReconcilerDeps, everyMs: number): () => void {
  const tick = makeReconciler(deps);
  const handle = setInterval(() => void tick.run(), everyMs);
  handle.unref();
  return () => clearInterval(handle);
}
