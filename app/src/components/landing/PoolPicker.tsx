'use client';

/*
 * The pool picker (V2, founder 2026-09-27; Figma review page 02, Concept A
 * as ONE card): the home page's one card for entering. An Easy / Hard
 * toggle switches the whole card — its colours, its clip, its words — and a
 * tier filter across the top chooses the entry price. Tiers the founder has
 * not opened are listed greyed with "Not open yet" and cannot be chosen
 * (founder ruling 2026-09-27, reversing the 12 September "not listed at
 * all"); nothing here decides whether a tier is open — `GET /tiers` and the
 * pools list do, on the server, and the page hands the answer in.
 *
 * Every number on the card is the POOL's own record (the pot it opened
 * with, its entry, its seats, its deadline against the server's clock),
 * never a table. Class is nowhere on this card. The clip is muted, looped
 * and one at a time (the motion rule); the diagram of an entry is
 * illustrative integers, not anyone's real allocation.
 */

import { useState } from 'react';
import Link from 'next/link';
import { COPY } from '@/copy';
import type { PoolSummary } from '@/data/types';
import { lamportsToSol } from '@/data/format';
import type { BoardMode } from '@/battle/board/mode';
import { Toggle } from '@/components/ui/toggle';
import { Countdown } from '@/components/ui/countdown';
import { AmbientClip } from '@/components/ui/ambient-clip';

export interface PickerTier {
  tier: number;
  entryLamports: string;
  potLamports: string;
  /** The open pool of each ladder at this tier, or null. */
  easy: PoolSummary | null;
  hard: PoolSummary | null;
  /** The founder's `open_tiers` / hard slots, from the tiers API. */
  easyEnabled: boolean;
  hardEnabled: boolean;
}

const CLIP = {
  easy: { tiers: [{ mp4: '/motion/v2/easy.mp4', webm: '/motion/v2/easy.webm' }], poster: '/motion/v2/easy.jpg' },
  hard: { tiers: [{ mp4: '/motion/v2/hard.mp4', webm: '/motion/v2/hard.webm' }], poster: '/motion/v2/hard.jpg' },
} as const;

/* One colour per stat, in the fixed order — the board's own. */
const STAT_COLOURS = ['#ff9a6b', '#59c4ff', '#ff3daa', '#ffde59', '#9aa0b4'] as const;
/* Illustrative entries for the diagram (integers; the easy one sums to 100
 * per battle, the hard one to 700 across the board). Not anyone's data. */
const EXAMPLE: Record<BoardMode, readonly (readonly number[])[]> = {
  easy: [
    [30, 20, 20, 15, 15],
    [10, 40, 20, 20, 10],
    [25, 25, 0, 25, 25],
    [20, 20, 20, 20, 20],
    [40, 0, 30, 0, 30],
    [15, 35, 15, 20, 15],
    [0, 30, 30, 40, 0],
  ],
  hard: [
    [0, 0, 0, 0, 0],
    [120, 0, 40, 50, 0],
    [0, 60, 0, 0, 0],
    [40, 20, 30, 30, 20],
    [0, 0, 0, 0, 0],
    [50, 50, 30, 30, 30],
    [20, 20, 20, 20, 20],
  ],
};

