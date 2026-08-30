'use client';

/*
 * The arena orchestrator: polls the read API (TanStack Query — PRD §3:
 * polling, no WebSockets in v1), resolves the phase with the pure resolver
 * (arena/phase.ts), and renders the surface for it. All unsealed data
 * enters through the bundle seam; the field is rescored before anything
 * plays (playback/script.ts `loadField`).
 *
 * The ?arena=<phase> dev lever swaps in fixture server state — the
 * resolver, the engine and every surface below run unmodified.
 *
 * The create phase carries the SAME gates in the SAME order as
 * src/app/play/play-client.tsx: geo pre-flight (fail-closed), age
 * attestation (same storage key — one attestation, one product), sign-in,
 * then the builder; submission goes through the one sealed-submit path
 * (src/entry/submit.ts via src/entry/browser-services.ts).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { COPY } from '@/copy';
import type { Allocation } from '@/battle/allocation';
import { indexerApi } from '@/data/api';
import { useAuth } from '@/wallet/auth-context';
import { submitEntry } from '@/entry/submit';
import { browserServices } from '@/entry/browser-services';
import { checkGeoGate, type GeoGateState } from '@/entry/geo-gate';
import type { RevealClass } from '@/reveal/types';
import { arenaPhase, lobbyVisual } from '@/arena/phase';
import { bundleSource } from '@/arena/bundle-source';
import { isArenaLeverPhase, leverData } from '@/arena/dev-lever';
import { ArenaBuilderFlow } from '@/arena/builder/arena-builder-flow';
import { LobbyStage } from '@/arena/lobby/lobby-stage';
import { BattleStage } from '@/arena/playback/battle-stage';
import {
  buildBattleScript,
  featuredSeats,
  loadField,
  type ArenaField,
} from '@/arena/playback/script';
import { MatchupList } from './matchup-list';
import { ResultsOutro } from './results-outro';

const POLL_MS = 5_000;
const BUNDLE_POLL_MS = 10_000;
const AGE_KEY = 'blotto:age-attested';

const asClass = (n: number): RevealClass | null =>
  Number.isInteger(n) && n >= 0 && n <= 4 ? (n as RevealClass) : null;

export function ArenaClient({ pool: poolId }: { pool: string }) {
  const params = useSearchParams();
  const leverParam = params.get('arena');
  const lever = leverParam !== null && isArenaLeverPhase(leverParam) ? leverParam : null;
  const lev = useMemo(() => (lever !== null ? leverData(lever) : null), [lever]);

  const auth = useAuth();
  const [submitted, setSubmitted] = useState(false);
  const [selectedOpp, setSelectedOpp] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attested, setAttested] = useState<boolean>(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(AGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [geo, setGeo] = useState<GeoGateState>('checking');

  const poolQ = useQuery({
    queryKey: ['arena-pool', poolId],
    queryFn: () => indexerApi().getPool(poolId),
    refetchInterval: POLL_MS,
    enabled: lev === null,
  });
  const pool = lev !== null ? lev.pool : (poolQ.data ?? null);
  const open = pool?.state === 'Open';

  const entriesQ = useQuery({
    queryKey: ['arena-entries', poolId],
    queryFn: () => indexerApi().getEntries(poolId),
    // Live while filling; one read suffices once the pool closes.
    refetchInterval: open ? POLL_MS : false,
    enabled: lev === null && pool !== null,
  });
  const entries = useMemo(
    () => (lev !== null ? lev.entries : (entriesQ.data ?? [])),
    [lev, entriesQ.data]
  );

  const sealedStates = pool !== null && ['Sealed', 'Scored', 'Paid'].includes(pool.state);
  const bundleQ = useQuery({
    queryKey: ['arena-bundle', poolId],
    queryFn: () => bundleSource().getBundle(poolId),
    enabled: lev === null && sealedStates,
    refetchInterval: (q) => (q.state.data ? false : BUNDLE_POLL_MS),
  });
  const bundle = lev !== null ? lev.bundle : (bundleQ.data ?? null);

  const wallet =
    lev !== null
      ? lev.walletOverride
      : auth.status === 'signed-in'
        ? auth.walletAddress
        : null;
  const myEntry = useMemo(
    () => (wallet !== null ? (entries.find((e) => e.player === wallet) ?? null) : null),
    [entries, wallet]
  );

  useEffect(() => {
    let cancelled = false;
    checkGeoGate(process.env.NEXT_PUBLIC_ENTRY_API_URL).then((verdict) => {
      if (!cancelled) setGeo(verdict);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onConfirm = useCallback(
    async (battles: readonly Allocation[], timingsMs: readonly number[]) => {
      // Dev lever: rehearse the flow, not the transaction — confirm walks
      // straight into the lobby (the reveal lever's replay posture; the
      // real path below is untouched and still fails honestly).
      if (lev !== null) {
        setSubmitted(true);
        return;
      }
      if (!pool || wallet === null) return;
      try {
        await submitEntry(browserServices(), {
          pool: pool.pool,
          sealingPubkeyHex: pool.sealing_pubkey,
          player: wallet,
          battles,
          timingsMs,
        });
        setSubmitted(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [pool, wallet, lev]
  );

  // The revealed field — rescored, or refused. Everything below the reveal
  // renders from this, never from the raw bundle.
  const field: ArenaField | 'mismatch' | null = useMemo(() => {
    if (bundle === null) return null;
    try {
      return loadField(bundle);
    } catch {
      return 'mismatch';
    }
  }, [bundle]);

  const phase = pool !== null ? arenaPhase(pool, myEntry, submitted, bundle) : null;
  const isSpectator = phase === 'spectate';

  const viewerSeat = useMemo(() => {
    if (field === null || field === 'mismatch') return null;
    if (myEntry !== null) return myEntry.idx;
    // Spectator: ride along with the pool's top-ranked seat.
    return [...field.results].sort((a, b) => a.rank - b.rank || a.index - b.index)[0].index;
  }, [field, myEntry]);

  const scripts = useMemo(() => {
    if (field === null || field === 'mismatch' || viewerSeat === null) return [];
    const mine = field.sets[viewerSeat];
    if (mine === null) return [];
    return field.results
      .filter((r) => r.index !== viewerSeat && field.sets[r.index] !== null)
      .map((r) => buildBattleScript(mine, field.sets[r.index]!, viewerSeat, r.index));
  }, [field, viewerSeat]);

  const featured = useMemo(
    () =>
      field !== null && field !== 'mismatch' && viewerSeat !== null
        ? featuredSeats(viewerSeat, scripts, field.results)
        : [],
    [field, viewerSeat, scripts]
  );

  const classBySeat = useMemo(() => {
    const map = new Map<number, RevealClass>();
    for (const e of entries) {
      const c = asClass(e.class);
      if (c !== null) map.set(e.idx, c);
    }
    return map;
  }, [entries]);

  /* ---- rendering ---- */

  if (pool === null) {
    return <p className="opacity-70">{poolQ.isLoading ? '…' : 'Pool not found.'}</p>;
  }

  if (phase === 'create') {
    // The lever rehearses PRESENTATION; the real path keeps every gate,
    // fail-closed, in play-client.tsx's exact order.
    if (lev !== null) {
      return (
        <>
          <p className="mb-4 max-w-prose text-sm opacity-70">{COPY.arena.builder.intro}</p>
          <ArenaBuilderFlow timerSeconds={pool.timer_seconds} onConfirm={onConfirm} />
        </>
      );
    }
    if (geo === 'checking') return <p className="opacity-70">…</p>;
    if (geo === 'blocked') {
      return <p className="max-w-prose text-sm opacity-80">{COPY.gate.territoryBlocked}</p>;
    }
    if (!attested) {
      return (
        <section className="flex flex-col gap-4 rounded border p-6">
          <p className="text-sm">{COPY.gate.ageAttestation}</p>
          <button
            type="button"
            className="rounded bg-[var(--color-brand)] px-6 py-2 text-white"
            onClick={() => {
              try {
                localStorage.setItem(AGE_KEY, '1');
              } catch {
                /* private mode: gate again next visit */
              }
              setAttested(true);
            }}
          >
            {COPY.gate.ageConfirm}
          </button>
        </section>
      );
    }
    if (wallet === null) {
      return <p className="opacity-70">Sign in to enter.</p>;
    }
    return (
      <>
        {error !== null && <p className="mb-4 text-sm text-red-400">{error}</p>}
        <p className="mb-4 max-w-prose text-sm opacity-70">{COPY.arena.builder.intro}</p>
        <ArenaBuilderFlow timerSeconds={pool.timer_seconds} onConfirm={onConfirm} />
      </>
    );
  }

  if (phase === 'lobby') {
    return <LobbyStage visual={lobbyVisual(pool, entries, wallet)} />;
  }

  if (phase === 'sealing') {
    return (
      <section className="flex flex-col gap-3 rounded border p-6" aria-live="polite">
        <h2 className="font-[family-name:var(--font-unbounded)] text-lg">
          {COPY.arena.sealing.title}
        </h2>
        <p className="max-w-prose text-sm opacity-70">{COPY.arena.sealing.body}</p>
      </section>
    );
  }

  if (phase === 'refunding' || phase === 'closed') {
    return (
      <section className="flex flex-col gap-3 rounded border p-6">
        <h2 className="font-[family-name:var(--font-unbounded)] text-lg">
          {COPY.arena.refunding.title}
        </h2>
        <p className="max-w-prose text-sm opacity-70">{COPY.pool.refundRule}</p>
      </section>
    );
  }

  // battle / spectate.
  if (field === 'mismatch') {
    return (
      <section className="flex flex-col gap-3 rounded border p-6">
        <p className="max-w-prose text-sm text-red-400">{COPY.arena.results.mismatch}</p>
        <Link className="underline opacity-80" href={`/verify?pool=${pool.pool}`}>
          {COPY.arena.results.verifyLink}
        </Link>
      </section>
    );
  }
  if (field === null || viewerSeat === null) {
    return <p className="opacity-70">…</p>;
  }

  const mySet = field.sets[viewerSeat];
  const selected = selectedOpp !== null ? scripts.find((s) => s.oppSeat === selectedOpp) : undefined;

  if (selected !== undefined && mySet !== null) {
    return (
      <BattleStage
        script={selected}
        mine={mySet}
        theirs={field.sets[selected.oppSeat]!}
        myClass={classBySeat.get(viewerSeat) ?? null}
        oppClass={classBySeat.get(selected.oppSeat) ?? null}
        onExit={() => setSelectedOpp(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ResultsOutro
        pool={pool.pool}
        viewerSeat={viewerSeat}
        spectator={isSpectator}
        results={field.results}
      />
      {mySet !== null ? (
        <MatchupList
          scripts={scripts}
          featured={featured}
          sets={field.sets}
          results={field.results}
          classBySeat={classBySeat}
          onSelect={setSelectedOpp}
        />
      ) : (
        <p className="max-w-prose text-sm opacity-70">{COPY.arena.results.lostEntry}</p>
      )}
    </div>
  );
}
