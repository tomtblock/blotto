/*
 * Everything the watcher fetches, and nothing it decides. Each function
 * returns what it saw — including a failure, as data — and never throws for
 * a source that is down: a down source is the thing being watched.
 */

import { request } from 'https';
import { decodeConfigAccount } from '../../_shared/src/config-account';
import type { ChainPool, ChainSnapshot, Probe, RpcProbe } from './checks';
import {
  CLOCK_SYSVAR,
  configPda,
  decodeClockUnix,
  decodePool,
  getAccounts,
  passCollectionPda,
  poolPda,
  RpcError,
  rpcCall,
  vaultPda,
  type Fetch,
} from './solana';

/** GET a URL; any answer is recorded with its status and up to `maxBytes` of body. */
export async function httpProbe(
  url: string,
  timeoutMs: number,
  fetchImpl: Fetch = fetch,
  maxBytes = 65_536
): Promise<Probe> {
  try {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': 'blotto-watch' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.text()).slice(0, maxBytes);
    return { status: res.status, body, error: null };
  } catch (e) {
    return { status: null, body: '', error: describeError(e) };
  }
}

/**
 * GET over IPv4 only. The indexer's webhook receiver is reached by the RPC
 * provider over IPv4; a probe that silently took IPv6 could pass while the
 * provider's deliveries fail.
 */
export function httpProbeIpv4(url: string, timeoutMs: number): Promise<Probe> {
  return new Promise((resolve) => {
    const req = request(url, { method: 'GET', family: 4, timeout: timeoutMs, headers: { 'user-agent': 'blotto-watch' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        if (body.length < 65_536) body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? null, body, error: null }));
    });
    req.on('timeout', () => req.destroy(new Error(`timed out after ${timeoutMs} ms`)));
    req.on('error', (e) => resolve({ status: null, body: '', error: describeError(e) }));
    req.end();
  });
}

function describeError(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  const cause = err.cause?.code ?? err.cause?.message;
  return cause ? `${err.message} (${cause})` : err.message;
}

/**
 * Read Config, the chain clock, and every live pool with its vault and pass
 * collection — two `getMultipleAccounts` calls. Throws on any RPC failure:
 * a half-read snapshot would make the pool checks guess.
 */
export async function readChain(rpcUrl: string, timeoutMs: number, fetchImpl: Fetch = fetch): Promise<ChainSnapshot> {
  const opts = { fetchImpl, timeoutMs };
  const [cfgAcc, clockAcc] = await getAccounts(rpcUrl, [configPda(), CLOCK_SYSVAR], opts);
  if (!cfgAcc) throw new Error('the Config account was not found');
  if (!clockAcc) throw new Error('the Clock sysvar was not returned');
  const config = decodeConfigAccount(cfgAcc.data);
  const nowUnix = decodeClockUnix(clockAcc.data);

  const ids = [...new Set([...config.activePoolByTier, ...config.hardActivePoolByTier].filter((id) => id !== 0n))];
  const addrs = ids.map((id) => {
    const pool = poolPda(id);
    return { id, pool, vault: vaultPda(id), collection: passCollectionPda(pool) };
  });
  const accounts = await getAccounts(
    rpcUrl,
    addrs.flatMap((a) => [a.pool, a.vault, a.collection]),
    opts
  );
  const pools: ChainPool[] = [];
  addrs.forEach((a, i) => {
    const [poolAcc, vaultAcc, collectionAcc] = accounts.slice(i * 3, i * 3 + 3);
    if (!poolAcc) throw new Error(`pool ${a.id} is active in Config but its account was not found`);
    pools.push({
      address: a.pool,
      pool: decodePool(poolAcc.data),
      hasPassCollection: collectionAcc !== null,
      vaultLamports: vaultAcc ? vaultAcc.lamports : null,
    });
  });
  return { nowUnix, config, pools };
}

/**
 * One account read against the services' own provider: `getAccountInfo` of
 * the Clock sysvar, which always exists. An account read, because account
 * reads are what the services live on. The URL carries the API key: it is
 * used here and nowhere else — not in a log line, not in a fact.
 *
 * Until 2026-10-17 this was one `getSlot`. On 2026-10-16 Helius's "Devnet
 * Account Data Degraded Availability" failed every daemon tick for 36 minutes
 * ("failed to get info about account Sysv…: 500 Internal Server Error") and
 * the indexer's chain reads with it, while `getSlot` kept answering: the
 * provider check stayed green and the founders got the consequences as
 * three unrelated-looking alerts instead of their cause.
 */
export async function probeProvider(url: string, timeoutMs: number, fetchImpl: Fetch = fetch): Promise<RpcProbe> {
  try {
    const r = await rpcCall<{ value?: unknown } | null>(
      url,
      'getAccountInfo',
      [CLOCK_SYSVAR, { encoding: 'base64', commitment: 'confirmed' }],
      { fetchImpl, timeoutMs }
    );
    // A provider that answers 200 with no account has failed the read all
    // the same: the Clock sysvar is never absent.
    if (r === null || r.value === null || r.value === undefined) {
      return { ok: false, status: 200, body: '', error: 'answered without the Clock sysvar, which always exists' };
    }
    return { ok: true, status: 200, body: '', error: null };
  } catch (e) {
    if (e instanceof RpcError) {
      // A transport failure (no status) or a JSON-RPC error inside a 200:
      // the message is the only cause there is. An HTTP refusal speaks for
      // itself through its status and body.
      const say = e.status === null || e.status === 200;
      return { ok: false, status: e.status, body: e.body.slice(0, 2000), error: say ? e.message.split(url).join('<provider>') : null };
    }
    return { ok: false, status: null, body: '', error: 'probe failed' };
  }
}

/** A service's private metrics, over Fly's private network. Null body = unreachable. */
export async function scrapeMetrics(
  app: string,
  port: number,
  timeoutMs: number,
  fetchImpl: Fetch = fetch
): Promise<{ text: string | null; error: string | null }> {
  // Read whole (up to 8 MB): a truncated exposition would drop counters, and
  // a counter that vanishes and reappears would read as a fresh alert.
  const p = await httpProbe(`http://${app}.internal:${port}/metrics`, timeoutMs, fetchImpl, 8 * 1024 * 1024);
  if (p.status === 200 && p.body.length >= 8 * 1024 * 1024) return { text: null, error: 'exposition larger than 8 MB' };
  if (p.status === 200) return { text: p.body, error: null };
  return { text: null, error: p.status === null ? (p.error ?? 'no answer') : `HTTP ${p.status}` };
}
