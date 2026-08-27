/*
 * The shareable result card (R16, roadmap 3.8): a server-rendered OG image —
 * prize, class, pool id — plus nothing. No on-chain change, no reward; any
 * reward attached to sharing is a PID §8.4 question and out of scope.
 * (D3-B: rank labels are not indexed — the card shows the prize instead;
 * the full ranking with tie labels lives on the verify page.)
 */
import { ImageResponse } from 'next/og';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';


const CLASS_NAMES = ['Goblin', 'Knight', 'Wizard', 'Dragon', 'Titan'];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pool: string; player: string }> }
) {
  const { pool: poolId, player } = await params;
  const api = indexerApi();
  const [pool, results, entries] = await Promise.all([
    api.getPool(poolId),
    api.getResults(poolId),
    api.getEntries(poolId),
  ]);
  const entry = entries.find((e) => e.player === player);
  const amount = entry ? results.find((r) => r.seat === entry.idx)?.amount : undefined;

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
          background: '#0A0A0F',
          color: '#fff',
          fontSize: 48,
        }}
      >
        <div style={{ fontSize: 28, opacity: 0.7 }}>BLOTTO CUP · POOL #{pool?.id ?? '?'}</div>
        <div style={{ fontSize: 96, fontWeight: 700 }}>
          {amount ? `${lamportsToSol(amount)} SOL` : '—'}
        </div>
        <div style={{ fontSize: 36 }}>
          {entry ? CLASS_NAMES[entry.class] : ''} · of 64
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
