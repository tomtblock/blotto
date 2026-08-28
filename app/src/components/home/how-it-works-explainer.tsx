'use client';

/*
 * The hero explainer (UI constitution PART 6.1 Act I): one self-running
 * animated scene that teaches the whole game in ~12 seconds — the landing
 * page's single hero animation.
 *
 *   Beat 1 "Take a seat"       — 64 seat markers assemble into a circle; a
 *                                few fill with a soft rising fade (WARMTH);
 *                                one seat highlights: you.
 *   Beat 2 "Set seven battles" — the circle collapses into a pentagon at
 *                                even split; a vertex drags out and the five
 *                                integers re-flow, always summing to 100;
 *                                the shape stamps (WEIGHT) and frosts
 *                                (FROST) as the battle tick advances. Two
 *                                morphs are shown, each deliberately
 *                                unremarkable and varied — the explainer
 *                                must never demonstrate a shape worth
 *                                copying (hard constraint 4).
 *   Beat 3 "Everyone fights…"  — seven frosted shapes TRAVEL to the pool,
 *                                the 64-seat ring completes, every shape
 *                                de-frosts at the same instant (LIGHT —
 *                                simultaneity is the fairness made visible)
 *                                and a rankings column settles, the paid
 *                                rows gaining a subtle warmth.
 *
 * Drive: scroll-scrubbed inside a tall section on fine-pointer viewports;
 * gentle 12s autoplay loop elsewhere. Captions come from COPY.howItWorks —
 * never rewritten here. Reduced motion: a static three-panel fallback
 * rendered from the same scene function at three fixed times.
 *
 * Everything is derived from one progress value t ∈ [0,1) by pure
 * functions — no timers own state, no randomness at render (the seat
 * scatter is a fixed table), and interrupting the scroll simply moves t.
 */

import { useEffect, useRef, useState } from 'react';
import { COPY } from '@/copy';
import type { Allocation } from '@/battle/allocation';
import { axisUnit, pointFor, polygonPoints } from '@/battle/geometry';
import { usePrefersReducedMotion } from '@/reveal/stages/use-reduced-motion';

/* --- timeline ----------------------------------------------------------- */

const LOOP_MS = 12_500;
/** Beat windows in t. Holds are built in so captions can be read. */
const BEAT_A = [0.0, 0.3] as const; // take a seat
const BEAT_B = [0.3, 0.66] as const; // set seven battles; 0.66..1 = beat C

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/* --- fixed geometry ------------------------------------------------------ */

const W = 360;
const H = 290;
const CX = 180;
const CY = 126;
const RING_R = 92;
const PENT_R = 96;

/** Deterministic scatter for beat 1 (a fixed LCG — no randomness at render). */
const SCATTER: ReadonlyArray<readonly [number, number]> = (() => {
  let s = 40_487;
  const next = () => {
    s = (s * 48_271) % 2_147_483_647;
    return s / 2_147_483_647;
  };
  return Array.from({ length: 64 }, () => [40 + next() * (W - 80), 26 + next() * 200] as const);
})();

const SEAT_ANGLE = (i: number) => ((i / 64) * 360 - 90) * (Math.PI / 180);
const RING_POS = Array.from(
  { length: 64 },
  (_, i) => [CX + RING_R * Math.cos(SEAT_ANGLE(i)), CY + RING_R * Math.sin(SEAT_ANGLE(i))] as const
);
/** Seats that fill early in beat 1 (illustrative, an abstract demo). */
const EARLY_FILLED = new Set([2, 9, 17, 26, 38, 47, 55]);
const YOU_SEAT = 5;

/** The two demonstrated morphs — unremarkable and varied by design. */
const EVEN: Allocation = [20, 20, 20, 20, 20];
const MORPH_1: Allocation = [34, 14, 22, 12, 18];
const MORPH_2: Allocation = [12, 26, 18, 30, 14];

