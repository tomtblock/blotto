"use client";

import { useEffect, useRef, useState } from "react";
import { LazyMotion, MotionConfig, domAnimation, m, useAnimate } from "motion/react";
import { PassBody, PassShellDefs, PassSpeckle } from "@/reveal/components/pass-shell";
import {
  BECKON_PERIOD_MS,
  BECKON_SCALE_MAX,
  REVEAL_DRAW_DURATION_MS,
  EASE_JUICE,
  EASE_SNAP,
  ENTRY_EGG_SCALE_FROM,
  ENTRY_EGG_SETTLE_MS,
  ENTRY_STAGE_FADE_MS,
  EXTENDED_TELL_MIN_CLASS,
  FAIL_SEAL_DURATION_MS,
  UNSEAL_FLASH_DURATION_MS,
  UNSEAL_FLASH_PEAK_OPACITY,
  UNSEAL_FLASH_PEAK_TIME,
  UNSEAL_FLASH_REDUCED_OPACITY,
  UNSEAL_FRAGMENT_FLIGHT_MS,
  UNSEAL_FRAGMENT_SCALE_DECAY,
  UNSEAL_SHELL_VANISH_MS,
  JOLT_DURATION_MS,
  JOLT_REBOUND_ROTATE_RATIO,
  JOLT_REBOUND_X_RATIO,
  LEAK_FADE_DURATION_MS,
  LEAK_REST_OPACITY,
  STRAIN_LIGHT_MAX_OPACITY,
  STRAIN_LIGHT_MIN_OPACITY,
  STRAIN_PULSE_PERIOD_MS,
  STRAIN_SHAKE_DEG,
  STRAIN_SHAKE_PX,
  TAP_COUNT,
  TELL_BLEED_DURATION_MS,
  TELL_BLOOM_MAX_OPACITY,
  TELL_BLOOM_SCALE_FROM,
  TELL_EXTENDED_BLEED_DURATION_MS,
  TELL_EXTENDED_DIM_OPACITY,
  TELL_EXTENDED_LIFT_PX,
  TELL_LEAK_OPACITY,
} from "@/reveal/constants";
import * as copy from "@/reveal/copy";
import { REVEAL_STEPS, revealStep } from "@/reveal/reveal-geometry";
import { SHELL_FRAGMENTS } from "@/reveal/fragment-geometry";
import type { RevealVisual } from "@/reveal/machine";
import { classColorToken } from "@/reveal/class-colour";
import { usePrefersReducedMotion } from "./use-reduced-motion";

/*
 * Beats 1–3 + 3f choreography (10.C Step 3), extended with beats 4–5 —
 * TELL and HATCH — in Step 4. Motion over the SHARED pass
 * (reveal/components/pass-shell.tsx: one pass implementation, never two; the
 * continuity is the motif), ONE pass instance across every beat it owns —
 * the tell must shift the light on the SAME reveals the taps drew, so the
 * coloured beats live here rather than in a second stage that would
 * remount the pass. Presentation ONLY: this component renders from
 * `RevealVisual` and dispatches taps; the machine is untouched.
 *
 * Discipline (all test-pinned):
 *  - Every magnitude is a named constant from lib/reveal/constants.ts —
 *    the numeric-literal scan allows only 0 and 1 in animation props.
 *  - Reveal geometry is FIXED per tap index (lib/reveal/reveal-geometry.ts;
 *    NG-007: identical pattern for everyone, no randomness) — and so is
 *    the burst (lib/reveal/fragment-geometry.ts, same rule).
 *  - Class-NEUTRAL before the tell: brand-family tokens only, and the class
 *    layers (bloom, class leaks, class reveals, flash) are NOT RENDERED at
 *    all pre-tell — they mount when `RevealVisual` first carries a classIndex,
 *    which the machine's projection makes impossible before confirmation.
 *  - Class colour enters ONLY via classColorToken (lib/reveal/class-colour):
 *    no class token literal exists in this source, so gold-before-class-5 is
 *    unwritable here (the mapping + the visual guard pin it).
 *  - The tell favours SATURATION over subtlety (spec: it must read on a
 *    compressed phone stream): the violet layers fade OUT while brighter
 *    class-coloured light fades IN over the same reveals, plus a bloom that
 *    washes the whole pass.
 *  - The unseal flash is BOUNDED (pass zone, never full-screen) and
 *    class-coloured, never white (spec §3 Beat 5).
 *  - The strain loop is seamless and CONSTANT — it never intensifies
 *    (intensification would imply progress that is not real).
 *  - Light leaks use wide low-opacity strokes, NO blur/drop-shadow filters
 *    (the spike flagged filter frame-cost on WebKit as a Step 3 item; this
 *    is the resolution — leaks read soft without per-frame filter work).
 *  - Reduced motion: zero transform animation — the tell is an opacity
 *    crossfade to class colour (no lift, no bloom scale), the unseal skips
 *    fragments entirely (pass crossfades out, the flash becomes a static
 *    class glow), and the Step 3 rules stand (no draw-on, no jolts/beckon/
 *    shake). Belt and braces: explicit `reduced` branches AND
 *    <MotionConfig reducedMotion="user">.
 */

