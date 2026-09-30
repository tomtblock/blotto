'use client';

/*
 * The pool picker (V2, founder 2026-09-27; Figma review page 02, Concept A
 * as ONE card; V3 laid out to the founder's Example Entry Card sketch): the
 * home page's one card for entering. An Easy / Hard toggle switches the
 * whole card — its colours, its clip, its words — and a tier filter across
 * the top chooses the entry price. Tiers the founder has not opened are
 * listed greyed with "Not open yet" and cannot be chosen (founder ruling
 * 2026-09-27, reversing the 12 September "not listed at all"); nothing here
 * decides whether a tier is open — `GET /tiers` and the pools list do, on
 * the server, and the page hands the answer in.
 *
 * The sketch: the clip on the left; on the right the mode in one line, a
 * "Best for" box and the numbers box (prize, entry, seats, closes in), the
 * three of them the clip's height; the enter key the full width underneath.
 * Every number on the card is the POOL's own record (the pot it opened
 * with, its entry, its seats, its deadline against the server's clock),
 * never a table. Class is nowhere on this card. The clip is muted, looped
 * and one at a time (the motion rule).
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

function defaultTier(tiers: readonly PickerTier[], mode: BoardMode): number {
  const withOpen = tiers.find((t) => t[mode] !== null);
  if (withOpen) return withOpen.tier;
  const anyOpen = tiers.find((t) => t.easy !== null || t.hard !== null);
  if (anyOpen) return anyOpen.tier;
  const enabled = tiers.find((t) => t.easyEnabled || t.hardEnabled);
  return enabled ? enabled.tier : (tiers[0]?.tier ?? 0);
}

/** The small caps label over a number or a box. */
const LABEL = 'font-mono text-[10px] font-bold uppercase tracking-[0.12em]';

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
    ? 'home-card--hot bg-[#1f0a24] text-brand-cream border-brand-hot'
    : 'home-card bg-brand-cream text-brand-berry border-brand-yellow';
  const muted = dark ? 'text-brand-pale-pink' : 'text-[#8c5474]';
  // The boxes on the right: the card's own well colour with a hairline, so
  // they sit IN the card (V3: the plum numbers box read as pasted on).
  const box = dark ? 'rounded-[18px] border border-white/15 bg-[#2e1134]' : 'rounded-[18px] border border-brand-berry/15 bg-[#f8e8dc]';
  const well = dark ? 'bg-[#2e1134]' : 'bg-[#f8e8dc]';
  /* The numbers box's inner rules (V4). */
  const rule = dark ? 'border-white/15' : 'border-brand-berry/15';
  const stripe = dark ? 'bg-brand-hot' : 'bg-brand-yellow';
  const chip = dark ? 'bg-brand-hot text-[#1f0a24]' : 'bg-brand-berry text-brand-cream';
  const prize = dark ? 'text-brand-yellow' : 'text-brand-deep-magenta';
  const cta = dark
    ? 'key-action bg-brand-hot text-brand-cream hover:brightness-110'
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

      <div className={`relative overflow-hidden rounded-[28px] border-2 ${shell}`}>
        <div aria-hidden="true" className={`absolute inset-x-0 top-0 h-2 ${stripe}`} />
        <div className="flex flex-col gap-5 p-5 pt-7 sm:p-7 sm:pt-9">
          {/* The two toggles: which board, which entry price. */}
          <div className="flex flex-wrap items-start justify-between gap-3">
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

          <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-5">
            {/* The clip well: one loop, the mode's own. It sets the row's height. */}
            <div className={`relative aspect-[4/5] overflow-hidden rounded-[20px] ${well}`} aria-hidden="true">
              <AmbientClip
                key={mode}
                tiers={CLIP[mode].tiers}
                poster={CLIP[mode].poster}
                className="absolute inset-0 h-full w-full object-cover"
                playWhenVisible={0.4}
                preload="none"
              />
            </div>

            {/* The three boxes, the clip's height between them. */}
            <div className="flex min-w-0 flex-col gap-3">
              <div className={`flex flex-col gap-2 px-4 py-3.5 ${box}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`rounded-full px-3 py-0.5 font-display text-[14px] font-black uppercase tracking-[0.1em] ${chip}`}>
                    {words.name}
                  </span>
                  <span data-testid="pool-picker-state" className={`font-mono text-[11px] font-bold uppercase tracking-[0.08em] ${muted}`}>
                    {pool
                      ? `● ${COPY.landing.openNow} · ${COPY.landing.seatsOf(pool.entrants)}`
                      : enabled
                        ? COPY.landing.opensSoon
                        : COPY.landing.tierNotOpen}
                  </span>
                </div>
                <h3 className="font-display text-[32px] leading-9 font-extrabold sm:text-[40px] sm:leading-[42px]">{words.title}</h3>
                <p className="text-[15px] leading-5 font-medium sm:text-[16px] sm:leading-6">{words.one}</p>
              </div>

              <div className={`px-4 py-3 ${box}`}>
                <p className={`${LABEL} ${muted}`}>{COPY.landing.bestFor}</p>
                <p className="text-[15px] leading-5 font-medium">{words.best}</p>
              </div>

              {/* The numbers box fills what is left of the clip's height (V4:
                  the prize and the clock large on the top line, the entry
                  and the seats smaller below, every cell ruled). */}
              {pool ? (
                <div className={`grid flex-1 grid-cols-2 grid-rows-[auto_auto] content-stretch overflow-hidden ${box} ${dark ? 'border-white/25' : 'border-brand-berry/30'}`} data-testid="pool-picker-numbers">
                  <div className={`flex flex-col justify-center gap-0.5 border-r border-b px-4 py-3 ${rule}`}>
                    <span className={`${LABEL} ${muted}`}>{COPY.pool.prizeLabel}</span>
                    <span className={`tnum font-display text-[42px] leading-[44px] font-extrabold ${prize}`}>
                      {lamportsToSol(pool.pot_lamports)}
                      <span className="ml-1.5 font-body text-[15px] font-medium">SOL</span>
                    </span>
                  </div>
                  <div className={`flex flex-col justify-center border-b px-4 py-3 ${rule} [&_span]:font-mono [&_span]:text-[10px] [&_span]:font-bold [&_span]:tracking-[0.12em] [&_time]:text-[38px] [&_time]:leading-[44px] [&_time]:font-extrabold`}>
                    <Countdown
                      deadlineUnix={pool.fill_deadline}
                      serverTimeUnix={serverTime ?? pool.server_time}
                      label={COPY.landing.closesIn}
                      tone="inherit"
                    />
                  </div>
                  <div className={`flex flex-col justify-center gap-0.5 border-r px-4 py-2.5 ${rule}`}>
                    <span className={`${LABEL} ${muted}`}>{COPY.pool.entryLabel}</span>
                    <span className="tnum font-display text-[20px] leading-6 font-extrabold">
                      {lamportsToSol(pool.entry_lamports)}
                      <span className={`ml-1 font-body text-[11px] font-medium ${muted}`}>SOL</span>
                    </span>
                  </div>
                  <div className="flex flex-col justify-center gap-0.5 px-4 py-2.5">
                    <span className={`${LABEL} ${muted}`}>{COPY.landing.seatsLabel}</span>
                    <span className="tnum font-display text-[20px] leading-6 font-extrabold">
                      {pool.entrants}
                      <span className={`ml-1 font-body text-[11px] font-medium ${muted}`}>/ 64</span>
                    </span>
                  </div>
                </div>
              ) : (
                <div className={`flex flex-1 items-center px-4 py-4 ${box}`}>
                  <p className={`text-[14px] leading-5 ${muted}`}>{enabled ? COPY.landing.opensSoonLine(mode) : COPY.landing.tierNotOpen}</p>
                </div>
              )}
            </div>
          </div>

          {/* §8.6: above the enter control, always — on one line where the
              card is wide enough (V3), wrapped on a phone. */}
          <p className={`text-[12px] leading-4 sm:whitespace-nowrap ${muted}`}>{COPY.pool.decisionsFinal}</p>
          {pool ? (
            <Link
              href={`/play?pool=${pool.pool}`}
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
          <p className={`text-center text-[11px] ${muted}`}>{COPY.pool.ageTerritoryNote}</p>
        </div>
      </div>
    </section>
  );
}