/** Largest-remainder rounding so displayed integers always sum to 100. */
function roundedTo100(values: readonly number[]): number[] {
  const floors = values.map(Math.floor);
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

const mix = (a: Allocation, b: Allocation, t: number): number[] =>
  a.map((v, i) => lerp(v, b[i], t));

/* Rankings column (beat 3): abstract score bars, longest first. Paid rows
 * (the top quarter) gain warmth. Purely illustrative shape — no numbers. */
const RANK_BARS = [0.95, 0.88, 0.83, 0.79, 0.74, 0.7, 0.66, 0.61];

/* --- the scene, as a pure function of t --------------------------------- */

interface Scene {
  beat: 0 | 1 | 2;
  seats: Array<{ x: number; y: number; filled: boolean; you: boolean; r: number; opacity: number }>;
  pentagon: {
    opacity: number;
    values: number[];
    display: number[];
    scale: number;
    frost: number; // veil opacity 0..1
    tick: string; // "1/7" style
  } | null;
  travelers: Array<{ x: number; y: number; scale: number; frost: number; opacity: number }>;
  ranks: Array<{ width: number; warm: boolean; opacity: number }>;
  caption: 0 | 1 | 2;
}

function scene(t: number): Scene {
  const beat: Scene['beat'] = t < BEAT_A[1] ? 0 : t < BEAT_B[1] ? 1 : 2;

  /* Beat 1: scatter → ring. Seats persist through beat 3 as the pool ring. */
  const assemble = easeOut(seg(t, 0.02, 0.16));
  const earlyFill = seg(t, 0.14, 0.26);
  /* Beat 2 collapses the ring into the pentagon: seats fade. */
  const collapse = easeInOut(seg(t, BEAT_B[0], BEAT_B[0] + 0.06));
  /* Beat 3 re-completes the ring as the pool fills. */
  const refill = seg(t, 0.7, 0.82);

  const seats = RING_POS.map(([rx, ry], i) => {
    const [sx, sy] = SCATTER[i];
    const x = lerp(sx, rx, assemble);
    const y = lerp(sy, ry, assemble);
    const early = EARLY_FILLED.has(i);
    const filledNow =
      (early && earlyFill > (i % 7) / 7) || (t >= 0.7 && refill >= i / 64) || t >= 0.86;
    const you = i === YOU_SEAT;
    /* During beat 2 the ring recedes; it returns for beat 3. */
    const recede = beat === 1 ? 1 - collapse * 0.85 : 1;
    const opacity = (t < BEAT_B[0] ? 1 : beat === 1 ? 0.15 : 1) * recede;
    return {
      x,
      y,
      filled: filledNow,
      you,
      r: you ? 4.4 : 3.1,
      opacity,
    };
  });

  /* Beat 2: pentagon lifecycle. Two morphs, each ending in stamp + frost. */
  let pentagon: Scene['pentagon'] = null;
  let caption: Scene['caption'] = beat;
  if (t >= BEAT_B[0] - 0.02 && t < 0.75) {
    const appear = seg(t, BEAT_B[0], BEAT_B[0] + 0.05);
    /* Sub-timeline inside beat B: morph → stamp → frost, twice. */
    const m1 = easeInOut(seg(t, 0.36, 0.44)); // even → morph 1
    const stamp1 = seg(t, 0.445, 0.465);
    const frost1 = seg(t, 0.465, 0.5);
    const swapOut = seg(t, 0.5, 0.525); // frosted shape 1 fades…
    const inSecond = t >= 0.525;
    const appear2 = seg(t, 0.525, 0.55); // …and a fresh even split fades in
    const m2 = easeInOut(seg(t, 0.555, 0.615)); // even → morph 2
    const stamp2 = seg(t, 0.62, 0.64);
    const frost2 = seg(t, 0.64, 0.665);
    const fadeToTravel = seg(t, 0.68, 0.74);

    const values = inSecond ? mix(EVEN, MORPH_2, m2) : mix(EVEN, MORPH_1, m1);
    const stamp = inSecond ? stamp2 : stamp1;
    /* WEIGHT: 1 → 0.96 → 1, a low landing, never a bounce. */
    const stampScale =
      stamp <= 0 || stamp >= 1
        ? 1
        : stamp < 0.5
          ? lerp(1, 0.96, stamp * 2)
          : lerp(0.96, 1, (stamp - 0.5) * 2);
    pentagon = {
      opacity: appear * (1 - fadeToTravel) * (inSecond ? appear2 : 1 - swapOut),
      values,
      display: roundedTo100(values),
      scale: stampScale,
      frost: inSecond ? frost2 : frost1,
      tick: inSecond ? (frost2 >= 1 ? '3/7' : '2/7') : frost1 >= 1 ? '2/7' : '1/7',
    };
  }

  /* Beat 3: seven frosted minis TRAVEL to the pool center, then de-frost
   * SIMULTANEOUSLY and the rankings settle. */
  const travelIn = easeInOut(seg(t, 0.68, 0.78));
  const defrost = seg(t, 0.84, 0.875); // all at once — one shared value
  const spread = easeOut(seg(t, 0.86, 0.92));
  const travelers =
    t >= 0.66
      ? Array.from({ length: 7 }, (_, k) => {
          /* From a row above the scene toward the ring's center, then
           * spreading into a small arc once revealed. */
          const fromX = 52 + k * 43;
          const fromY = -18;
          const midX = CX;
          const midY = CY;
          const outX = CX - 96 + k * 32;
          const outY = CY + (k % 2 === 0 ? -10 : 10);
          const x = spread > 0 ? lerp(midX, outX, spread) : lerp(fromX, midX, travelIn);
          const y = spread > 0 ? lerp(midY, outY, spread) : lerp(fromY, midY, travelIn);
          return {
            x,
            y,
            scale: lerp(0.5, 0.62, travelIn),
            frost: 1 - defrost,
            opacity: seg(t, 0.66, 0.7),
          };
        })
      : [];

  const ranksIn = seg(t, 0.88, 0.985);
  const ranks = RANK_BARS.map((w, i) => {
    /* 30ms-equivalent stagger in t-space. */
    const local = easeOut(seg(ranksIn, i * 0.055, i * 0.055 + 0.5));
    return { width: w * local, warm: i < 2, opacity: local };
  });

  if (t >= 0.75) caption = 2;
  return { beat, seats, pentagon, travelers, ranks, caption };
}

/* --- rendering ----------------------------------------------------------- */

function MiniPentagon({
  x,
  y,
  scale,
  frost,
  opacity,
  values,
}: {
  x: number;
  y: number;
  scale: number;
  frost: number;
  opacity: number;
  values: readonly number[];
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
      <polygon
        points={polygonPoints(values, 30, 0, 0)}
        fill="color-mix(in srgb, var(--color-brand) 22%, transparent)"
        stroke="var(--color-brand)"
        strokeWidth={2}
        strokeLinejoin="round"
        opacity={1 - frost * 0.75}
      />
      {/* The frost veil: present but unreadable. */}
      <polygon
        points={polygonPoints([70, 70, 70, 70, 70], 30, 0, 0)}
        fill="color-mix(in srgb, var(--color-ink) 14%, transparent)"
        stroke="color-mix(in srgb, var(--color-ink) 34%, transparent)"
        strokeWidth={1.4}
        strokeLinejoin="round"
        opacity={frost}
      />
    </g>
  );
}

function ExplainerScene({ t, statNames }: { t: number; statNames: readonly string[] }) {
  const s = scene(t);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
      {/* Seats / the pool ring. */}
      {s.seats.map((seat, i) => (
        <circle
          key={i}
          cx={seat.x}
          cy={seat.y}
          r={seat.r}
          opacity={seat.opacity}
          fill={
            seat.you
              ? 'var(--color-brand-hot)'
              : seat.filled
                ? 'var(--color-brand)'
                : 'var(--color-overlay)'
          }
          stroke={seat.you ? 'var(--color-brand)' : 'none'}
          strokeWidth={seat.you ? 3 : 0}
          strokeOpacity={0.35}
        />
      ))}

      {/* The allocation pentagon (beat 2). */}
      {s.pentagon && s.pentagon.opacity > 0.01 ? (
        <g
          transform={`translate(${CX} ${CY - 4}) scale(${s.pentagon.scale})`}
          opacity={s.pentagon.opacity}
        >
          {[0.5, 1].map((f) => (
            <polygon
              key={f}
              points={polygonPoints([100 * f, 100 * f, 100 * f, 100 * f, 100 * f], PENT_R, 0, 0)}
              fill="none"
              stroke="var(--color-line)"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: 5 }, (_, i) => {
            const u = axisUnit(i);
            return (
              <line
                key={i}
                x1={0}
                y1={0}
                x2={u.x * PENT_R}
                y2={u.y * PENT_R}
                stroke="var(--color-line)"
                strokeWidth={1}
              />
            );
          })}
          <polygon
            points={polygonPoints(s.pentagon.values, PENT_R, 0, 0)}
            fill="color-mix(in srgb, var(--color-brand) 22%, transparent)"
            stroke="var(--color-brand)"
            strokeWidth={2}
            strokeLinejoin="round"
            opacity={1 - s.pentagon.frost * 0.7}
          />
          {s.pentagon.values.map((v, i) => {
            const p = pointFor(v, i, PENT_R);
            return (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={3.4}
                fill="var(--color-brand)"
                opacity={1 - s.pentagon!.frost * 0.7}
              />
            );
          })}
          {/* FROST veil over the locked shape. */}
          <polygon
            points={polygonPoints([88, 88, 88, 88, 88], PENT_R, 0, 0)}
            fill="color-mix(in srgb, var(--color-ink) 12%, transparent)"
            stroke="color-mix(in srgb, var(--color-ink) 30%, transparent)"
            strokeWidth={1.6}
            strokeLinejoin="round"
            opacity={s.pentagon.frost}
          />
        </g>
      ) : null}

      {/* The re-flowing integers + battle tick (beat 2). */}
      {s.pentagon && s.pentagon.opacity > 0.01 ? (
        <g opacity={s.pentagon.opacity}>
          {s.pentagon.display.map((v, i) => (
            <text
              key={i}
              x={36 + i * 72}
              y={H - 26}
              textAnchor="middle"
              fontSize={17}
              fontWeight={700}
              className="fill-(--color-ink) tnum"
            >
              {v}
              <tspan
                x={36 + i * 72}
                dy={13}
                fontSize={7.5}
                fontWeight={500}
                className="fill-(--color-ink-muted)"
                style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}
              >
                {statNames[i]}
              </tspan>
            </text>
          ))}
          <text
            x={W - 18}
            y={22}
            textAnchor="end"
            fontSize={12}
            fontWeight={600}
            className="fill-(--color-ink-muted) tnum"
          >
            {s.pentagon.tick}
          </text>
        </g>
      ) : null}

      {/* Seven sealed battles traveling to the pool (beat 3). */}
      {s.travelers.map((tr, k) => (
        <MiniPentagon key={k} {...tr} values={k % 2 === 0 ? MORPH_1 : MORPH_2} />
      ))}

      {/* The rankings column settling (beat 3). */}
      {s.ranks.some((r) => r.opacity > 0) ? (
        <g transform={`translate(${CX - 70} ${H - 66})`}>
          {s.ranks.map((r, i) => (
            <rect
              key={i}
              x={0}
              y={i * 8}
              width={140 * r.width}
              height={5}
              rx={2.5}
              opacity={r.opacity}
              fill={
                r.warm
                  ? 'color-mix(in srgb, var(--color-prize) 65%, transparent)'
                  : 'color-mix(in srgb, var(--color-ink-muted) 45%, transparent)'
              }
            />
          ))}
        </g>
      ) : null}
    </svg>
  );
}

