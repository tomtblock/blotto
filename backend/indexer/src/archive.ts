/**
 * E3 — the pool archive's ingest path (proposal E1 §4): a verified cache
 * of the published Irys bundle, with checkable provenance.
 *
 *   fetch bundle by URI → rebuild the Merkle root LOCALLY from
 *   bundle.results[] (leaves in the array's published order — the crank
 *   writes results rank-asc, index-asc, which IS the leaf order) →
 *   compare to the on-chain `results_root` (from the ResultsCommitted
 *   event via the pools projection) → persist rankings ONLY on match.
 *
 * The Merkle check is the trust anchor, which is why URI DISCOVERY needs
 * no trust at all: a wrong, stale or forged URI produces a root mismatch
 * and a loud `root_matches = false` row, never a served ranking. Live
 * pools announce their URI through the webhook (the daemon posts it
 * after publishing); the backfill discovers URIs by the `Blotto-Pool`
 * tag the publisher stamps on every upload. Both paths land HERE — one
 * ingest function, so the two can never drift (§4.4).
 *
 * Tree code is imported from the scoring package AS-IS (leafBytes +
 * merkleRoot — the same functions the crank used to commit the root);
 * reimplementing it would be a second implementation to get wrong.
 */

import { leafBytes, merkleRoot } from '../../scoring/src/merkle';
import { base58Decode } from './shared';
import type { Queryable } from './shared';

/** One published ranking row, as carried in bundle.results[]. */
export interface BundleResultRow {
  index: number;
  player: string;
  score_half: number;
  zones: number;
  rank: number;
  amount_lamports: string;
}

