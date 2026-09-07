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
  /** Per-request timeout. Default 4000. */
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await send(controller.signal);
    } catch (e) {
      lastTransient = e instanceof Error ? e : new Error(String(e));
      if (attempt < attempts) {
        await sleep(Math.floor(random() * backoffMs * 2 ** (attempt - 1)));
        continue;
      }
      throw new Error(`${source}: unreachable after ${attempt} attempts — ${lastTransient.message}`);
    } finally {
      clearTimeout(timer);
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
    return res.json();
  }
  /* istanbul ignore next — the loop always returns or throws. */
  throw lastTransient ?? new Error(`${source}: no answer`);
}