/* --- drivers ------------------------------------------------------------- */

function useExplainerProgress(hostRef: React.RefObject<HTMLElement | null>, scrub: boolean) {
  const [t, setT] = useState(0.001);

  useEffect(() => {
    let raf = 0;
    if (scrub) {
      const update = () => {
        const el = hostRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          const total = rect.height - window.innerHeight;
          const progress = total > 0 ? clamp01(-rect.top / total) : 0;
          setT(Math.max(0.001, Math.min(0.999, progress)));
        }
        raf = 0;
      };
      const onScroll = () => {
        if (!raf) raf = requestAnimationFrame(update);
      };
      update();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      return () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        if (raf) cancelAnimationFrame(raf);
      };
    }
    /* Gentle autoplay loop. */
    const start = performance.now();
    const stepFrame = (now: number) => {
      setT(((now - start) % LOOP_MS) / LOOP_MS);
      raf = requestAnimationFrame(stepFrame);
    };
    raf = requestAnimationFrame(stepFrame);
    return () => cancelAnimationFrame(raf);
  }, [scrub, hostRef]);

  return t;
}

/* --- component ----------------------------------------------------------- */

export function HowItWorksExplainer() {
  const reduced = usePrefersReducedMotion();
  const [scrub, setScrub] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 768px)');
    const apply = () => setScrub(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  if (reduced) return <StaticExplainer />;
  return scrub ? <ScrubExplainer hostRef={hostRef} /> : <AutoplayExplainer hostRef={hostRef} />;
}

