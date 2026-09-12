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
 * after publishing); the backfill reads the URI the daemon RECORDED when
 * it published. Both paths land HERE — one ingest function, so the two
 * can never drift (§4.4).
 *
 * Tree code is imported from the scoring package AS-IS (leafBytes +
 * merkleRoot — the same functions the crank used to commit the root);
 * reimplementing it would be a second implementation to get wrong.
 *
 * ## What "verified" covers (2026-09-12, founder ruling D-E8)
 *
 * The committed leaf is `player ‖ rank ‖ amount` — 41 bytes, and nothing
 * else (`merkle.ts`). Until today this module also stored the bundle's
 * `index` as the seat and served it, the battle score and the zone count
 * under the same flag, so three columns carried a guarantee the root had
 * never given them; the seat was the dangerous one, because it came
 * verbatim from the uploaded file and the career page joins on it.
 *
 * Now: the row is keyed by the player the root commits to, the seat is
 * read from `entries.idx` — our own projection of the on-chain
 * `EntryRegistered` — and the read API labels the score and the zones as
 * recomputed rather than committed. A player our ledger has no entry for
 * gets a null seat and is still served: their prize verified, only our
 * record of where they sat is incomplete.
 */

import { leafBytes, merkleRoot } from '../../scoring/src/merkle';
import { base58Decode } from './shared';
import type { Queryable } from './shared';
import type { AtomicDb } from './atomic';

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
  /**
   * How many verified rows we could not place in a seat, because our own
   * entry projection has no row for that player in that pool. Never a
   * reason to withhold the row — the prize verified — but a direct count
   * of missed `EntryRegistered` deliveries, so it is reported rather than
   * swallowed.
   */
  seatsUnresolved?: number;
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
  db: AtomicDb,
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
  // One row per player. The root can match a bundle that names a player
  // twice — the tree commits to a list, not to a set — and under the old
  // seat key both rows were stored, so the same wallet appeared twice in a
  // leaderboard that called itself verified. The player is the row's
  // identity now, so this is refused rather than silently collapsed.
  if (new Set(results.map((r) => r.player)).size !== results.length) {
    return { ok: false, rootMatches: false, reason: 'bundle results[] names a player twice', onChainRoot };
  }

  // 3. Rebuild the root locally, in the published leaf order.
  let recomputed: string;
  try {
    recomputed = recomputeRoot(results);
  } catch (e) {
    return { ok: false, rootMatches: false, reason: `leaf rebuild failed: ${String(e)}`, onChainRoot };
  }
  const matches = recomputed.toLowerCase() === onChainRoot.toLowerCase();

  // 4. On a MISMATCH: record the attempt and clear any previously verified
  //    rows, together, so a bad re-publish can neither hide behind a stale
  //    cache nor leave the flag disagreeing with the rows.
  const bundleUpsert = `INSERT INTO bundles (pool, uri, results_root, verified_at, root_matches)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (pool) DO UPDATE
       SET uri = $2, results_root = $3, verified_at = now(), root_matches = $4`;
  if (!matches) {
    await db.atomically(async (q) => {
      await q.query('DELETE FROM rankings WHERE pool = $1', [pool]);
      await q.query(bundleUpsert, [pool, uri, recomputed, false]);
    });
    return {
      ok: false,
      rootMatches: false,
      reason: 'recomputed root does not match on-chain results_root',
      recomputedRoot: recomputed,
      onChainRoot,
    };
  }

  // 5. Seats come from OUR projection of the chain, not from the file.
  //    Read before the write so a slow lookup holds no transaction open.
  const seatRows = await db.query('SELECT player, idx FROM entries WHERE pool = $1', [pool]);
  const seatOf = new Map<string, number>(
    seatRows.rows.map((r: { player: string; idx: number }) => [String(r.player), Number(r.idx)])
  );
  let seatsUnresolved = 0;

  // 6. Replace the pool's rankings and vouch for them — in ONE unit, with
  //    the flag written LAST. Both properties matter: the transaction means
  //    a failure part-way leaves yesterday's verified answer untouched
  //    rather than an empty one still flagged true (B-20), and the ordering
  //    means `root_matches = true` is never visible before the rows it
  //    claims to have verified (F-05).
  await db.atomically(async (q) => {
    await q.query('DELETE FROM rankings WHERE pool = $1', [pool]);
    for (const r of results) {
      const seat = seatOf.get(r.player);
      if (seat === undefined) seatsUnresolved++;
      await q.query(
        `INSERT INTO rankings (pool, player, seat, rank, score_half, zones, amount_lamports)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (pool, player) DO UPDATE
           SET seat = $3, rank = $4, score_half = $5, zones = $6, amount_lamports = $7`,
        [pool, r.player, seat ?? null, r.rank, r.score_half, r.zones, r.amount_lamports]
      );
    }
    await q.query(bundleUpsert, [pool, uri, recomputed, true]);
  });
  return {
    ok: true,
    rootMatches: true,
    recomputedRoot: recomputed,
    onChainRoot,
    rows: results.length,
    seatsUnresolved,
  };
}