export interface IngestOutcome {
  ok: boolean;
  rootMatches: boolean;
  /** Machine-readable reason when ok is false or the root mismatched. */
  reason?: string;
  recomputedRoot?: string;
  onChainRoot?: string | null;
  rows?: number;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** Shape-check one results row — the bundle is EXTERNAL data. */
function validRow(r: unknown): r is BundleResultRow {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  return (
    Number.isInteger(o.index) &&
    (o.index as number) >= 0 &&
    typeof o.player === 'string' &&
    Number.isInteger(o.rank) &&
    (o.rank as number) >= 1 &&
    (o.rank as number) <= 255 &&
    Number.isInteger(o.score_half) &&
    Number.isInteger(o.zones) &&
    typeof o.amount_lamports === 'string' &&
    /^\d+$/.test(o.amount_lamports as string)
  );
}

/**
 * Recompute the results root from published rows. Pure; throws only on
 * malformed rows (caller converts to a rejection, never a crash).
 */
export function recomputeRoot(results: readonly BundleResultRow[]): string {
  const leaves = results.map((r) =>
    leafBytes({
      player: base58Decode(r.player),
      rank: r.rank,
      amountLamports: BigInt(r.amount_lamports),
    })
  );
  return hex(merkleRoot(leaves));
}

/**
 * Ingest one pool's bundle: verify then persist. Idempotent — re-running
 * replaces the bundles row and (on a match) rewrites the same rankings.
 * A mismatch records `root_matches = false` and REMOVES any previously
 * served rankings for the pool: a cache that failed verification must
 * not keep serving yesterday's answer as if nothing happened.
 */
export async function ingestBundle(
  db: Queryable,
  pool: string,
  uri: string,
  fetchImpl: typeof fetch = fetch
): Promise<IngestOutcome> {
  // 1. The trust anchor: the on-chain root, from the events projection.
  const rootRow = await db.query('SELECT results_root FROM pools WHERE pool = $1', [pool]);
  const onChainRoot: string | null = rootRow.rows[0]?.results_root ?? null;
  if (!onChainRoot) {
    return { ok: false, rootMatches: false, reason: 'no committed results_root on chain', onChainRoot };
  }

  // 2. Fetch the published bundle (external content — parsed defensively).
  let body: unknown;
  try {
    const res = await fetchImpl(uri);
    if (!res.ok) {
      return { ok: false, rootMatches: false, reason: `bundle fetch failed: HTTP ${res.status}`, onChainRoot };
    }
    body = await res.json();
  } catch (e) {
    return { ok: false, rootMatches: false, reason: `bundle fetch failed: ${String(e)}`, onChainRoot };
  }
  const results = (body as { results?: unknown[] })?.results;
  if (!Array.isArray(results) || results.length === 0 || !results.every(validRow)) {
    return { ok: false, rootMatches: false, reason: 'bundle results[] malformed', onChainRoot };
  }

  // 3. Rebuild the root locally, in the published leaf order.
  let recomputed: string;
  try {
    recomputed = recomputeRoot(results);
  } catch (e) {
    return { ok: false, rootMatches: false, reason: `leaf rebuild failed: ${String(e)}`, onChainRoot };
  }
  const matches = recomputed.toLowerCase() === onChainRoot.toLowerCase();

  // 4. Record the attempt — stored, not assumed. On mismatch, clear any
  //    previously verified rows so a bad re-publish cannot hide behind a
  //    stale cache; on match, replace-in-full (idempotent).
  await db.query(
    `INSERT INTO bundles (pool, uri, results_root, verified_at, root_matches)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (pool) DO UPDATE
       SET uri = $2, results_root = $3, verified_at = now(), root_matches = $4`,
    [pool, uri, recomputed, matches]
  );
  await db.query('DELETE FROM rankings WHERE pool = $1', [pool]);
  if (!matches) {
    return {
      ok: false,
      rootMatches: false,
      reason: 'recomputed root does not match on-chain results_root',
      recomputedRoot: recomputed,
      onChainRoot,
    };
  }
  for (const r of results) {
    await db.query(
      `INSERT INTO rankings (pool, seat, player, rank, score_half, zones, amount_lamports)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (pool, seat) DO UPDATE
         SET player = $3, rank = $4, score_half = $5, zones = $6, amount_lamports = $7`,
      [pool, r.index, r.player, r.rank, r.score_half, r.zones, r.amount_lamports]
    );
  }
  return { ok: true, rootMatches: true, recomputedRoot: recomputed, onChainRoot, rows: results.length };
}

/**
 * URI discovery for the backfill (§4.4): the Irys gateway's GraphQL,
 * queried by the tags the publisher already stamps (`App-Name:
 * blotto-cup`, `Blotto-Pool: <pool id>`). UNTRUSTED BY DESIGN — whatever
 * comes back goes through the same root check as everything else.
 * Returns the newest matching transaction's gateway URI, or null.
 */
export async function discoverBundleUri(
  poolId: string,
  fetchImpl: typeof fetch = fetch,
  gatewayBase = 'https://gateway.irys.xyz'
): Promise<string | null> {
  const query = `query { transactions(tags: [
      { name: "App-Name", values: ["blotto-cup"] },
      { name: "Blotto-Pool", values: ["${poolId}"] }
    ], first: 1, order: DESC) { edges { node { id } } } }`;
  try {
    const res = await fetchImpl(`${gatewayBase}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { transactions?: { edges?: Array<{ node?: { id?: string } }> } };
    };
    const id = body.data?.transactions?.edges?.[0]?.node?.id;
    return id ? `${gatewayBase}/${id}` : null;
  } catch {
    return null;
  }
}

/**
 * Backfill every settled pool through the SAME ingest function (§4.4 —
 * a second path would drift). Idempotent: run it twice, same rows.
 */
export async function backfillArchive(
  db: Queryable,
  fetchImpl: typeof fetch = fetch,
  log: (line: string) => void = console.log
): Promise<{ attempted: number; verified: number; failed: number }> {
  const pools = await db.query(
    `SELECT pool, id FROM pools
     WHERE state = 'Paid' AND results_root IS NOT NULL
     ORDER BY id ASC`
  );
  let verified = 0;
  let failed = 0;
  for (const row of pools.rows) {
    const uri = await discoverBundleUri(String(row.id), fetchImpl);
    if (!uri) {
      failed++;
      log(`archive backfill: pool ${row.pool} — no bundle found by tag`);
      continue;
    }
    const out = await ingestBundle(db, row.pool, uri, fetchImpl);
    if (out.ok) {
      verified++;
      log(`archive backfill: pool ${row.pool} verified (${out.rows} rows)`);
    } else {
      failed++;
      log(`archive backfill: pool ${row.pool} REJECTED — ${out.reason}`);
    }
  }
  return { attempted: pools.rows.length, verified, failed };
}
