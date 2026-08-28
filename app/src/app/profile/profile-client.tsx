'use client';

/*
 * The profile (R15; UI constitution 6.8): a film room and a badge case —
 * both encouraging re-entry without ever nagging. Read-only; nothing here
 * can affect a pool.
 *
 *  - Battle history (the film room): a timeline of tournament cards that
 *    fade up on scroll (30ms stagger, capped). Expanding a revealed pool
 *    unfolds the seven battles with per-battle W/D/L against the field,
 *    decrypted and recomputed IN THE BROWSER (post-reveal only, same
 *    engine as the crank); hovering a battle overlays the field's average
 *    shape, with the stats you took above it carrying the LIGHT dots.
 *    This is the mastery loop — the reason players return.
 *  - Badge case: placement badges sit ABOVE class rarity, always
 *    (achievement over the draw). Placement derives from committed
 *    payouts (exact band arithmetic — see profile/insights.ts); empty
 *    slots are quiet outlines stating their condition plainly. Rarity is
 *    expressed as material (the collection), never as fanfare.
 *  - Footer: the open pool's live ring in miniature and one calm CTA.
 *
 * PHASE-D3-REVIEW: rank labels are not indexed (D3-B — they live in the
 * published bundle), so placement is inferred only where a committed
 * amount equals an exact prize band; tie-splits show as "shared
 * placement", never rounded to a rank.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { COPY } from '@/copy';
import { useAuth } from '@/wallet/auth-context';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import type { CareerRow, PoolSummary, ProfileRow, RivalRow } from '@/data/types';
import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { SeatRing } from '@/components/ui/seat-ring';
import { PentagonMini } from '@/components/ui/pentagon-mini';
import { FadeInView } from '@/components/ui/fade-in-view';
import { buttonClasses } from '@/components/ui/button';
import { decryptSeatBattles } from '@/results/what-beat-you';
import { badgeCounts, filmRoomForSeat, type FilmRoomBattle } from '@/profile/insights';

function PrizeRecordChart({ career }: { career: CareerRow[] }) {
  if (career.length < 2) return null;
  const max = career.reduce((m, r) => {
    const v = BigInt(r.amount_lamports);
    return v > m ? v : m;
  }, 0n);
  return (
    <Card className="p-5">
      <h2 className="mb-1 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
        {COPY.career.chartTitle}
      </h2>
      <p className="mb-4 text-[12px] leading-4 text-ink-muted">{COPY.career.chartNote}</p>
      <div className="flex h-28 items-end gap-1.5" role="img" aria-label={COPY.career.chartTitle}>
        {career.map((r) => {
          const v = BigInt(r.amount_lamports);
          // Display proportion only — the amount itself never leaves bigint.
          const h = max > 0n && v > 0n ? Math.max(8, Number((v * 100n) / max)) : 4;
          return (
            <div
              key={`${r.pool}`}
              title={`#${r.entries_to_date}: ${r.paid ? `${lamportsToSol(r.amount_lamports)} SOL` : 'unpaid'}`}
              className={
                'w-full max-w-8 rounded-t ' + (r.paid ? 'bg-prize' : 'bg-overlay')
              }
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>
    </Card>
  );
}

function Rivals({ rivals }: { rivals: RivalRow[] }) {
  if (rivals.length === 0) return null;
  return (
    <Card className="p-5">
      <h2 className="mb-1 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
        {COPY.career.rivalsTitle}
      </h2>
      <p className="mb-4 text-[12px] leading-4 text-ink-muted">{COPY.career.rivalsNote}</p>
      <ul className="flex flex-col gap-2">
        {rivals.map((r) => (
          <li key={r.player} className="flex items-center gap-3">
            <span className="font-mono text-[13px] text-ink">{r.player.slice(0, 8)}…</span>
            <span className="tnum ml-auto text-[13px] text-ink-muted">
              {COPY.career.sharedPools(r.pools_shared)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* --- The badge case (placement above rarity, always) --------------------- */

