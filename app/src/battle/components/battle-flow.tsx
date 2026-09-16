'use client';

/*
 * The seven-battle RUN (v4, founder brief 2026-09-06; the machine, founder
 * 2026-09-09): Approved → seven battle screens in the MACHINE → Seven made
 * (crescendo, montage, share) → the two-step seal. The machine reducer
 * (src/battle/machine.ts) owns every rule; this component feeds ticks and
 * renders state — it never sees a wallet, and sealing still happens outside
 * via `onConfirm`, unchanged.
 *
 * The machine (Cabinet.tsx): the Blot in the glass window, the dials on the
 * deck. Lock-in is choreographed exactly as the founder described it: the
 * locked Blot DROPS out through the chute, a still of its final shape is
 * taken, its five numbers are logged, and one of the seven tiles under the
 * machine fills; the next Blot RISES into the window. The seventh lock is
 * the crescendo — confetti and all seven tiles lifting together — and then
 * the seal steps, untouched (PID §8.6 line above every seal control).
 *
 * The run clock is the calm slate ring — never red, never pulsing — and
 * starts on the first dial touch (a slow wallet eats nothing).
 *
 * Lock-in captures a 1024×1024 still (shapes only, no numbers) into
 * IndexedDB for the montage and My Blots; capture is best-effort and can
 * never block or delay the seal. Sharing the montage never blocks sealing
 * either. Stills are pictures of the allocation and stay on the device
 * like the allocation itself (render-still.ts).
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { BlottRaster } from '@/components/blott/BlottRaster';
import { Cabinet } from '@/components/blot/Cabinet';
import { StatDials } from '@/components/blot/StatDials';
import { Timer } from '@/components/blot/Timer';
import { useBlotSprings, usePrefersReducedMotion } from '@/components/blot/springs';
import { renderBlottStill } from '@/components/blott/render-still';
import { Playground } from '@/components/blott/Antics';
import { ConfettiBurst } from '@/components/celebrate/confetti-burst';
import { EVEN_SPLIT, type Allocation } from '../allocation';
import { BATTLES, initialState, reduce } from '../machine';
import { sampleTick } from '../run-clock';
import { saveStill } from '../stills';
import { SevenTiles, type TileEntry } from './seven-tiles';

/*
 * How often the run clock is SAMPLED — not how much time each sample is
 * worth (audit 2026-09-11, F-04). See the effect below.
 */
const TICK_MS = 100;
/** The drop through the chute (blot.css `.blot-drop`, 780 ms) plus a beat. */
const LOCK_BEAT_MS = 1000;
/** Set the first time this wallet seals — flips the share line to "seven". */

export interface BattleFlowProps {
  /** Pool address — keys the lock-in stills in IndexedDB. */
  poolAddress: string;
  onConfirm: (battles: readonly Allocation[], timingsMs: readonly number[]) => void;
  /**
   * Fired when the player BEGINS the run — from here until the seal, seven
   * allocations exist only in this component's state and unmounting it
   * destroys them. The page uses this to stop transient auth or balance
   * churn from taking the screen away mid-run (audit C-17 / D-13).
   */
  onRunStarted?: () => void;
}

