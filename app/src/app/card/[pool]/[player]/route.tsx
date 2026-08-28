/*
 * The shareable result card (R16, roadmap 3.8; restyled by v3 D3): a
 * server-rendered OG image in the arena idiom — prize in molten amber over
 * the navy base, class name, pool id — plus nothing. No on-chain change, no
 * reward; any reward attached to sharing is a PID §8.4 question and out of
 * scope. (D3-B: rank labels are not indexed — the card shows the prize;
 * the full ranking with tie labels lives on the verify page.)
 *
 * Colour literals here MIRROR src/design/tokens.ts (an OG image renders
 * outside the CSS pipeline, so tokens cannot be referenced by name).
 */
import { ImageResponse } from 'next/og';
import { COPY } from '@/copy';
import { indexerApi, live } from '@/data/api';
import { lamportsToSol } from '@/data/format';

// tokens.ts mirrors — keep in step with the palette.
const BASE = '#070b14';
const RAISED = '#0d1420';
const LINE = '#1d2942';
const INK = '#edf2fb';
const INK_MUTED = '#7e8aa3';
const BRAND = '#3d8bff';
const PRIZE = '#ffaa33';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pool: string; player: string }> }
) {
  const { pool: poolId, player } = await params;
  const api = indexerApi();
  // SSR outage guard: an unreachable indexer answers 503 (retryable),
  // never an unhandled 500 from the image renderer.
  const reads = await live(() =>
    Promise.all([api.getPool(poolId), api.getResults(poolId), api.getEntries(poolId)])
  );
  if (!reads.ok) return new Response('live data unavailable', { status: 503 });
  const [pool, results, entries] = reads.value;
  const entry = entries.find((e) => e.player === player);
  const amount = entry ? results.find((r) => r.seat === entry.idx)?.amount : undefined;
  const paid = amount !== undefined && BigInt(amount) > 0n;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: BASE,
          color: INK,
          fontSize: 48,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            background: RAISED,
            border: `2px solid ${paid ? PRIZE : LINE}`,
            borderRadius: 32,
            padding: '56px 96px',
          }}
        >
          <div
            style={{
              fontSize: 30,
              letterSpacing: 6,
              color: BRAND,
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            {COPY.shell.title} · Pool #{pool?.id ?? '?'}
          </div>
          <div
            style={{
              fontSize: 132,
              fontWeight: 800,
              color: paid ? PRIZE : INK,
              display: 'flex',
              alignItems: 'baseline',
              gap: 20,
            }}
          >
            {amount !== undefined && paid ? (
              <>
                {lamportsToSol(amount)}
                <span style={{ fontSize: 44, color: INK_MUTED }}>SOL</span>
              </>
            ) : (
              'Entered'
            )}
          </div>
          <div style={{ fontSize: 34, color: INK_MUTED, display: 'flex', gap: 14 }}>
            {entry ? COPY.reveal.classNames[entry.class] : ''}
            {entry ? ` · seat ${entry.idx + 1} of 64` : ' · of 64'}
          </div>
        </div>
        <div style={{ marginTop: 36, fontSize: 24, color: INK_MUTED }}>
          Every result recomputable from published data
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
