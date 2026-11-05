'use client';

/*
 * The pool picker (V2, founder 2026-09-27; Figma review page 02, Concept A
 * as ONE card; V3 laid out to the founder's Example Entry Card sketch): the
 * home page's one card for entering. An Easy / Hard toggle switches the
 * whole card — its colours, its clip, its words — and a tier filter across
 * the top chooses the entry price. Tiers the founder has not opened are
 * listed greyed with "Not open yet" and cannot be chosen (founder ruling
 * 2026-09-27, reversing the 12 September "not listed at all"); nothing here
 * decides whether a tier is open — `GET /pool-types` and the pools list do, on
 * the server, and the page hands the answer in.
 *
 * The sketch: the clip on the left; on the right the mode in one line, a
 * "Best for" box and the numbers box (prize, entry, players, closes in),
 * the three of them the clip's height; the enter key the full width
 * underneath. Every number on the card is the POOL's own record (the prize
 * pool and table it opened with, its entry, its size, its deadline against
 * the server's clock). Class is nowhere on this card. The clip is muted,
 * looped and one at a time (the motion rule).
 *
 * THE LADDER (D-E19, founder brief 2026-11-05: keep the structure, let a
 * player toggle size AND board easily). The controls row carries the board
 * toggle on the left and a four-option SIZE toggle on the right — "8 · 16 ·
 * 32 · 64", each with its live fill on the board on show ("5/8"), so the
 * toggle doubles as a view of every pool. Board and size live in the URL
 * (`?mode=…&size=…`, picker-state.ts) so a link opens the card on a pool
 * and Back walks the toggles. The tier toggle, when more than one tier is
 * open, takes its own row below. The card names the pool by players and
 * prizes ("16 players · 4 prizes · 1st 0.5 SOL"), its numbers box counts
 * players entered of the pool's own size, and a compact prize table sits
 * above the Enter key.
 */

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { PoolCapacity } from '@blotto/scoring';
import { COPY } from '@/copy';
import { lamportsToSol, poolLadder } from '@/data/format';
import type { BoardMode } from '@/battle/board/mode';
import { Toggle } from '@/components/ui/toggle';
import { Countdown } from '@/components/ui/countdown';
import { AmbientClip } from '@/components/ui/ambient-clip';
import { PrizeTable, prizeSummary } from '@/components/pools/prize-table';
import {
  defaultTier,
  fillLabel,
  pickerSelection,
  tierChoosable,
  writePickerParams,
  type PickerTier,
} from './picker-state';

export type { PickerSlot, PickerTier } from './picker-state';

/*
 * The query string as an external store. The server renders the defaults
 * (it has no URL to read without making the landing dynamic, and the
 * landing is cached at the edge for ten seconds — data/api.ts); the client
 * reads the real query after hydration and on every Back/Forward. A toggle
 * writes the query with `history.pushState`, which Next's router takes in
 * without a fetch (node_modules/next/dist/docs, "Native History API"), and
 * tells the store itself, since pushState fires no event.
 *
 * PHASE-N-REVIEW: a store over `location.search` rather than
 * `useSearchParams`, which on a prerendered page needs a Suspense boundary
 * and would ship the picker as a fallback-then-swap. The cost is the same
 * either way: a deep link shows the default card until hydration.
 */
const searchListeners = new Set<() => void>();
function subscribeSearch(cb: () => void): () => void {
  searchListeners.add(cb);
  window.addEventListener('popstate', cb);
  return () => {
    searchListeners.delete(cb);
    window.removeEventListener('popstate', cb);
  };
}
const readSearch = () => window.location.search;
const serverSearch = () => '';

function pushChoice(mode: BoardMode, size: PoolCapacity): void {
  const next = writePickerParams(window.location.search, mode, size);
  window.history.pushState(null, '', `${window.location.pathname}${next}${window.location.hash}`);
  for (const cb of searchListeners) cb();
}

const CLIP = {
  easy: { tiers: [{ mp4: '/motion/v2/easy.mp4', webm: '/motion/v2/easy.webm' }], poster: '/motion/v2/easy.jpg' },
  hard: { tiers: [{ mp4: '/motion/v2/hard.mp4', webm: '/motion/v2/hard.webm' }], poster: '/motion/v2/hard.jpg' },
} as const;

/** The small caps label over a number or a box. */
const LABEL = 'font-mono text-[10px] font-bold uppercase tracking-[0.12em]';