const CAPTION_STEPS = [0, 1, 2] as const;

function Captions({ active }: { active: 0 | 1 | 2 }) {
  return (
    <div className="relative min-h-[76px]">
      {CAPTION_STEPS.map((i) => {
        const step = COPY.howItWorks.steps[i];
        return (
          <div
            key={step.title}
            className="absolute inset-0 flex flex-col gap-1 text-center"
            style={{
              opacity: active === i ? 1 : 0,
              transition: `opacity var(--duration-base) var(--ease-out)`,
            }}
            aria-hidden={active !== i}
          >
            <h3 className="text-[16px] font-semibold text-ink">{step.title}</h3>
            <p className="mx-auto max-w-[52ch] text-[13px] leading-5 text-ink-muted">{step.body}</p>
          </div>
        );
      })}
    </div>
  );
}

function ScrubExplainer({ hostRef }: { hostRef: React.RefObject<HTMLDivElement | null> }) {
  const t = useExplainerProgress(hostRef, true);
  const s = scene(t);
  return (
    <div ref={hostRef} className="relative h-[260vh]">
      <div className="sticky top-14 flex flex-col gap-2 pb-6">
        <ExplainerScene t={t} statNames={COPY.battle.statNames} />
        <Captions active={s.caption} />
      </div>
    </div>
  );
}