function Badge({
  label,
  count,
  emptyCondition,
  hue,
}: {
  label: string;
  count: number;
  emptyCondition: string;
  hue: 'prize' | 'brand' | 'ink';
}) {
  const awarded = count > 0;
  const tone =
    hue === 'prize' ? 'var(--color-prize)' : hue === 'brand' ? 'var(--color-brand)' : 'var(--color-ink-muted)';
  return (
    <div
      className={
        'flex flex-col items-center gap-1.5 rounded-2xl border p-4 text-center transition-transform duration-150 ' +
        (awarded
          ? 'border-line bg-raised hover:-translate-y-0.5'
          : 'border-dashed border-line/60')
      }
      style={awarded ? { boxShadow: 'var(--elevation-card)' } : undefined}
      title={awarded ? label : emptyCondition}
    >
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
        <path
          d="M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.3 6.8 19l1-5.8-4.2-4.1 5.8-.8L12 3z"
          fill={awarded ? `color-mix(in srgb, ${tone} 30%, transparent)` : 'none'}
          stroke={awarded ? tone : 'var(--color-ink-muted)'}
          strokeWidth="1.5"
          strokeLinejoin="round"
          opacity={awarded ? 1 : 0.5}
        />
      </svg>
      <span className={'text-[12px] font-medium ' + (awarded ? 'text-ink' : 'text-ink-muted')}>
        {label}
      </span>
      {awarded ? (
        <span className="tnum font-display text-[18px] font-bold text-ink">{count}</span>
      ) : (
        <span className="max-w-[16ch] text-[10px] leading-3.5 text-ink-muted">{emptyCondition}</span>
      )}
    </div>
  );
}

