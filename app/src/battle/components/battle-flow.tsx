'use client';

/*
 * The seven-battle RUN (v4, founder brief 2026-09-06): Approved → seven
 * battle screens around the live Blot → Seven made (montage + share) →
 * the two-step seal. The machine (src/battle/machine.ts) owns every rule;
 * this component feeds ticks and renders state — it never sees a wallet,
 * and sealing still happens outside via `onConfirm`, unchanged.
 *
 * Layout is the two-layer rule made literal: the Blot morphs on the PINK
 * stage; every number, dial and control sits on the PLUM card below. The
 * run clock is the calm slate ring — never red, never pulsing — and
 * starts on the first dial touch (a slow wallet eats nothing).
 *
 * Lock-in captures a 1024×1024 still (shapes only, no numbers) into
 * IndexedDB for the montage and My Blots; capture is best-effort and can
 * never block or delay the seal. Sharing the montage never blocks
 * sealing either — two independent controls on Seven-made.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { BlotMorph } from '@/components/blot/BlotMorph';
import { StatDials } from '@/components/blot/StatDials';
import { Timer } from '@/components/blot/Timer';
import { useBlotSprings, usePrefersReducedMotion } from '@/components/blot/springs';
import { renderBlotStill } from '@/components/blot/render-still';
import { EVEN_SPLIT, type Allocation } from '../allocation';
import { BATTLES, initialState, reduce } from '../machine';
import { composeMontage } from '../montage';
import { saveStill } from '../stills';

const TICK_MS = 100;
/** Set the first time this wallet seals — flips the share line to "seven". */
const SEALED_ONCE_KEY = 'blotto.sealed.once';

export interface BattleFlowProps {
  /** Pool address — keys the lock-in stills in IndexedDB. */
  poolAddress: string;
  onConfirm: (battles: readonly Allocation[], timingsMs: readonly number[]) => void;
}