/**
 * Where is this pool's bundle? (audit 2026-09-11, C-25.)
 *
 * Two sources, in order of how much they can be trusted to name OUR upload:
 *
 *  1. `published_bundles` — the daemon's own row, written straight after a
 *     successful upload. It is our record of what we published, in our own
 *     database, and it exists even when the announce that should have told
 *     the indexer never arrived (the failure D-02 fixed). This is the
 *     recovery path the backfill wants, and it involves no third party.
 *  2. The Irys gateway, by tag AND by owner. The old query asked only for
 *     `App-Name: blotto-cup` and `Blotto-Pool: <id>` and took the newest
 *     answer, so anyone could upload a same-tagged object and win the
 *     query. Constraining `owners` to our upload address closes that.
 *
 * With no upload address configured, step 2 is SKIPPED rather than widened:
 * an unfiltered tag query is the forgery route itself, and returning
 * nothing merely leaves the archive unfilled until the announce or the
 * daemon's record supplies the URI. The root check behind this would still
 * reject a forged bundle — this is defence in depth, and it also stops the
 * backfill wasting a fetch on a stranger's object.
 */
export async function discoverBundleUri(
  db: Queryable,
  poolId: string,
  fetchImpl: typeof fetch = fetch,
  opts: {
    gatewayBase?: string;
    /** Our Irys upload address. Unset disables the gateway query. */
    uploaderAddress?: string | null;
    log?: (line: string) => void;
  } = {}
): Promise<string | null> {
  const gatewayBase = opts.gatewayBase ?? 'https://gateway.irys.xyz';
  const log = opts.log ?? console.log;

  const own = await db.query('SELECT uri FROM published_bundles WHERE pool_id = $1', [poolId]);
  const recorded: string | undefined = own.rows[0]?.uri;
  if (recorded) return recorded;

  const uploader = opts.uploaderAddress?.trim();
  if (!uploader) {
    log(
      `archive: pool ${poolId} has no published_bundles row and no BLOTTO_IRYS_UPLOAD_ADDRESS ` +
        'is configured, so the gateway is not queried — an unfiltered tag query is the forgery ' +
        'route this check exists to close'
    );
    return null;
  }

  const query = `query { transactions(
      owners: ["${uploader}"],
      tags: [
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
  db: AtomicDb,
  fetchImpl: typeof fetch = fetch,
  log: (line: string) => void = console.log,
  opts: { uploaderAddress?: string | null } = {}
): Promise<{ attempted: number; verified: number; failed: number; seatsUnresolved: number }> {
  const pools = await db.query(
    `SELECT pool, id FROM pools
     WHERE state = 'Paid' AND results_root IS NOT NULL
     ORDER BY id ASC`
  );
  let verified = 0;
  let failed = 0;
  let seatsUnresolved = 0;
  for (const row of pools.rows) {
    const uri = await discoverBundleUri(db, String(row.id), fetchImpl, {
      uploaderAddress: opts.uploaderAddress,
      log,
    });
    if (!uri) {
      failed++;
      log(`archive backfill: pool ${row.pool} — no published bundle recorded or discoverable`);
      continue;
    }
    const out = await ingestBundle(db, row.pool, uri, fetchImpl);
    if (out.ok) {
      verified++;
      seatsUnresolved += out.seatsUnresolved ?? 0;
      log(
        `archive backfill: pool ${row.pool} verified (${out.rows} rows` +
          (out.seatsUnresolved ? `, ${out.seatsUnresolved} without a seat in our ledger` : '') +
          ')'
      );
    } else {
      failed++;
      log(`archive backfill: pool ${row.pool} REJECTED — ${out.reason}`);
    }
  }
  return { attempted: pools.rows.length, verified, failed, seatsUnresolved };
}
