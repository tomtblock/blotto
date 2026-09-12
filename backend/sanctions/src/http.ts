/**
 * The shared HTTP failure taxonomy for the vendor adapters — lifted from
 * `backend/packet/src/geo-iplocate.ts` so the two vendors and the geo
 * adapter fail the same way for the same reasons:
 *
 *   429            → SanctionsQuotaError, NEVER retried (retrying spends the
 *                    quota; the operator response is "wait", not "debug")
 *   401 / 403      → SanctionsAuthError, NEVER retried (never recovers alone)
 *   5xx / network  → retried, exponential backoff with FULL jitter so
 *                    concurrent screenings that hit one blip do not retry
 *                    in lockstep
 *   other non-2xx  → throw
 *   2xx            → the parsed JSON body
 *
 * THE DEADLINE COVERS THE WHOLE EXCHANGE, BODY INCLUDED (audit 2026-09-11,
 * B-27 / G-07). Until 2026-09-12 the per-attempt timer was cleared in a
 * `finally` the moment `send()` resolved — that is, the moment the response
 * HEAD arrived — and `res.json()` then ran with no bound at all. A vendor
 * that accepts the connection, answers `200` and then stops sending held the
 * promise for ever: at entry that wedges the gate (`issuePacket` awaits the
 * screening), at settlement it wedges the daemon's tick, and both do it
 * silently, because nothing has failed — it simply has not answered. The
 * mirrored OFAC download was bounded end to end for this exact reason on
 * 2026-09-08 (`ofac-sdn.ts`, `download()`); the vendors were not, and this
 * is the same fix in the shared layer. `AbortSignal.timeout` is the whole
 * mechanism: one signal per attempt, live until the body is parsed, so the
 * fetch and the body read are cancelled by the same deadline.
 *
 * A stalled body is classified as a TRANSIENT fault, exactly like a stalled
 * head: same retry, same backoff, same attempt cap. The bound on one
 * `withRetry` call is therefore unchanged in shape — `attempts × timeoutMs`
 * plus backoff — it now just covers the half of the exchange that actually
 * stalls.
 */

export class SanctionsQuotaError extends Error {
  constructor(source: string, status: number) {
    super(`${source}: QUOTA OR RATE LIMIT (HTTP ${status}) — not retried; this is NOT a listing.`);
    this.name = 'SanctionsQuotaError';
  }
}

export class SanctionsAuthError extends Error {
  constructor(source: string, status: number) {
    super(`${source}: CREDENTIAL REFUSED (HTTP ${status}) — check the API key.`);
    this.name = 'SanctionsAuthError';
  }
}

export interface RetryOptions {
  /** Attempts for TRANSIENT faults only. 1 = no retry. Default 3. */
  attempts?: number;
  /** First backoff ceiling in ms; doubles per attempt, with jitter. Default 250. */
  backoffMs?: number;
  /** Deadline for one whole attempt — connect, head AND body. Default 4000. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const DEFAULTS = { attempts: 3, backoffMs: 250, timeoutMs: 4000 };

/** Run `send` under the taxonomy above and return the parsed JSON body. */
export async function withRetry(
  source: string,
  o: RetryOptions,
  send: (signal: AbortSignal) => Promise<Response>
): Promise<unknown> {
  const attempts = o.attempts ?? DEFAULTS.attempts;
  const backoffMs = o.backoffMs ?? DEFAULTS.backoffMs;
  const timeoutMs = o.timeoutMs ?? DEFAULTS.timeoutMs;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = o.random ?? Math.random;
  let lastTransient: Error | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response;
    // One deadline per attempt, and it stays live until the body is parsed:
    // the signal handed to fetch is the same one that aborts `res.json()`.
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      res = await send(signal);
    } catch (e) {
      lastTransient = timeoutError(signal, source, timeoutMs, 'awaiting the response head', e);
      if (attempt < attempts) {
        await sleep(Math.floor(random() * backoffMs * 2 ** (attempt - 1)));
        continue;
      }
      throw new Error(`${source}: unreachable after ${attempt} attempts — ${lastTransient.message}`);
    }

    if (res.status === 429) throw new SanctionsQuotaError(source, res.status);
    if (res.status === 401 || res.status === 403) throw new SanctionsAuthError(source, res.status);
    if (res.status >= 500) {
      lastTransient = new Error(`${source}: HTTP ${res.status}`);
      if (attempt < attempts) {
        await sleep(Math.floor(random() * backoffMs * 2 ** (attempt - 1)));
        continue;
      }
      throw lastTransient;
    }
    if (!res.ok) throw new Error(`${source}: HTTP ${res.status}`);

    try {
      return await res.json();
    } catch (e) {
      // A body that stalls or is cut off mid-transfer. The head arrived, so
      // nothing above this point saw a fault — which is why this branch has
      // to exist rather than let the read run unbounded.
      //
      // Only OUR deadline makes this transient. A body that arrived complete
      // and is simply not JSON is an answer, and asking again spends the
      // quota to be told the same thing — so it propagates as it did before
      // this branch existed.
      if (!signal.aborted) throw e;
      lastTransient = timeoutError(signal, source, timeoutMs, 'reading the response body', e);
      if (attempt < attempts) {
        await sleep(Math.floor(random() * backoffMs * 2 ** (attempt - 1)));
        continue;
      }
      throw new Error(
        `${source}: no readable answer after ${attempt} attempts — ${lastTransient.message}`
      );
    }
  }
  /* istanbul ignore next — the loop always returns or throws. */
  throw lastTransient ?? new Error(`${source}: no answer`);
}

/**
 * Name a fault that our own deadline caused, so an operator can tell "the
 * vendor never answered" from "the vendor answered something we could not
 * read". An abort that is not ours (the caller's own signal, a socket reset)
 * is reported as it arrived.
 */
function timeoutError(
  signal: AbortSignal,
  source: string,
  timeoutMs: number,
  phase: string,
  cause: unknown
): Error {
  if (signal.aborted) {
    return new Error(`${source}: timed out after ${timeoutMs}ms ${phase}`);
  }
  return cause instanceof Error ? cause : new Error(String(cause));
}