function EntryDiagram({ mode, dark }: { mode: BoardMode; dark: boolean }) {
  const battles = EXAMPLE[mode];
  const max = Math.max(...battles.map((b) => b.reduce((a, v) => a + v, 0)), 1);
  const colW = 34;
  const gap = 10;
  const h = 96;
  const w = battles.length * colW + (battles.length - 1) * gap;
  const ink = dark ? '#fff6ec' : '#5e1b40';
  const muted = dark ? '#ffc7e3' : '#8c5474';
  return (
    <svg viewBox={`0 0 ${w} ${h + 34}`} width="100%" role="img" aria-label={COPY.landing.board[mode].caption} className="max-w-[320px]">
      {battles.map((b, i) => {
        const total = b.reduce((a, v) => a + v, 0);
        const x = i * (colW + gap);
        let y = h;
        return (
          <g key={i}>
            {total === 0 ? (
              <rect x={x} y={h - 8} width={colW} height={8} rx={3} fill="none" stroke={muted} strokeWidth={1.5} strokeDasharray="4 3" />
            ) : (
              b.map((v, k) => {
                if (v === 0) return null;
                const bh = Math.max(2, Math.round((v / max) * h));
                y -= bh;
                return <rect key={k} x={x} y={y} width={colW} height={bh} fill={STAT_COLOURS[k]} />;
              })
            )}
            <text x={x + colW / 2} y={h + 14} textAnchor="middle" fontSize="11" fontWeight="700" fill={ink} fontFamily="var(--font-mono)">
              {total}
            </text>
            <text x={x + colW / 2} y={h + 28} textAnchor="middle" fontSize="9" fill={muted} fontFamily="var(--font-mono)">
              B{i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function defaultTier(tiers: readonly PickerTier[], mode: BoardMode): number {
  const withOpen = tiers.find((t) => t[mode] !== null);
  if (withOpen) return withOpen.tier;
  const anyOpen = tiers.find((t) => t.easy !== null || t.hard !== null);
  if (anyOpen) return anyOpen.tier;
  const enabled = tiers.find((t) => t.easyEnabled || t.hardEnabled);
  return enabled ? enabled.tier : (tiers[0]?.tier ?? 0);
}

export function PoolPicker({ tiers, serverTime }: { tiers: readonly PickerTier[]; serverTime: string | null }) {
  // Easy unless only a hard pool is open somewhere (the landing demo stays easy).
  const [mode, setMode] = useState<BoardMode>(() =>
    tiers.some((t) => t.easy !== null) || !tiers.some((t) => t.hard !== null) ? 'easy' : 'hard'
  );
  const [tier, setTier] = useState<number>(() => defaultTier(tiers, mode));
  const row = tiers.find((t) => t.tier === tier) ?? tiers[0];
  const pool = row ? row[mode] : null;
  const enabled = row ? (mode === 'easy' ? row.easyEnabled : row.hardEnabled) : false;
  const dark = mode === 'hard';
  const words = COPY.landing.board[mode];

  const tierOptions = tiers.map((t) => {
    const choosable = t.easy !== null || t.hard !== null || t.easyEnabled || t.hardEnabled;
    return {
      value: String(t.tier),
      label: `${lamportsToSol(t.entryLamports)} SOL`,
      disabled: !choosable,
      disabledReason: COPY.landing.tierNotOpen,
    };
  });

  const shell = dark
    ? 'bg-[#1f0a24] text-brand-cream border-brand-hot'
    : 'bg-brand-cream text-brand-berry border-brand-yellow';
  const muted = dark ? 'text-brand-pale-pink' : 'text-[#8c5474]';
  const line = dark ? 'border-white/15' : 'border-brand-berry/15';
  const well = dark ? 'bg-[#2e1134]' : 'bg-[#f8e8dc]';
  const stripe = dark ? 'bg-brand-hot' : 'bg-brand-yellow';
  const chip = dark ? 'bg-brand-hot text-[#1f0a24]' : 'bg-brand-berry text-brand-cream';
  const cta = dark
    ? 'bg-brand-hot text-brand-cream hover:brightness-110'
    : 'key-prize bg-brand-yellow text-brand-berry hover:bg-brand-cream';

  return (
    <section
      id="pick"
      data-testid="pool-picker"
      data-mode={mode}
      className="scroll-mt-20 flex flex-col gap-5"
      aria-labelledby="pick-title"
    >
      <div className="flex flex-col gap-2">
        <h2 id="pick-title" className="font-display text-[32px] leading-9 font-extrabold text-brand-berry sm:text-[40px] sm:leading-[44px]">
          {COPY.landing.pickBoardTitle}
        </h2>
        <p className="max-w-[60ch] text-[16px] leading-6 font-medium text-brand-berry sm:text-[18px] sm:leading-7">
          {COPY.landing.pickBoardLine}
        </p>
      </div>

      <div className={`candy relative overflow-hidden rounded-[28px] border-2 ${shell}`}>
        <div aria-hidden="true" className={`absolute inset-x-0 top-0 h-2 ${stripe}`} />
        <div className="flex flex-col gap-5 p-5 pt-7 sm:p-7 sm:pt-9">
          {/* The two toggles: which board, which entry price. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Toggle
              label={COPY.landing.pickBoardAria}
              value={mode}
              onChange={(m) => {
                setMode(m);
                // Keep the tier if that ladder is open there; else its best tier.
                const cur = tiers.find((t) => t.tier === tier);
                if (!cur || cur[m] === null) setTier(defaultTier(tiers, m));
              }}
              options={[
                { value: 'easy', label: COPY.landing.board.easy.name, detail: COPY.landing.board.easy.title },
                { value: 'hard', label: COPY.landing.board.hard.name, detail: COPY.landing.board.hard.title },
              ]}
              tone={dark ? 'cream' : 'berry'}
              size="lg"
              data-testid="pool-picker-mode"
            />
            {tierOptions.length > 1 ? (
              <div className="flex flex-col items-end gap-1">
                <Toggle
                  label={COPY.landing.tierFilterAria}
                  value={String(tier)}
                  onChange={(v) => setTier(Number(v))}
                  options={tierOptions}
                  tone={dark ? 'cream' : 'berry'}
                  data-testid="pool-picker-tier"
                />
                {tierOptions.some((o) => o.disabled) ? (
                  <span className={`font-mono text-[10px] uppercase tracking-[0.1em] ${muted}`}>{COPY.landing.tierLegend}</span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            {/* The clip well: one loop, the mode's own. */}
            <div className={`relative aspect-[4/5] overflow-hidden rounded-[20px] ${well}`} aria-hidden="true">
              <AmbientClip
                key={mode}
                tiers={CLIP[mode].tiers}
                poster={CLIP[mode].poster}
                className="absolute inset-0 h-full w-full object-cover"
                playWhenVisible={0.4}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-full px-3.5 py-1 font-display text-[16px] font-black uppercase tracking-[0.1em] ${chip}`}>
                  {words.name}
                </span>
                <span
                  data-testid="pool-picker-state"
                  className={`font-mono text-[11px] font-bold uppercase tracking-[0.08em] ${pool ? '' : muted} ${pool ? (dark ? 'text-brand-pale-pink' : 'text-[#8c5474]') : ''}`}
                >
                  {pool
                    ? `● ${COPY.landing.openNow} · ${COPY.landing.seatsOf(pool.entrants)}`
                    : enabled
                      ? COPY.landing.opensSoon
                      : COPY.landing.tierNotOpen}
                </span>
              </div>
              <h3 className="font-display text-[40px] leading-[42px] font-extrabold sm:text-[48px] sm:leading-[50px]">{words.title}</h3>
              <p className="max-w-[48ch] text-[17px] leading-6 font-medium">{words.one}</p>

              <div className={`flex flex-col gap-2 rounded-[18px] p-4 ${well}`}>
                <p className={`font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${muted}`}>{COPY.landing.entryLooksLike}</p>
                <EntryDiagram mode={mode} dark={dark} />
                <p className={`text-[12px] leading-4 ${muted}`}>{words.caption}</p>
              </div>

              <div className="flex flex-col gap-2">
                <p className={`font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${muted}`}>{COPY.landing.howItPlays}</p>
                <ul className="flex flex-col gap-1.5">
                  {words.how.map((h) => (
                    <li key={h} className="flex gap-2.5 text-[14px] leading-5">
                      <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-[2px] ${stripe}`} />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={`rounded-[12px] border px-3.5 py-2.5 ${line}`}>
                <p className={`font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${muted}`}>{COPY.landing.bestFor}</p>
                <p className="text-[14px] leading-5 font-medium">{words.best}</p>
              </div>
            </div>
          </div>

          {/* The numbers: always on plum, so the prize is the one yellow and
              the clock reads the same on both card colours. */}
          {pool ? (
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 rounded-[20px] bg-[linear-gradient(180deg,var(--color-overlay)_0%,var(--color-game-raised)_38%,var(--color-game-base)_100%)] px-5 py-4 text-game-ink">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-game-ink-muted">{COPY.pool.prizeLabel}</span>
                <span className="tnum font-display text-[40px] leading-[42px] font-extrabold text-game-prize">
                  {lamportsToSol(pool.pot_lamports)}
                  <span className="ml-1.5 font-body text-[14px] font-medium">SOL</span>
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-game-ink-muted">{COPY.pool.entryLabel}</span>
                <span className="tnum font-display text-[22px] leading-6 font-extrabold">
                  {lamportsToSol(pool.entry_lamports)}
                  <span className="ml-1 font-body text-[12px] font-medium text-game-ink-muted">SOL</span>
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-game-ink-muted">{COPY.landing.seatsLabel}</span>
                <span className="tnum font-display text-[22px] leading-6 font-extrabold">
                  {pool.entrants}
                  <span className="ml-1 font-body text-[12px] font-medium text-game-ink-muted">/ 64</span>
                </span>
              </div>
              <Countdown deadlineUnix={pool.fill_deadline} serverTimeUnix={serverTime ?? pool.server_time} label={COPY.landing.closesIn} />
            </div>
          ) : (
            <p className={`text-[14px] leading-5 ${muted}`}>
              {enabled ? COPY.landing.opensSoonLine(mode) : COPY.landing.tierNotOpen}
            </p>
          )}

          {/* §8.6: above the enter control, always. */}
          <p className={`max-w-prose text-[12px] leading-4 ${muted}`}>{COPY.pool.decisionsFinal}</p>
          {pool ? (
            <Link
              href={`/pools/${pool.pool}`}
              data-testid="pool-picker-enter"
              className={`flex h-14 items-center justify-center rounded-full font-display text-[20px] font-extrabold uppercase tracking-wide transition-colors ${cta}`}
            >
              {mode === 'easy' ? COPY.landing.enterEasy : COPY.landing.enterHard}
            </Link>
          ) : (
            <span
              aria-disabled="true"
              data-testid="pool-picker-enter"
              className={`flex h-14 items-center justify-center rounded-full border-2 font-display text-[20px] font-extrabold uppercase tracking-wide opacity-60 ${dark ? 'border-brand-hot' : 'border-brand-berry'}`}
            >
              {enabled ? COPY.landing.opensSoon : COPY.landing.tierNotOpen}
            </span>
          )}
          <a href="#demo" className="text-center text-[13px] font-medium underline underline-offset-2">
            {COPY.landing.tryBoardFirst}
          </a>
          <p className={`text-center text-[11px] ${muted}`}>{COPY.pool.ageTerritoryNote}</p>
        </div>
      </div>
    </section>
  );
}