/** Motion speaks seconds; constants are ms (repo convention). */
const sec = (ms: number) => ms / 1000;

const strainHalfPeriodS = sec(STRAIN_PULSE_PERIOD_MS) / 2;

/** The beats this stage owns. Beat 6 (card) is card-stage.tsx; beat 7
 * keeps its Step 2 placeholder until Step 5. */
export type RevealStageBeat =
  | "entry"
  | "revealing"
  | "strain"
  | "failed"
  | "tell"
  | "unseal";

export function RevealStage({
  visual,
  onTap,
}: {
  visual: RevealVisual & { beat: RevealStageBeat };
  onTap: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [joltScope, animateJolt] = useAnimate();

  // Reveal count the STAGE shows. `failed` keeps the last pre-failure count
  // so the seal animation has reveals to close — presentation memory only,
  // the machine deliberately doesn't carry it (its failed state needs no
  // rarity nor progress data). The coloured beats keep the FULL reveal —
  // the tell shifts the light on those reveals, it never redraws them.
  const revealsNow =
    visual.beat === "entry"
      ? 0
      : visual.beat === "revealing"
        ? visual.tapsSoFar
        : visual.beat === "failed"
          ? null
          : TAP_COUNT;
  const [reveals, setReveals] = useState(revealsNow ?? 0);
  if (revealsNow !== null && revealsNow !== reveals) setReveals(revealsNow);

  const sealed = visual.beat === "failed";
  const straining = visual.beat === "strain";
  const inviting = visual.beat === "entry" || visual.beat === "revealing";
  const telling = visual.beat === "tell";
  const unsealed = visual.beat === "unseal";
  const revealed = telling || unsealed;

  // Class colour exists ONLY on the coloured beats — `RevealVisual` carries
  // no class field before them, so this cannot be computed earlier.
  const classToken = revealed ? classColorToken(visual.class) : null;
  const extendedClass = revealed && visual.class >= EXTENDED_TELL_MIN_CLASS;
  const bleedMs = extendedClass
    ? TELL_EXTENDED_BLEED_DURATION_MS
    : TELL_BLEED_DURATION_MS;

  // Per-tap jolt impulse — fires on the rising edge of the reveal count,
  // geometry fixed by tap index (NG-007). Never under reduced motion.
  const lastJolted = useRef(revealsNow ?? 0);
  useEffect(() => {
    if (revealsNow === null) return;
    if (
      revealsNow > lastJolted.current &&
      visual.beat !== "tell" && // a held confirmation jumps revealing→tell;
      visual.beat !== "unseal" && // the climax beats never jolt
      !reduced &&
      joltScope.current
    ) {
      const { jolt } = revealStep(revealsNow - 1);
      void animateJolt(
        joltScope.current,
        {
          x: [0, jolt.x, -jolt.x * JOLT_REBOUND_X_RATIO, 0],
          rotate: [
            0,
            jolt.rotateDeg,
            -jolt.rotateDeg * JOLT_REBOUND_ROTATE_RATIO,
            0,
          ],
        },
        { duration: sec(JOLT_DURATION_MS), ease: EASE_SNAP },
      );
    }
    lastJolted.current = revealsNow;
  }, [revealsNow, visual.beat, reduced, animateJolt, joltScope]);

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        {/* Beat 1: the stage materialises — opacity fade (reduced-safe);
            the pass settles from ENTRY_EGG_SCALE_FROM unless reduced. */}
        <m.div
          data-testid="reveal-stage"
          data-beat={visual.beat}
          data-reveals={reveals}
          data-sealed={sealed ? "1" : "0"}
          data-reduced={reduced ? "1" : "0"}
          data-extended={telling && visual.extended ? "1" : "0"}
          className="flex flex-col items-center gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: sec(ENTRY_STAGE_FADE_MS), ease: EASE_SNAP }}
        >
          {/* EXTENDED tell only (spec §3 Beat 4): the backdrop dims further.
              Fixed, class-NEUTRAL (bg-base), released with the burst. The
              pass's button sits above it (relative + z). */}
          {extendedClass && (
            <m.div
              aria-hidden
              data-testid="reveal-dim"
              className="pointer-events-none fixed inset-0 bg-base"
              initial={{ opacity: 0 }}
              animate={{ opacity: telling ? TELL_EXTENDED_DIM_OPACITY : 0 }}
              transition={{
                duration: sec(telling ? bleedMs : UNSEAL_FLASH_DURATION_MS),
                ease: EASE_SNAP,
              }}
            />
          )}
          <button
            type="button"
            aria-label={copy.PASS_TAP_ARIA}
            onClick={onTap}
            data-testid="reveal-pass"
            className="relative z-10 flex justify-center outline-none"
          >
            {/* Engine-proof sizing (the 4d WebKit lesson, verbatim: callers
                MUST size with explicit width AND height — aspect-only
                wrappers mis-size in WebKit; this run's symptom was a
                left-shifted pass from a stretched shrink-to-fit button). 4:5
                ratio: h-56 = 14rem, w = 11.2rem. */}
            <m.span
              className="block h-56 w-[11.2rem]"
              data-testid="reveal-pass-box"
              initial={reduced ? false : { scale: ENTRY_EGG_SCALE_FROM }}
              animate={{
                scale: 1,
                // EXTENDED tell: the pass lifts (spec, tell beat). A
                // transform — skipped under reduced motion.
                y:
                  telling && extendedClass && !reduced
                    ? -TELL_EXTENDED_LIFT_PX
                    : 0,
              }}
              transition={{
                scale: { duration: sec(ENTRY_EGG_SETTLE_MS), ease: EASE_JUICE },
                y: { duration: sec(bleedMs), ease: EASE_JUICE },
              }}
            >
              <svg viewBox="0 0 200 250" className="h-full w-full" aria-hidden>
                <PassShellDefs
                  shellId="reveal-pass-shell"
                  sheenId="reveal-pass-sheen"
                />
                {/* Jolt layer (imperative impulses) wraps the loop layers so
                    transforms compose without fighting over properties. */}
                <m.g ref={joltScope} data-testid="reveal-jolt-layer">
                  {/* Strain shake — bounded, seamless (mirror loop), and
                      CONSTANT: same amplitude at second 1 and minute 10. */}
                  <m.g
                    data-testid="reveal-shake-layer"
                    animate={
                      straining && !reduced
                        ? {
                            x: [-STRAIN_SHAKE_PX, STRAIN_SHAKE_PX],
                            rotate: [-STRAIN_SHAKE_DEG, STRAIN_SHAKE_DEG],
                          }
                        : { x: 0, rotate: 0 }
                    }
                    transition={
                      straining && !reduced
                        ? {
                            duration: strainHalfPeriodS,
                            repeat: Infinity,
                            repeatType: "mirror",
                            ease: "easeInOut",
                          }
                        : { duration: 0 }
                    }
                  >
                    {/* Idle beckon — the tap invitation. Never in strain
                        (a beckon there would read as tap-for-progress —
                        NG-007), never when sealed, never reduced. */}
                    <m.g
                      data-testid="reveal-beckon-layer"
                      animate={
                        inviting && !reduced
                          ? { scale: [1, BECKON_SCALE_MAX, 1] }
                          : { scale: 1 }
                      }
                      transition={
                        inviting && !reduced
                          ? {
                              duration: sec(BECKON_PERIOD_MS),
                              repeat: Infinity,
                              ease: "easeInOut",
                            }
                          : { duration: 0 }
                      }
                      style={{ transformOrigin: "50% 55%" }}
                    >
                      {/* The SHELL — everything that IS the pass. One group
                          so the unseal bursts it as one object (Beat 5:
                          vanishes under the fragments; reduced motion:
                          this same opacity fade is the whole exit). */}
                      <m.g
                        data-testid="reveal-shell"
                        initial={false}
                        animate={{ opacity: unsealed ? 0 : 1 }}
                        transition={{
                          duration: sec(UNSEAL_SHELL_VANISH_MS),
                          ease: "easeOut",
                        }}
                      >
                        <PassBody
                          shellId="reveal-pass-shell"
                          sheenId="reveal-pass-sheen"
                          rimWidth={3}
                        />
                        <PassSpeckle />
                        {/* Violet light leaking from accumulated reveals —
                            wide soft stroke, no filters. Pulses ONLY in
                            strain; rests at LEAK_REST_OPACITY otherwise;
                            fades OUT under the tell's colour shift; gone
                            when sealed. */}
                        {REVEAL_STEPS.map((step, i) => (
                          <m.path
                            key={`leak-${i}`}
                            data-testid={`reveal-leak-${i}`}
                            d={step.path}
                            fill="none"
                            stroke="var(--color-brand)"
                            strokeWidth={7}
                            strokeLinecap="round"
                            initial={false}
                            animate={{
                              opacity:
                                sealed || revealed
                                  ? 0
                                  : i < reveals
                                    ? straining && !reduced
                                      ? [
                                          STRAIN_LIGHT_MIN_OPACITY,
                                          STRAIN_LIGHT_MAX_OPACITY,
                                        ]
                                      : LEAK_REST_OPACITY
                                    : 0,
                            }}
                            transition={
                              straining && !reduced && i < reveals
                                ? {
                                    duration: strainHalfPeriodS,
                                    repeat: Infinity,
                                    repeatType: "mirror",
                                    ease: "easeInOut",
                                  }
                                : {
                                    duration: sec(
                                      revealed
                                        ? bleedMs
                                        : sealed
                                          ? FAIL_SEAL_DURATION_MS
                                          : LEAK_FADE_DURATION_MS,
                                    ),
                                    ease: EASE_JUICE,
                                  }
                            }
                          />
                        ))}
                        {/* CLASS reveal light (Beat 4) — the SAME reveal paths,
                            re-lit in the drawn class's colour, BRIGHTER than
                            the violet rest state (saturation shift, not a
                            subtle gradient). Mounted only once a class
                            exists — never in the DOM pre-tell. */}
                        {revealed &&
                          classToken !== null &&
                          REVEAL_STEPS.map((step, i) => (
                            <m.path
                              key={`class-leak-${i}`}
                              data-testid={`reveal-class-leak-${i}`}
                              d={step.path}
                              fill="none"
                              stroke={classToken}
                              strokeWidth={7}
                              strokeLinecap="round"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: TELL_LEAK_OPACITY }}
                              transition={{
                                duration: sec(bleedMs),
                                ease: EASE_JUICE,
                              }}
                            />
                          ))}
                        {/* Reveal lines — draw on per tap (reduced: appear
                            instantly), REVERSE-draw closed on failure, fade
                            under the tell's class-coloured re-light. */}
                        {REVEAL_STEPS.map((step, i) => (
                          <m.path
                            key={`reveal-${i}`}
                            d={step.path}
                            data-testid={`reveal-reveal-${i}`}
                            fill="none"
                            stroke="var(--color-brand-hot)"
                            strokeWidth={2.5}
                            strokeLinejoin="round"
                            initial={false}
                            animate={{
                              pathLength: sealed ? 0 : i < reveals ? 1 : 0,
                              opacity: revealed ? 0 : 1,
                            }}
                            transition={{
                              pathLength: {
                                duration: reduced
                                  ? 0
                                  : sec(
                                      sealed
                                        ? FAIL_SEAL_DURATION_MS
                                        : REVEAL_DRAW_DURATION_MS,
                                    ),
                                ease: EASE_SNAP,
                              },
                              opacity: {
                                duration: sec(revealed ? bleedMs : 0),
                                ease: EASE_JUICE,
                              },
                            }}
                          />
                        ))}
                        {/* CLASS reveal lines — the drawn-on reveals, recoloured.
                            Fully drawn already (pathLength 1): the tell shifts
                            colour, it never redraws. */}
                        {revealed &&
                          classToken !== null &&
                          REVEAL_STEPS.map((step, i) => (
                            <m.path
                              key={`class-reveal-${i}`}
                              data-testid={`reveal-class-reveal-${i}`}
                              d={step.path}
                              fill="none"
                              stroke={classToken}
                              strokeWidth={2.5}
                              strokeLinejoin="round"
                              initial={{ pathLength: 1, opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{
                                duration: sec(bleedMs),
                                ease: EASE_JUICE,
                              }}
                            />
                          ))}
                      </m.g>
                    </m.g>
                  </m.g>
                  {/* Beat 5 fragments — pieces OF the shared pass (same shell
                      colour recipe), FIXED geometry (NG-007), flight inside
                      UNSEAL_DURATION_MS. Skipped under reduced motion (the
                      shell's crossfade above is the whole exit). */}
                  {unsealed && !reduced && (
                    <g transform="translate(100 137)" data-testid="reveal-fragments">
                      {SHELL_FRAGMENTS.map((f, i) => (
                        <m.polygon
                          key={`fragment-${i}`}
                          data-testid={`reveal-fragment-${i}`}
                          points={f.points}
                          // The spike's proven shard recipe — LIGHT against
                          // the near-black backdrop (a shell-dark mix reads
                          // invisible mid-flight; screenshot-verified), rim
                          // in the pass's own brand stroke.
                          fill="color-mix(in srgb, var(--color-brand-deep) 70%, var(--color-ink))"
                          stroke="var(--color-brand)"
                          strokeWidth={1}
                          initial={{
                            x: f.x0,
                            y: f.y0,
                            rotate: 0,
                            scale: f.scale,
                            opacity: 0,
                          }}
                          animate={{
                            x: f.x0 + f.dx,
                            y: f.y0 + f.dy,
                            rotate: f.spinDeg,
                            scale: f.scale * UNSEAL_FRAGMENT_SCALE_DECAY,
                            // Pop visible instantly, fade over the flight.
                            opacity: [1, 1, 0],
                          }}
                          transition={{
                            duration: sec(UNSEAL_FRAGMENT_FLIGHT_MS),
                            ease: EASE_SNAP,
                          }}
                        />
                      ))}
                    </g>
                  )}
                </m.g>
              </svg>
            </m.span>
            {/* Beat 4 bloom — class-coloured light washing the WHOLE pass,
                screen-blended above the shell (the climax signal; spike-
                proven idiom). Bounded to the pass zone. Reduced motion:
                opacity crossfade only, no scale. */}
            {revealed && classToken !== null && (
              <m.span
                aria-hidden
                data-testid="reveal-tell-bloom"
                className="pointer-events-none absolute -inset-8 block rounded-full mix-blend-screen"
                style={{
                  background: `radial-gradient(closest-side, color-mix(in srgb, ${classToken} 60%, transparent), transparent 76%)`,
                }}
                initial={
                  reduced
                    ? { opacity: 0 }
                    : { opacity: 0, scale: TELL_BLOOM_SCALE_FROM }
                }
                animate={{
                  opacity: telling ? TELL_BLOOM_MAX_OPACITY : 0,
                  scale: 1,
                }}
                transition={{
                  duration: sec(telling ? bleedMs : UNSEAL_FLASH_DURATION_MS),
                  ease: EASE_JUICE,
                }}
              />
            )}
            {/* Beat 5 flash — BOUNDED (pass zone, never full-screen) and
                class-coloured, never white (spec §3 Beat 5: it must read on
                a compressed stream, not blow it out). Fast attack, quick
                decay. Reduced motion: a STATIC class glow instead. */}
            {unsealed && classToken !== null && (
              <m.span
                aria-hidden
                data-testid="reveal-unseal-flash"
                className="pointer-events-none absolute -inset-10 block rounded-full mix-blend-screen"
                style={{
                  background: `radial-gradient(closest-side, color-mix(in srgb, ${classToken} 78%, transparent), transparent 72%)`,
                }}
                initial={{ opacity: 0 }}
                animate={
                  reduced
                    ? { opacity: UNSEAL_FLASH_REDUCED_OPACITY }
                    : { opacity: [0, UNSEAL_FLASH_PEAK_OPACITY, 0] }
                }
                transition={
                  reduced
                    ? { duration: 0 }
                    : {
                        duration: sec(UNSEAL_FLASH_DURATION_MS),
                        times: [0, UNSEAL_FLASH_PEAK_TIME, 1],
                        ease: "easeOut",
                      }
                }
              />
            )}
          </button>
          {/* Reduced-motion strain: the loop is replaced by a static state —
              caption (BeatCaption) + this non-animated affordance. */}
          {straining && reduced && (
            <span
              data-testid="strain-static-affordance"
              className="block h-1 w-16 rounded-full bg-brand"
            />
          )}
        </m.div>
      </MotionConfig>
    </LazyMotion>
  );
}