export function BattleFlow({ poolAddress, onConfirm }: BattleFlowProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState());
  const confirmed = useRef(false);
  const [sealArmed, setSealArmed] = useState(false);
  // The 800 ms locked beat: heart pulse + visor blink before the advance.
  const [locking, setLocking] = useState(false);
  const [leaveSheet, setLeaveSheet] = useState(false);
  const stillBlobs = useRef<(Blob | null)[]>(Array.from({ length: BATTLES }, () => null));
  const [montage, setMontage] = useState<{ url: string; blob: Blob } | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const reduced = usePrefersReducedMotion();

  const battle = state.phase === 'battle' ? state : null;
  const allocation: Allocation = battle ? battle.alloc : EVEN_SPLIT;
  const { display, velocity } = useBlotSprings(allocation, reduced);
  const [dragStat, setDragStat] = useState<number | null>(null);

  /* The wall clock: fixed-interval ticks while a battle screen is live. */
  const liveScreen = battle && !locking ? battle.screen : -1;
  useEffect(() => {
    if (liveScreen < 0 && !locking) return;
    const id = setInterval(() => dispatch({ type: 'tick', ms: TICK_MS }), TICK_MS);
    return () => clearInterval(id);
  }, [liveScreen, locking]);

  useEffect(() => {
    if (state.phase === 'confirmed' && !confirmed.current) {
      confirmed.current = true;
      try {
        localStorage.setItem(SEALED_ONCE_KEY, '1');
      } catch {
        /* the share line heuristic degrades to "first" — harmless */
      }
      onConfirm(state.battles, state.timingsMs);
    }
  }, [state, onConfirm]);

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

  const lockIn = useCallback(() => {
    if (!battle || locking) return;
    const alloc = battle.alloc;
    const battleNo = battle.screen + 1;
    // Best-effort still — never blocks the run, never blocks the seal.
    renderBlotStill(alloc)
      .then((png) => {
        stillBlobs.current[battleNo - 1] = png;
        return saveStill({ pool: poolAddress, battle: battleNo, allocation: alloc, png });
      })
      .catch(() => {});
    setLocking(true);
    setTimeout(
      () => {
        setLocking(false);
        dispatch({ type: 'lock_in' });
      },
      reduced ? 0 : 800
    );
  }, [battle, locking, poolAddress, reduced]);

  /* Seven made: make sure all seven stills exist (expiry can skip some),
   * then compose the montage once. */
  const review = state.phase === 'review' ? state : null;
  useEffect(() => {
    if (!review || montage) return;
    let cancelled = false;
    (async () => {
      const blobs: Blob[] = [];
      for (let k = 0; k < BATTLES; k++) {
        let b = stillBlobs.current[k];
        if (!b) {
          try {
            b = await renderBlotStill(review.battles[k]);
            stillBlobs.current[k] = b;
            void saveStill({ pool: poolAddress, battle: k + 1, allocation: review.battles[k], png: b });
          } catch {
            b = null;
          }
        }
        if (b) blobs.push(b);
      }
      if (cancelled || blobs.length < BATTLES) return;
      const first = !hasSealedBefore();
      try {
        const blob = await composeMontage(
          blobs,
          first ? COPY.battle.montageHeadlineFirst : COPY.battle.montageHeadlineSeven
        );
        if (!cancelled) setMontage({ url: URL.createObjectURL(blob), blob });
      } catch {
        /* montage is a bonus; the seal path below never depends on it */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per review entry
  }, [review !== null]);

  const share = useCallback(async () => {
    if (!montage) return;
    const first = !hasSealedBefore();
    const text = first ? COPY.battle.shareTextFirst : COPY.battle.shareTextSeven;
    const file = new File([montage.blob], 'blotto-seven.png', { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        return;
      }
    } catch {
      /* fall through to the download path (user cancel included) */
    }
    const a = document.createElement('a');
    a.href = montage.url;
    a.download = 'blotto-seven.png';
    a.click();
    try {
      await navigator.clipboard.writeText(text);
      setShareNote(COPY.battle.shareFallbackCopied);
    } catch {
      setShareNote(null);
    }
  }, [montage]);

  /* ——— Approved (ready): YOU'RE IN, the rule, the untouched clock. */
  if (state.phase === 'ready') {
    return (
      <section className="animate-settle flex flex-col gap-5">
        <div className="flex items-center justify-center rounded-3xl bg-brand-pink py-6">
          <BlotMorph allocation={EVEN_SPLIT} size={200} mood="idle" />
        </div>
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 className="font-display text-[40px] leading-[42px] font-extrabold text-ink">
              {COPY.battle.approvedTitle}
            </h2>
            <Timer remainingMs={state.budgetMs} budgetMs={state.budgetMs} started={false} size={84} />
          </div>
          <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{COPY.battle.ruleNinety}</p>
          {/* R9-b: the effect of the default, stated as performance (the
              founder's addendum wording) — on the battle screen, not only
              the rules page. */}
          <p className="max-w-prose text-[13px] leading-5 text-ink-muted">{COPY.battle.timerEffect}</p>
          <Button size="lg" onClick={() => dispatch({ type: 'begin' })}>
            {COPY.battle.begin}
          </Button>
        </Card>
      </section>
    );
  }

  /* ——— Battle N of 7: the Blot on pink, the dials on plum. */
  if (battle) {
    return (
      <section className="flex flex-col gap-4">
        <div className="relative flex items-center justify-center rounded-3xl bg-brand-pink py-4">
          <BlotMorph
            allocation={battle.alloc}
            display={display}
            velocity={velocity}
            dragStat={dragStat}
            mood={locking ? 'locked' : 'focused'}
            size={230}
          />
          <div className="absolute right-4 top-4">
            <Timer
              remainingMs={battle.remainingMs}
              budgetMs={battle.budgetMs}
              started={battle.clockStarted}
              size={72}
            />
          </div>
        </div>
        <Card className="flex flex-col gap-4 p-5">
          <header className="flex items-center justify-between">
            <span className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">
              {COPY.battle.screenOf(battle.screen + 1)}
            </span>
            <div className="flex gap-1.5" aria-hidden>
              {Array.from({ length: BATTLES }, (_, i) => (
                <span
                  key={i}
                  className={
                    'h-1.5 w-1.5 rounded-full ' +
                    (i < battle.screen ? 'bg-brand' : i === battle.screen ? 'bg-ink' : 'bg-overlay')
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
            disabled={locking}
          />
          <p className="text-[12px] leading-5 text-ink-muted">{COPY.battle.ruleNinety}</p>
          <Button size="lg" disabled={locking} onClick={lockIn}>
            {COPY.battle.lockBattle(battle.screen + 1)}
          </Button>
        </Card>

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

  /* ——— Seven made: montage, share, and the untouched two-step seal. */
  if (review) {
    return (
      <section className="flex flex-col gap-5">
        <h2 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">
          {COPY.battle.sevenTitle}
        </h2>
        {review.expired && (
          <p className="text-[14px] leading-5 text-ink-muted">{COPY.battle.expiredNote}</p>
        )}
        {montage ? (
          <div className="flex flex-col gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- object-URL preview of a canvas composition */}
            <img
              src={montage.url}
              alt="Your seven Blots, shapes only"
              className="w-full max-w-md self-center rounded-2xl"
            />
            <div className="flex flex-col items-center gap-1">
              <Button intent="prize" onClick={share}>
                {COPY.battle.share}
              </Button>
              {shareNote && <p className="text-[12px] text-ink-muted">{shareNote}</p>}
            </div>
          </div>
        ) : (
          <Card className="p-1">
            <ol className="flex flex-col">
              {review.battles.map((b, k) => (
                <li
                  key={k}
                  className={'flex items-center gap-4 px-4 py-2.5 ' + (k > 0 ? 'border-t border-line' : '')}
                >
                  <span className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">
                    {COPY.battle.screenOf(k + 1)}
                  </span>
                  <span className="tnum ml-auto font-display text-[18px] font-bold text-ink">
                    {b.join(' · ')}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        )}
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

function hasSealedBefore(): boolean {
  try {
    return localStorage.getItem(SEALED_ONCE_KEY) === '1';
  } catch {
    return false;
  }
}

export { EVEN_SPLIT };