export function PoolPicker({ tiers, serverTime }: { tiers: readonly PickerTier[]; serverTime: string | null }) {
  const search = useSyncExternalStore(subscribeSearch, readSearch, serverSearch);
  // The tier is the player's own choice once they make one; until then the
  // default for the board on show. Board and size are the URL's.
  const [tierChoice, setTierChoice] = useState<number | null>(null);
  const { mode, size, row } = pickerSelection(tiers, search, tierChoice);
  const slots = row ? row[mode] : [];
  const slot = slots.find((x) => x.capacity === size) ?? null;
  const pool = slot?.pool ?? null;
  const enabled = slot ? slot.live || slot.pool !== null : false;
  const ladder = pool ? poolLadder(pool) : null;
  // The pool's own table where a pool is open; else what its type opens with.
  const amounts = ladder ? ladder.prizeAmounts : (slot?.typeAmounts ?? []).map((a) => BigInt(a));
  const dark = mode === 'hard';
  const words = COPY.landing.board[mode];

  const tierOptions = tiers.map((t) => ({
    value: String(t.tier),
    label: `${lamportsToSol(t.entryLamports)} SOL`,
    disabled: !tierChoosable(t),
    disabledReason: COPY.landing.tierNotOpen,
  }));
  /*
   * PHASE-N-REVIEW (founder brief 2026-11-05): the tier toggle shows only
   * when more than one tier is open — the brief's reading of the card — and
   * then on its own row, listing every configured tier with the unopened
   * ones greyed (the ruling of 2026-09-27). The code before this change drew
   * the seven-price row even with one tier open.
   */
  const showTiers = tiers.filter(tierChoosable).length > 1;
  const sizeOptions = slots.map((x) => {
    const fill = fillLabel(x);
    return {
      value: String(x.capacity),
      label: String(x.capacity),
      detail: fill,
      ariaLabel: COPY.landing.sizeOptionAria(x.capacity, fill),
      disabled: !x.pool && !x.live,
      disabledReason: COPY.landing.sizeNotOpen,
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
      data-size={size}
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
          {/* The two toggles: which board, how many players (D-E19). Board
              left, size right; on a phone the size row wraps under. */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Toggle
              label={COPY.landing.pickBoardAria}
              value={mode}
              onChange={(m) => {
                // Keep the size (founder brief). Keep the tier if the other
                // board offers anything there; else that board's best tier.
                if (row && !row[m].some((x) => x.pool !== null || x.live)) setTierChoice(defaultTier(tiers, m));
                pushChoice(m, size);
              }}
              options={[
                { value: 'easy', label: COPY.landing.board.easy.name, detail: COPY.landing.board.easy.title },
                { value: 'hard', label: COPY.landing.board.hard.name, detail: COPY.landing.board.hard.title },
              ]}
              tone={dark ? 'cream' : 'berry'}
              size="lg"
              data-testid="pool-picker-mode"
            />
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <span className={`${LABEL} ${muted}`} aria-hidden="true">
                {COPY.landing.sizeLabel}
              </span>
              <Toggle
                label={COPY.landing.sizeAria}
                value={String(size)}
                onChange={(v) => pushChoice(mode, Number(v) as PoolCapacity)}
                options={sizeOptions}
                tone={dark ? 'cream' : 'berry'}
                layout="stacked"
                data-testid="pool-picker-size"
              />
            </div>
          </div>
          {showTiers ? (
            <div className="flex flex-col items-start gap-1">
              <Toggle
                label={COPY.landing.tierFilterAria}
                value={String(row?.tier ?? 0)}
                onChange={(v) => setTierChoice(Number(v))}
                options={tierOptions}
                tone={dark ? 'cream' : 'berry'}
                data-testid="pool-picker-tier"
              />
              {tierOptions.some((o) => o.disabled) ? (
                <span className={`font-mono text-[10px] uppercase tracking-[0.1em] ${muted}`}>{COPY.landing.tierLegend}</span>
              ) : null}
            </div>
          ) : null}

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
                    {pool ? `● ${COPY.landing.openNow}` : enabled ? COPY.landing.opensSoon : COPY.landing.tierNotOpen}
                  </span>
                </div>
                <h3 className="font-display text-[32px] leading-9 font-extrabold sm:text-[40px] sm:leading-[42px]">{words.title}</h3>
                {/* D-E19: the pool by players and prizes — its own size and table. */}
                <p data-testid="pool-picker-summary" className="tnum font-display text-[17px] leading-6 font-extrabold sm:text-[19px]">
                  {prizeSummary(ladder?.capacity ?? size, amounts)}
                </p>
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
                      {/* The unit is small text, so it needs 4.5:1, which the light card's
                          magenta (3.6:1 on #f8e8dc) does not reach; the 42 px figure is
                          large text and passes at 3:1 (D-E12, 2026-10-26). */}
                      <span className={`ml-1.5 font-body text-[15px] font-medium ${dark ? '' : 'text-brand-berry'}`}>SOL</span>
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
                    <span className={`${LABEL} ${muted}`}>{COPY.landing.playersLabel}</span>
                    {/* Entered of the POOL's own size (D-E19), never a typed 64. */}
                    <span className="tnum font-display text-[20px] leading-6 font-extrabold" data-testid="pool-picker-players">
                      {pool.entrants}
                      <span className={`ml-1 font-body text-[11px] font-medium ${muted}`}>/ {ladder?.capacity ?? size}</span>
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

          {/* D-E19: what each place is paid, from the pool's own table,
              above the enter control. Only for an open pool: the numbers on
              this card are the pool's record. */}
          {pool && ladder ? (
            <PrizeTable amounts={ladder.prizeAmounts} capacity={ladder.capacity} variant="compact" tone={dark ? 'dark' : 'light'} />
          ) : null}
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
