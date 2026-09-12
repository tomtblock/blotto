/*
 * Submit → RevealResult (C9): the glue between the entry pipeline and the
 * reveal machine. Resolves — NEVER rejects — with the entry's terminal
 * state:
 *
 *   - confirmed: the landed transaction's own `EntryRegistered` event,
 *     decoded from its log messages (class, seat, pass asset);
 *   - failed(outcome-unreadable): the transaction confirmed but the logs
 *     don't carry the event — the entry IS recorded, the surface renders
 *     the honest recovery copy and NEVER a "try again";
 *   - failed(entry-refused): the entry service ANSWERED and declined,
 *     before anything was signed (audit D-12);
 *   - failed(<classified>): the tx seam's terminal failure, or a service
 *     failure before anything was signed (broadcast: false).
 */

import { makeFailure } from '@/tx/errors';
import type { TxRpc } from '@/tx/tx-rpc';
import type { RevealResult } from '@/reveal/types';
import { entryRegisteredFromLogs } from './register-tx';
import { EntryServiceError, RegisterFailedError } from './services';
import { submitEntry, type EntryServices, type SubmitInput } from './submit';

/**
 * How hard the confirmed transaction's outcome is chased before the screen
 * gives up on reading the class (audit 2026-09-11, D-34).
 *
 * The old code made ONE `getTransaction` call. A node that has confirmed a
 * signature routinely cannot serve the transaction for a beat afterwards —
 * ordinary lag, a node behind the load balancer that has not caught up, a
 * fresh slot — and each of those cost the player the character reveal they
 * had just paid for, replacing it with the "your entry is recorded, the
 * screen is behind" recovery copy. The entry is safe either way; the reveal
 * is not, and it is the moment.
 *
 * PHASE-N-REVIEW: architect-owned retry shape, not a product timer. Six
 * attempts 700 ms apart is ~3.5 s of chasing, which sits inside the
 * takeover's own hold (the reveal's strain beat waits on the outcome
 * anyway) and well inside the tx seam's 90 s confirmation ceiling.
 */
export const OUTCOME_READ_ATTEMPTS = 6;
export const OUTCOME_READ_DELAY_MS = 700;

export interface OutcomeReadOptions {
  attempts?: number;
  delayMs?: number;
  /** Injectable in tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Read the landed transaction's logs, retrying while the cluster has not
 * caught up. Returns null only after every attempt came back empty.
 *
 * A THROWN read and a null read are treated alike on purpose: both mean
 * "no logs yet", and neither tells us anything about the entry, which the
 * chain has already accepted.
 */
async function readLogs(
  rpc: TxRpc,
  signature: string,
  options: OutcomeReadOptions
): Promise<readonly string[] | null> {
  const attempts = Math.max(1, options.attempts ?? OUTCOME_READ_ATTEMPTS);
  const delayMs = options.delayMs ?? OUTCOME_READ_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(delayMs);
    try {
      const tx = await rpc.getTransaction(signature);
      const logs = tx?.logMessages ?? null;
      // An empty array is as unhelpful as null — keep chasing.
      if (logs !== null && logs.length > 0) return logs;
    } catch {
      /* transient read failure — indistinguishable from "not yet" */
    }
  }
  return null;
}

export async function submitForReveal(
  services: EntryServices,
  rpc: TxRpc,
  input: SubmitInput,
  options: OutcomeReadOptions = {}
): Promise<RevealResult> {
  let signature: string;
  try {
    ({ signature } = await submitEntry(services, input));
  } catch (e) {
    if (e instanceof RegisterFailedError) return { kind: 'failed', failure: e.failure };
    /*
     * D-12 (audit 2026-09-11). A service that ANSWERED and declined is not
     * a connection problem, and must not be given the "check your
     * connection and try again" copy with a retry that can only be refused
     * again — a player meets this after the ninety seconds. A service that
     * did not answer, or fell over (5xx), genuinely is one.
     */
    if (e instanceof EntryServiceError) {
      return {
        kind: 'failed',
        failure: makeFailure(
          e.refused ? 'entry-refused' : 'rpc-failure',
          `${e.stage}: ${e.message} (status ${e.status ?? 'none'})`,
          false
        ),
      };
    }
    return {
      kind: 'failed',
      failure: makeFailure(
        'rpc-failure',
        e instanceof Error ? e.message : String(e),
        false
      ),
    };
  }

  // The tx CONFIRMED — everything from here renders as a recovery state,
  // never as "nothing happened" (types.ts's rendering obligation).
  const logs = await readLogs(rpc, signature, options);
  const registered = logs ? entryRegisteredFromLogs(logs, input.player) : null;
  if (!registered) {
    return {
      kind: 'failed',
      failure: makeFailure(
        'outcome-unreadable',
        `confirmed as ${signature} but the EntryRegistered event was not readable`,
        true
      ),
    };
  }
  return {
    kind: 'confirmed',
    outcome: {
      pool: registered.pool,
      class: registered.class,
      entryIndex: registered.entryIndex,
      asset: registered.passAsset,
    },
  };
}
