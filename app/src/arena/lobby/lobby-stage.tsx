'use client';

/*
 * The sealed lobby — a 64-seat grid filling with sealed passes.
 *
 * A sealed entry has exactly ONE honest visual: the pass egg
 * (src/reveal/components/pass-shell.tsx — the shared implementation; a
 * second egg drawing is a named defect class). This surface renders from
 * `LobbyVisual` only, which carries no allocation/score/ranking field at
 * the type level — the sealing guarantee, structural.
 *
 * Performance rule (the reveal's WebKit lesson): only the DELTA seats
 * animate on an entrant-count increase; everything already seated is
 * static. No filters or box-shadow loops on the grid.
 */

import { useState } from 'react';
import { LazyMotion, MotionConfig, domAnimation, m } from 'motion/react';
import { COPY } from '@/copy';
import { GhostPassGlyph, StaticPassGlyph } from '@/reveal/components/pass-shell';
import { Countdown } from '@/app/pools/[pool]/countdown';
import type { LobbyVisual } from '@/arena/phase';
import {
  EASE_JUICE,
  SEAT_POP_DURATION_MS,
  SEAT_POP_SCALE_FROM,
} from '@/arena/playback/constants';

const CAPACITY = 64;
const sec = (ms: number) => ms / 1000;

export function LobbyStage({ visual }: { visual: LobbyVisual }) {
  // Seats present at mount render static; only later arrivals pop (their
  // <m.div initial> runs once, at that list item's own mount).
  const [seatsAtMount] = useState(() => new Set(visual.seats.map((s) => s.idx)));
  const seatByIdx = new Map(visual.seats.map((s) => [s.idx, s]));
  const closed = visual.state !== 'Open';

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <section className="flex flex-col gap-5">
          <header className="flex items-baseline justify-between">
            <div>
              <h2 className="font-[family-name:var(--font-unbounded)] text-lg">
                {COPY.arena.lobby.title}
              </h2>
              <p className="text-sm opacity-70">{COPY.pool.entrantsOf(visual.entrants)}</p>
            </div>
            {!closed && (
              <div className="text-right">
                <div className="text-sm opacity-60">{COPY.pool.fillDeadline}</div>
                <Countdown deadlineUnix={visual.fillDeadline} />
              </div>
            )}
          </header>

          <ol className="grid grid-cols-8 gap-2" aria-label={COPY.pool.entrantsOf(visual.entrants)}>
            {Array.from({ length: CAPACITY }, (_, idx) => {
              const seat = seatByIdx.get(idx);
              if (!seat) {
                return (
                  <li key={idx} className="flex justify-center">
                    <GhostPassGlyph className="h-10 w-8 opacity-50" />
                  </li>
                );
              }
              const arrived = !seatsAtMount.has(idx);
              return (
                <li
                  key={idx}
                  className={`flex justify-center rounded ${seat.mine ? 'ring-2 ring-[var(--color-brand)]' : ''}`}
                  title={seat.playerShort}
                >
                  <m.div
                    initial={arrived ? { scale: SEAT_POP_SCALE_FROM, opacity: 0 } : false}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: sec(SEAT_POP_DURATION_MS), ease: EASE_JUICE }}
                    className={arrived ? 'motion-pulse' : undefined}
                  >
                    <StaticPassGlyph uid={`lobby-${idx}`} className="h-10 w-8" />
                  </m.div>
                </li>
              );
            })}
          </ol>

          {visual.seats.some((s) => s.mine) && (
            <p className="text-sm opacity-80">{COPY.arena.lobby.yourSeat}</p>
          )}
          <p className="max-w-prose text-sm opacity-70">
            {closed ? COPY.arena.lobby.sealedAt : COPY.arena.lobby.waitingNote}
          </p>
          <p className="max-w-prose text-xs opacity-50">{COPY.pool.sealed}</p>
        </section>
      </MotionConfig>
    </LazyMotion>
  );
}