function BadgeCase({ profile, career }: { profile: ProfileRow; career: CareerRow[] }) {
  const counts = badgeCounts(career);
  const b = COPY.profile.badges;
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-[12px] uppercase tracking-[0.14em] text-ink-muted">{b.title}</h2>
      {/* Placement first — achievement outranks the draw, at every surface. */}
      <div className="grid grid-cols-3 gap-3 sm:max-w-md">
        <Badge label={b.first} count={counts.first} emptyCondition={b.emptyFirst} hue="prize" />
        <Badge label={b.top3} count={counts.top3} emptyCondition={b.emptyTop3} hue="brand" />
        <Badge label={b.paid16} count={counts.paid} emptyCondition={b.emptyPaid} hue="brand" />
      </div>
      {counts.shared > 0 ? (
        <p className="tnum mt-2 text-[12px] text-ink-muted">
          {b.shared}: {counts.shared}
        </p>
      ) : null}
      <p className="mt-3 max-w-prose text-[12px] leading-4 text-ink-muted">{b.note}</p>

      {/* Rarity below placement: the collection as material, not signal. */}
      <h3 className="mt-6 mb-3 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
        {COPY.profile.collection}
      </h3>
      <dl className="grid grid-cols-5 gap-3 text-center">
        {profile.class_counts.map((n, i) => (
          <div key={i} className="flex flex-col gap-1">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-muted">
              {COPY.reveal.classNames[i]}
            </dt>
            <dd
              className="tnum font-display text-[28px] leading-[30px] font-bold"
              style={{ color: n > 0 ? `var(--color-class-${i})` : 'var(--color-ink-muted)' }}
            >
              {n}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/* --- The film room -------------------------------------------------------- */

type FilmState = 'idle' | 'loading' | 'unavailable' | FilmRoomBattle[];

function FilmRoomCard({ row, index }: { row: CareerRow; index: number }) {
  const [open, setOpen] = useState(false);
  const [film, setFilm] = useState<FilmState>('idle');
  const fr = COPY.profile.filmRoom;
  const revealed = row.state === 'Scored' || row.state === 'Paid';

  useEffect(() => {
    if (!open || film !== 'loading' || row.seat === null) return;
    let live = true;
    const api = indexerApi();
    Promise.all([api.getPool(row.pool), api.getSealedEntries(row.pool)])
      .then(([pool, sealed]) => {
        if (!live) return;
        if (!pool?.secret || sealed.length === 0) {
          setFilm('unavailable');
          return;
        }
        const battles = decryptSeatBattles(pool.secret, sealed);
        const room = filmRoomForSeat(row.seat!, battles);
        setFilm(room ?? 'unavailable');
      })
      .catch(() => {
        if (live) setFilm('unavailable');
      });
    return () => {
      live = false;
    };
  }, [open, film, row.pool, row.seat]);

  return (
    <FadeInView delayMs={Math.min(index * 30, 300)}>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="tnum font-mono text-[12px] text-ink-muted">
            {row.pool_id !== null ? `#${row.pool_id}` : row.pool.slice(0, 6)}
          </span>
          {row.pot_lamports !== null ? (
            <span className="tnum text-[13px] text-ink-muted">
              {COPY.pool.tierPot(lamportsToSol(row.pot_lamports))}
            </span>
          ) : null}
          <span
            className={
              'tnum ml-auto font-display text-[16px] font-bold ' +
              (row.paid ? 'text-prize' : 'text-ink-muted')
            }
          >
            {row.paid ? `${lamportsToSol(row.amount_lamports)} SOL` : '—'}
          </span>
          {revealed && row.seat !== null ? (
            <button
              type="button"
              className="link-draw text-[13px] font-medium text-brand"
              onClick={() => {
                setOpen((o) => !o);
                if (!open && film === 'idle') setFilm('loading');
              }}
            >
              {open ? fr.close : fr.open}
            </button>
          ) : (
            <Link href={`/pools/${row.pool}`} className="link-draw text-[13px] text-ink-muted">
              {row.state ?? ''}
            </Link>
          )}
        </div>

        {open ? (
          film === 'loading' ? (
            <div className="flex justify-center py-6">
              <div
                className="h-6 w-6 rounded-full border-2 border-overlay border-t-brand motion-safe:animate-rotate"
                aria-hidden
              />
            </div>
          ) : Array.isArray(film) ? (
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex gap-3 overflow-x-auto pb-2">
                {film.map((b) => (
                  <FilmBattle key={b.index} battle={b} />
                ))}
              </div>
              <p className="max-w-prose text-[12px] leading-4 text-ink-muted">{fr.overlayNote}</p>
            </div>
          ) : (
            <p className="mt-3 text-[13px] leading-5 text-ink-muted">{fr.unavailable}</p>
          )
        ) : null}
      </Card>
    </FadeInView>
  );
}

function FilmBattle({ battle }: { battle: FilmRoomBattle }) {
  const [compare, setCompare] = useState(false);
  const fr = COPY.profile.filmRoom;
  return (
    <button
      type="button"
      className="flex shrink-0 flex-col items-center gap-1 rounded-xl border border-line bg-raised p-2"
      onPointerEnter={() => setCompare(true)}
      onPointerLeave={() => setCompare(false)}
      onFocus={() => setCompare(true)}
      onBlur={() => setCompare(false)}
      aria-label={`${fr.battleN(battle.index + 1)}: ${fr.vsField(battle.wins, battle.draws, battle.losses)}`}
    >
      <PentagonMini
        allocation={battle.mine}
        size={84}
        overlay={compare ? battle.fieldMean : undefined}
        litStats={compare ? battle.statsAboveMean : undefined}
      />
      <span className="tnum text-[10px] text-ink-muted">{fr.battleN(battle.index + 1)}</span>
      <span className="tnum text-[11px] font-medium text-ink">
        {fr.vsField(battle.wins, battle.draws, battle.losses)}
      </span>
    </button>
  );
}

/* --- The page ------------------------------------------------------------- */

export function ProfileClient() {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  // Keyed by wallet so a stale wallet's record renders as loading rather
  // than being cleared synchronously inside the effect (house pattern —
  // matches the balance gate in play-client).
  const [result, setResult] = useState<{
    wallet: string;
    row: ProfileRow | null;
    career: CareerRow[];
    rivals: RivalRow[];
  } | null>(null);
  // The footer's open pool — the one calm CTA back to the room.
  const [openPool, setOpenPool] = useState<PoolSummary | null>(null);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    const api = indexerApi();
    Promise.all([
      api.getProfile(wallet),
      api.getCareer(wallet).catch(() => [] as CareerRow[]),
      api.getRivals(wallet).catch(() => [] as RivalRow[]),
    ])
      .then(([row, career, rivals]) => {
        if (!cancelled) setResult({ wallet, row, career, rivals });
      })
      .catch(() => {
        if (!cancelled) setResult({ wallet, row: null, career: [], rivals: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  useEffect(() => {
    let cancelled = false;
    indexerApi()
      .listPools()
      .then((pools) => {
        if (cancelled) return;
        const open = pools.filter((p) => p.state === 'Open').sort((a, b) => a.tier - b.tier);
        setOpenPool(open[0] ?? null);
      })
      .catch(() => {
        // No footer ring without honest data.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const profile: ProfileRow | null | 'loading' =
    result && result.wallet === wallet ? result.row : 'loading';

  if (!wallet) {
    return (
      <Card className="flex flex-col gap-2 p-6">
        <p className="text-[17px] font-medium text-ink">{COPY.profile.signedOut}</p>
        <p className="max-w-prose text-[13px] leading-5 text-ink-muted">
          {COPY.profile.signedOutDetail}
        </p>
      </Card>
    );
  }
  if (profile === 'loading') {
    return (
      <div aria-live="polite" className="flex flex-col items-center gap-4 py-14">
        <div
          className="h-8 w-8 rounded-full border-2 border-overlay border-t-brand motion-safe:animate-rotate"
          aria-hidden
        />
      </div>
    );
  }
  if (!profile) {
    return (
      <Card className="flex flex-col gap-2 p-6">
        <p className="text-[17px] font-medium text-ink">{COPY.profile.empty}</p>
        <p className="max-w-prose text-[13px] leading-5 text-ink-muted">
          {COPY.profile.emptyDetail}
        </p>
      </Card>
    );
  }

  const career = result?.career ?? [];

  return (
    <div className="animate-enter flex flex-col gap-4">
      <Card className="p-5">
        <h2 className="mb-4 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
          {COPY.profile.lifetime}
        </h2>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <Stat label={COPY.profile.entered} value={profile.pools_entered} />
          <Stat label={COPY.profile.paidFinishes} value={profile.seats_paid} tone="brand" />
          <Stat
            label={COPY.profile.totalPrizes}
            value={lamportsToSol(profile.total_won_lamports)}
            unit="SOL"
            tone="prize"
          />
        </div>
      </Card>

      <BadgeCase profile={profile} career={career} />

      {career.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">
              {COPY.profile.filmRoom.title}
            </h2>
            <p className="max-w-prose text-[12px] leading-4 text-ink-muted">
              {COPY.profile.filmRoom.note}
            </p>
          </div>
          {career.map((row, i) => (
            <FilmRoomCard key={row.pool} row={row} index={i} />
          ))}
        </section>
      ) : null}

      <PrizeRecordChart career={career} />
      <Rivals rivals={result?.rivals ?? []} />

      {/* Footer: the open pool in miniature and one calm CTA. */}
      {openPool ? (
        <Card className="flex items-center gap-5 p-5">
          <SeatRing entrants={openPool.entrants} size={72}>
            <span className="sr-only">{COPY.pool.entrantsOf(openPool.entrants)}</span>
          </SeatRing>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[13px] text-ink-muted">
              {COPY.pool.entrantsOf(openPool.entrants)}
            </span>
            <span className="tnum text-[13px] font-semibold text-prize">
              {COPY.pool.tierPot(lamportsToSol(openPool.pot_lamports))}
            </span>
          </div>
          <Link href={`/pools/${openPool.pool}`} className={buttonClasses('secondary', 'md')}>
            {COPY.pool.enter}
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