export function BattleFlow({ poolAddress, onConfirm, onRunStarted }: BattleFlowProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState());
  const confirmed = useRef(false);
  const [sealArmed, setSealArmed] = useState(false);
  // The lock beat: the Blot drops out of the chute before the advance.
  const [locking, setLocking] = useState(false);
  const [leaveSheet, setLeaveSheet] = useState(false);
  const stillBlobs = useRef<(Blob | null)[]>(Array.from({ length: BATTLES }, () => null));
  // The rack under the machine: the machine's own record of locked battles
  // (plus the one dropping right now), each with its still once it renders.
  // Object URLs are revoked on unmount.
  const [stillUrls, setStillUrls] = useState<(string | null)[]>([]);
  const tileUrls = useRef<string[]>([]);
  const [celebrated, setCelebrated] = useState(false);
  const reduced = usePrefersReducedMotion();

  const battle = state.phase === 'battle' ? state : null;
  const allocation: Allocation = battle ? battle.alloc : EVEN_SPLIT;
  const { display, velocity } = useBlotSprings(allocation, reduced);
  const [dragStat, setDragStat] = useState<number | null>(null);

  /*
   * THE RUN CLOCK — elapsed time, not timer firings (audit 2026-09-11,
   * F-04).
   *
   * This used to dispatch a FIXED `ms: TICK_MS` on every `setInterval`
   * callback, so the ninety seconds were ninety seconds' worth of TIMER
   * FIRINGS. Browsers throttle timers in a background tab hard — to roughly
   * one per second, and less on mobile — so switching tabs, or being
   * interrupted by a call, bought arbitrary extra deliberation on a battle
   * screen and the clock on screen agreed with it. That is a competitive-
   * integrity defect, not a display one: every player is scored against
   * every other, so time one player gains is taken from all of them.
   *
   * Measured against `performance.now()`, which is monotonic (immune to a
   * device clock changing under us, and to daylight saving). Throttled or
   * backgrounded, the next sample simply carries the whole elapsed span, so
   * a tab that comes back after two minutes finds the run over — which is
   * what the founder-owned 90 s means.
   *
   * INTEGER MILLISECONDS, always: the per-screen timings travel in the
   * sealed payload as u32s and `encodePayload` refuses a non-integer
   * outright (backend/sealing/src/payload.ts). The fractional remainder
   * stays on the baseline rather than being dropped, so the accounting is
   * exact over the whole run.
   *
   * The founder-owned values are untouched: the 90 s budget (run-clock.ts)
   * and the 15 s per-screen default (R9) are not read or changed here —
   * only how the passage of time is measured.
   */
  const ticking = Boolean(battle) || locking;
  const tickBaseline = useRef<number | null>(null);
  useEffect(() => {
    if (!ticking) {
      tickBaseline.current = null;
      return;
    }
    if (tickBaseline.current === null) tickBaseline.current = performance.now();
    const id = setInterval(() => {
      const base = tickBaseline.current;
      if (base === null) return;
      // The arithmetic — integer ms, remainder carried — lives in
      // run-clock.ts's `sampleTick`, where it is pinned by tests.
      const sample = sampleTick(base, performance.now());
      if (sample.ms <= 0) return;
      tickBaseline.current = sample.baseline;
      dispatch({ type: 'tick', ms: sample.ms });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [ticking]);

  useEffect(() => {
    if (state.phase === 'confirmed' && !confirmed.current) {
      confirmed.current = true;
      try {
      } catch {
        /* the share line heuristic degrades to "first" — harmless */
      }
      onConfirm(state.battles, state.timingsMs);
    }
  }, [state, onConfirm]);

  useEffect(() => {
    const urls = tileUrls.current;
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, []);

  /* Back navigation during the run: a plum sheet, the factual line, no
   * pressure language beyond the fact. */
  const inBattle = state.phase === 'battle';
  useEffect(() => {
    if (!inBattle) return;
    history.pushState({ blottoRun: true }, '');
    const onPop = () => setLeaveSheet(true);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [inBattle]);

  /** Attach a rendered still to tile `k` (0-based). */
  const attachStill = useCallback((k: number, png: Blob) => {
    const url = URL.createObjectURL(png);
    tileUrls.current.push(url);
    setStillUrls((prev) => {
      const next = prev.slice();
      while (next.length <= k) next.push(null);
      next[k] = url;
      return next;
    });
  }, []);

  const lockIn = useCallback(() => {
    if (!battle || locking) return;
    const alloc = battle.alloc;
    const battleNo = battle.screen + 1;
    // The tile fills at once with the numbers (derived below from the
    // machine's record plus this dropping Blot); the still follows when it
    // renders. Best-effort still — never blocks the run, never the seal.
    renderBlottStill(alloc)
      .then((png) => {
        stillBlobs.current[battleNo - 1] = png;
        attachStill(battleNo - 1, png);
        return saveStill({ pool: poolAddress, battle: battleNo, png });
      })
      .catch(() => {});
    setLocking(true);
    setTimeout(
      () => {
        setLocking(false);
        dispatch({ type: 'lock_in' });
      },
      reduced ? 0 : LOCK_BEAT_MS
    );
  }, [battle, locking, poolAddress, reduced, attachStill]);

  /* Seven made: make sure all seven stills and tiles exist (expiry can skip
   * some — those battles are the even split). The stills stay ON THIS DEVICE
   * (stills.ts) until the pool closes: a still is the allocation drawn, and
   * the montage that used to be composed here — and offered for sharing
   * before anything was sealed — was the sealed line-up in silhouette. The
   * seven-Blott share now lives on the results page, once the pool has
   * closed (results/share-seven.tsx); the pass is what a player shares at
   * entry (play/pass-card.tsx). 2026-09-13. */
  const review = state.phase === 'review' ? state : null;
  useEffect(() => {
    if (!review) return;
    let cancelled = false;
    (async () => {
      for (let k = 0; k < BATTLES; k++) {
        if (stillBlobs.current[k]) continue;
        try {
          const b = await renderBlottStill(review.battles[k]);
          if (cancelled) return;
          stillBlobs.current[k] = b;
          attachStill(k, b);
          void saveStill({ pool: poolAddress, battle: k + 1, png: b });
        } catch {
          /* best-effort; the tile shows its numbers without a still */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per review entry
  }, [review !== null]);

  /* The crescendo fires once, on entering Seven made. */
  useEffect(() => {
    if (!review || celebrated) return;
    const raf = requestAnimationFrame(() => setCelebrated(true));
    return () => cancelAnimationFrame(raf);
  }, [review, celebrated]);


  /* The rack: locked allocations from the machine's record — plus the Blot
   * dropping through the chute right now — zipped with their stills. */
  const lockedAllocs: readonly Allocation[] = battle
    ? locking
      ? [...battle.locked, battle.alloc]
      : battle.locked
    : review
      ? review.battles
      : state.phase === 'confirmed'
        ? state.battles
        : [];
  const tiles: TileEntry[] = lockedAllocs.map((a, k) => ({ allocation: a, stillUrl: stillUrls[k] ?? null }));

  /* ——— Approved (ready): YOU'RE IN, the rule, the untouched clock — the
   * machine stands lit with the even-split Blot in its window. */
  if (state.phase === 'ready') {
    return (
      <section className="animate-settle flex flex-col gap-5">
        <Cabinet
          status={COPY.battle.approvedTitle}
          stageHeight={240}
          corner={<Timer remainingMs={state.budgetMs} budgetMs={state.budgetMs} started={false} size={72} />}
          deck={
            <div className="flex flex-col gap-4">
              <h2 className="font-display text-[40px] leading-[42px] font-extrabold text-game-ink">
                {COPY.battle.approvedTitle}
              </h2>
              <p className="max-w-prose text-[15px] leading-6 text-game-ink-muted">{COPY.battle.ruleNinety}</p>
              {/* R9-b: the effect of the default, stated as performance (the
                  founder's addendum wording) — on the battle screen, not only
                  the rules page. */}
              <p className="max-w-prose text-[13px] leading-5 text-game-ink-muted">{COPY.battle.timerEffect}</p>
              <Button
                size="lg"
                onClick={() => {
                  dispatch({ type: 'begin' });
                  // The page now owns a run: nothing may unmount this.
                  onRunStarted?.();
                }}
              >
                {COPY.battle.begin}
              </Button>
            </div>
          }
        >
          <BlottRaster allocation={EVEN_SPLIT} size={200} mood="idle" />
        </Cabinet>
        <SevenTiles locked={tiles} />
      </section>
    );
  }

  /* ——— Battle N of 7: the Blot in the window, the dials on the deck, the
   * rack of tiles below. */
  if (battle) {
    const motionClass = locking ? 'blot-drop' : battle.screen > 0 ? 'blot-rise' : '';
    return (
      <section className="flex flex-col gap-4">
        <Cabinet
          status={COPY.battle.screenOf(battle.screen + 1)}
          stageHeight={300}
          corner={
            <Timer
              remainingMs={battle.remainingMs}
              budgetMs={battle.budgetMs}
              started={battle.clockStarted}
              size={72}
            />
          }
          deck={
            <div className="flex flex-col gap-4">
              <header className="flex items-center justify-between">
                <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-game-ink-muted">
                  {COPY.battle.screenOf(battle.screen + 1)}
                </span>
                <div className="flex gap-1.5" aria-hidden>
                  {Array.from({ length: BATTLES }, (_, i) => (
                    <span
                      key={i}
                      className={
                        'h-1.5 w-1.5 rounded-full ' +
                        (i < battle.screen ? 'bg-brand-pink' : i === battle.screen ? 'bg-brand-cream' : 'bg-game-raised')
                      }
                    />
                  ))}
                </div>
              </header>
              <StatDials
                target={battle.alloc}
                display={display}
                dragStat={dragStat}
                onDrag={(k, t) => dispatch({ type: 'dial', stat: k, target: t })}
                onDragStart={setDragStat}
                onDragEnd={() => setDragStat(null)}
                onEvenSplit={() => dispatch({ type: 'even_split' })}
                locks={battle.locks}
                onToggleLock={(k) => dispatch({ type: 'toggle_lock', stat: k })}
                disabled={locking}
              />
              <p className="text-[12px] leading-5 text-game-ink-muted">{COPY.battle.ruleNinety}</p>
              <Button size="lg" disabled={locking} onClick={lockIn}>
                {COPY.battle.lockBattle(battle.screen + 1)}
              </Button>
            </div>
          }
        >
          {/* Keyed by screen so the next Blot mounts fresh and rises. */}
          <div key={battle.screen} className={motionClass}>
            <BlottRaster
              allocation={battle.alloc}
              display={display}
              velocity={velocity}
              dragStat={dragStat}
              mood={locking ? 'locked' : 'focused'}
              size={230}
            />
          </div>
        </Cabinet>
        <SevenTiles locked={tiles} />

        <Sheet open={leaveSheet} onClose={() => setLeaveSheet(false)} title={COPY.battle.backStay}>
          <p className="max-w-prose text-[15px] leading-6 text-ink-muted">
            {COPY.battle.backSheetLine}
          </p>
          <div className="mt-4 flex gap-3">
            <Button
              onClick={() => {
                setLeaveSheet(false);
                history.pushState({ blottoRun: true }, '');
              }}
            >
              {COPY.battle.backStay}
            </Button>
            <Button intent="quiet" onClick={() => router.push('/')}>
              {COPY.battle.backLeave}
            </Button>
          </div>
        </Sheet>
      </section>
    );
  }

  /* ——— Seven made: the crescendo, the rack, montage, share, and the
   * untouched two-step seal. */
  if (review) {
    return (
      <section className="flex flex-col gap-5">
        {celebrated && <ConfettiBurst pieces={52} durationMs={1800} />}
        <div className="animate-settle flex flex-col gap-1">
          <h2 className="font-display text-[40px] leading-[42px] font-extrabold text-ink">
            {COPY.battle.crescendo}
          </h2>
          <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{COPY.battle.crescendoLine}</p>
        </div>
        {review.expired && (
          <p className="text-[14px] leading-5 text-ink-muted">{COPY.battle.expiredNote}</p>
        )}
        <SevenTiles locked={tiles} crescendo={celebrated} />
        {/* Founder 2026-09-09: once the seven are made they get to play —
            the rendered Blotts running, bouncing and napping under the
            rack. Seeded by each battle's first stat so no two runs match;
            reads the allocation for nothing else. */}
        <Playground count={BATTLES} seeds={review.battles.map((b) => b[0])} size={64} />
        {/* 2026-09-13: the share that stood here is gone, deliberately. It
            offered a picture of the seven Blotts before anything was sealed —
            and a Blott's silhouette is its allocation (components/blott/warp.ts),
            so the image was the sealed line-up, published while the pool was
            open. The share now lives on the character pass, after the network
            has confirmed the entry. What stands here is the seal, explained. */}
        <Card className="flex items-center gap-4 p-4">
          <SealLock />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[14px] leading-5 text-ink">{COPY.battle.sealWhat}</p>
            <p className="text-[13px] leading-5 text-ink-muted">{COPY.battle.sealAfter}</p>
          </div>
        </Card>
        {sealArmed ? (
          <div className="flex flex-col gap-3">
            {/* PID §8.6 — above the confirm, always. Do not move it below. */}
            <p className="text-[15px] font-semibold leading-6 text-ink">{COPY.pool.decisionsFinal}</p>
            <Button size="lg" onClick={() => dispatch({ type: 'confirm' })}>
              {COPY.battle.sealConfirm}
            </Button>
            <Button intent="quiet" onClick={() => setSealArmed(false)}>
              {COPY.battle.sealCancel}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* PID §8.6 — above the seal control on step one as well. */}
            <p className="text-[13px] leading-5 text-ink-muted">{COPY.pool.decisionsFinal}</p>
            <Button size="lg" onClick={() => setSealArmed(true)}>
              {COPY.battle.seal}
            </Button>
          </div>
        )}
      </section>
    );
  }

  /* ——— Confirmed: the parent owns the seal; this holds the screen. */
  return (
    <section aria-live="polite" className="flex flex-col items-center gap-6 py-14">
      <div className="animate-pulse-once relative h-16 w-16" aria-hidden>
        <div className="absolute inset-0 rounded-2xl border-2 border-brand" />
        <div className="absolute inset-0 rounded-2xl" style={{ boxShadow: 'var(--glow-action)' }} />
        <svg viewBox="0 0 24 24" className="absolute inset-0 m-auto h-8 w-8 text-brand">
          <path
            d="M7 10V8a5 5 0 0 1 10 0v2m-9 0h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <p className="animate-rise text-[15px] text-ink-muted">{COPY.battle.sealing}</p>
    </section>
  );
}

/** The seal's object (2026-09-13): a candy padlock, rendered once by the
 * founder's image pipeline (public/candy/lock.webp). Decorative. */
function SealLock() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a static asset at a fixed size
    <img
      src="/candy/lock.webp"
      alt=""
      aria-hidden
      width={96}
      height={96}
      draggable={false}
      className="h-24 w-24 shrink-0 select-none"
    />
  );
}

export { EVEN_SPLIT };
