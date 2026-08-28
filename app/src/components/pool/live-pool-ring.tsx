'use client';

/*
 * LivePoolRing (UI constitution 6.2): the lobby's heartbeat. Hydrates from
 * the server-rendered pool and, while the pool is Open, re-reads it every
 * POLL_MS so the SeatRing's per-entry choreography (fill sweep, one LIGHT
 * pass, digit slide, "+1 entered" riser) fires on REAL entries only — the
 * component never synthesises a fill. In fixture mode (or a dead indexer)
 * the ring simply holds the last honest value.
 */

import { useEffect, useState } from 'react';
import { indexerApi } from '@/data/api';
import type { PoolSummary } from '@/data/types';
import { SeatRing } from '@/components/ui/seat-ring';

const POLL_MS = 15_000;

export function LivePoolRing({
  pool,
  size = 104,
  riser = true,
  yourSeat = null,
}: {
  pool: PoolSummary;
  size?: number;
  riser?: boolean;
  yourSeat?: number | null;
}) {
  const [entrants, setEntrants] = useState(pool.entrants);

  useEffect(() => {
    if (pool.state !== 'Open') return;
    const api = indexerApi();
    const id = setInterval(async () => {
      try {
        const fresh = await api.getPool(pool.pool);
        if (fresh) setEntrants(fresh.entrants);
      } catch {
        // Unreachable indexer: hold the last honest value; never invent.
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [pool.pool, pool.state]);

  return <SeatRing entrants={entrants} size={size} riser={riser} yourSeat={yourSeat} />;
}
