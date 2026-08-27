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
 *   - failed(<classified>): the tx seam's terminal failure, or a service
 *     failure before anything was signed (broadcast: false).
 */

import { makeFailure } from '@/tx/errors';
import type { TxRpc } from '@/tx/tx-rpc';
import type { RevealResult } from '@/reveal/types';
import { entryRegisteredFromLogs } from './register-tx';
import { RegisterFailedError } from './services';
import { submitEntry, type EntryServices, type SubmitInput } from './submit';

export async function submitForReveal(
  services: EntryServices,
  rpc: TxRpc,
  input: SubmitInput
): Promise<RevealResult> {
  let signature: string;
  try {
    ({ signature } = await submitEntry(services, input));
  } catch (e) {
    if (e instanceof RegisterFailedError) return { kind: 'failed', failure: e.failure };
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
  let logs: readonly string[] | null = null;
  try {
    const tx = await rpc.getTransaction(signature);
    logs = tx?.logMessages ?? null;
  } catch {
    logs = null;
  }
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