function AutoplayExplainer({ hostRef }: { hostRef: React.RefObject<HTMLDivElement | null> }) {
  const t = useExplainerProgress(hostRef, false);
  const s = scene(t);
  return (
    <div ref={hostRef} className="flex flex-col gap-2">
      <ExplainerScene t={t} statNames={COPY.battle.statNames} />
      <Captions active={s.caption} />
    </div>
  );
}

/** Reduced motion: the same scene function at three fixed times — a calm,
 * fully readable three-panel strip. */
const STATIC_PANELS: ReadonlyArray<{ t: number; step: 0 | 1 | 2 }> = [
  { t: 0.28, step: 0 },
  { t: 0.43, step: 1 },
  { t: 0.99, step: 2 },
];

function StaticExplainer() {
  return (
    <div className="grid gap-6 sm:grid-cols-3">
      {STATIC_PANELS.map(({ t, step }) => {
        const s = COPY.howItWorks.steps[step];
        return (
          <figure key={s.title} className="flex flex-col gap-2">
            <ExplainerScene t={t} statNames={COPY.battle.statNames} />
            <figcaption className="flex flex-col gap-1 text-center">
              <span className="text-[15px] font-semibold text-ink">{s.title}</span>
              <span className="text-[12px] leading-4 text-ink-muted">{s.body}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
