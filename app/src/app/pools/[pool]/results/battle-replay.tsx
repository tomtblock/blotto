'use client';

/*
 * The replay frame (V2, founder 2026-09-27): the signed-in player's seven
 * published battles against one opponent's, fought on screen. Every number
 * comes from the published bundle; every verdict from the scoring engine
 * (results/replay.ts). A play key starts it, a skip key ends it, reduced
 * motion shows the end at once.
 *
 * Each battle is a row of five lanes; in a lane the two crowds are bars that
 * shrink as bodies fall, one for one, until the smaller side is gone. A
 * resolved lane wears the stat's verdict; a resolved battle wears the
 * engine's. Win and loss wear priceUp/priceDown — their one sanctioned
 * semantics. Widths are integer percentages, display only.
 */

import { useEffect, useRef, useState } from 'react';
import type { BattleSet } from '@blotto/scoring';
import { STAT_NAMES } from '@/battle/allocation';
import { COPY } from '@/copy';
import { usePrefersReducedMotion } from '@/components/blot/springs';
import { Button } from '@/components/ui/button';
import { clashVerdict, fightDurationMs, headToHead, MARCH_MS, replayFrame, RESULT_HOLD_MS, type ClashState } from '@/results/replay';

const ABBR = ['STR', 'SPD', 'HRT', 'WIT', 'DUR'] as const;

type Phase = 'idle' | 'march' | 'fight' | 'done';

function pct(left: number, of: number): number {
  return of === 0 ? 0 : Math.round((left * 100) / of);
}

function Lane({ c, z }: { c: ClashState; z: number }) {
  const of = Math.max(c.mine, c.theirs, 1);
  const verdict = c.resolved ? clashVerdict(c) : null;
  const tone =
    verdict === 'mine' ? 'ring-1 ring-price-up/70' : verdict === 'theirs' ? 'ring-1 ring-price-down/70' : verdict === 'level' ? 'ring-1 ring-white/25' : '';
  return (
    <div
      className={`flex min-w-0 flex-col gap-0.5 rounded-md bg-black/25 px-1.5 py-1 ${tone}`}
      title={`${STAT_NAMES[z]}: ${c.mine} v ${c.theirs}`}
      data-verdict={verdict ?? 'open'}
    >
      <span className="font-mono text-[9px] tracking-[0.08em] text-ink-muted">{ABBR[z]}</span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-brand transition-[width] duration-100" style={{ width: `${pct(c.mineLeft, of)}%` }} />
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-brand-cream/70 transition-[width] duration-100" style={{ width: `${pct(c.theirsLeft, of)}%` }} />
      </div>
      <span className="tnum font-mono text-[10px] text-ink">
        {c.mineLeft}
        <span className="text-ink-muted"> · </span>
        {c.theirsLeft}
      </span>
    </div>
  );
}

export function BattleReplay({ mine, theirs, opponentLabel }: { mine: BattleSet; theirs: BattleSet; opponentLabel: string }) {
  const r = COPY.results.yourResult;
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const duration = fightDurationMs(mine, theirs);
  const raf = useRef<number | null>(null);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    if (timer.current !== null) window.clearTimeout(timer.current);
    raf.current = null;
    timer.current = null;
  };
  useEffect(() => stop, []);

  const finish = () => {
    stop();
    setElapsed(duration);
    setPhase('done');
  };
  const play = () => {
    stop();
    setElapsed(0);
    if (reduced) {
      finish();
      return;
    }
    setPhase('march');
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setPhase('fight');
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(duration, Math.floor(now - start));
        setElapsed(t);
        if (t >= duration) {
          timer.current = window.setTimeout(() => setPhase('done'), RESULT_HOLD_MS);
          return;
        }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    }, MARCH_MS);
  };

  const frame = replayFrame(mine, theirs, phase === 'idle' || phase === 'march' ? 0 : elapsed);
  const verdict = phase === 'done' ? headToHead(frame.tally) : null;
  const headline =
    verdict === null ? null : verdict.winner === 'mine' ? r.replayAhead : verdict.winner === 'theirs' ? r.replayBehind : r.replayLevel;

  return (
    <div className="flex flex-col gap-3" data-testid="battle-replay" data-phase={phase}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] leading-5 text-ink-muted">{r.replayTitle(opponentLabel)}</p>
        <div className="flex gap-2">
          {phase === 'idle' || phase === 'done' ? (
            <Button intent="cream" onClick={play} data-testid="replay-play">
              {phase === 'done' ? r.replayAgain : r.replayPlay}
            </Button>
          ) : (
            <Button intent="quiet" onClick={finish} data-testid="replay-skip">
              {r.replaySkip}
            </Button>
          )}
        </div>
      </div>
      <div
        className={`relative flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 transition-opacity ${phase === 'idle' ? 'opacity-70' : ''}`}
        aria-live="polite"
      >
        <div className="flex items-center gap-4 px-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-4 rounded-full bg-brand" /> {r.replayYou}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-4 rounded-full bg-brand-cream/70" /> {opponentLabel}
          </span>
          {phase === 'march' ? <span className="ml-auto animate-pulse text-ink">{r.replayMarch}</span> : null}
        </div>
        {frame.fields.map((f) => {
          const tone = !f.resolved
            ? 'border-white/10'
            : f.comparison.outcome === 'win'
              ? 'border-price-up/60'
              : f.comparison.outcome === 'loss'
                ? 'border-price-down/60'
                : 'border-white/30';
          return (
            <div key={f.field} className={`grid grid-cols-[64px_1fr] items-center gap-2 rounded-xl border ${tone} p-1.5`} data-outcome={f.resolved ? f.comparison.outcome : 'open'}>
              <div className="flex flex-col">
                <span className="text-[12px] font-semibold text-ink">{r.replayBattle(f.field + 1)}</span>
                <span className="tnum font-mono text-[10px] text-ink-muted">
                  {f.resolved
                    ? f.comparison.outcome === 'win'
                      ? r.replayWon
                      : f.comparison.outcome === 'loss'
                        ? r.replayLost
                        : r.replayDrawn
                    : `${f.comparison.statsA === 0 && f.comparison.statsB === 0 ? '' : ''}`}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {f.clashes.map((c, z) => (
                  <Lane key={z} c={c} z={z} />
                ))}
              </div>
            </div>
          );
        })}
        <p className="tnum px-1 pt-1 text-[13px] font-semibold text-ink">
          {r.replayTally(frame.tally.wins, frame.tally.losses, frame.tally.draws)}
          {headline ? <span className="ml-2 font-normal text-ink-muted">— {headline}{verdict?.byStats ? ` ${r.replayByStats}` : ''}</span> : null}
        </p>
      </div>
    </div>
  );
}
