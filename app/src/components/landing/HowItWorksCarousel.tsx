'use client';

/*
 * How it works — one step at a time (founder 2026-09-09).
 *
 * The five ratified steps were a row of small still cards. They are now one
 * large card at a time, each fronted by the ANIMATED version of its scene
 * (the same Higgsfield loops the stills were cut from), with a clicker to
 * move between them: previous / next buttons, dots, the arrow keys while the
 * strip has focus, and a horizontal swipe on touch.
 *
 * Only the visible card mounts a <video>; the others hold their poster, so
 * the page never decodes five loops at once (the motion rule — one ambient
 * loop per viewport — is kept: the hero reel is above, this is below the
 * fold). Reduced motion renders the poster only, exactly as the hero does.
 *
 * The step COPY is untouched; this component only decides presentation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '@/components/blot/springs';
import { COPY } from '@/copy';

export interface HowItWorksStep {
  title: string;
  body: string;
}

/** The scene loop for each step, in step order (docs/handoff manifest ids in the PR). */
const STEP_CLIPS = [1, 2, 3, 4, 5].map((n) => ({
  mp4: `/motion/landing/steps/step${n}.mp4`,
  webm: `/motion/landing/steps/step${n}.webm`,
  poster: `/motion/landing/steps/step${n}.jpg`,
}));

const SWIPE_PX = 40;

export function HowItWorksCarousel({ steps }: { steps: readonly HowItWorksStep[] }) {
  const [index, setIndex] = useState(0);
  const reduced = usePrefersReducedMotion();
  const count = steps.length;
  const touchX = useRef<number | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (next: number) => setIndex(((next % count) + count) % count),
    [count],
  );

  // Arrow keys move the strip while any part of it has focus.
  useEffect(() => {
    const el = regionRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [go, index]);

  const step = steps[index];
  const clip = STEP_CLIPS[index] ?? STEP_CLIPS[0];

  return (
    <div
      ref={regionRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={COPY.howItWorks.title}
      tabIndex={0}
      className="focus:outline-none focus-visible:rounded-3xl focus-visible:ring-2 focus-visible:ring-brand-berry/60"
      onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        if (start === null) return;
        const dx = (e.changedTouches[0]?.clientX ?? start) - start;
        if (dx <= -SWIPE_PX) go(index + 1);
        else if (dx >= SWIPE_PX) go(index - 1);
      }}
    >
      <div
        className="overflow-hidden rounded-3xl bg-brand-cream shadow-[0_12px_40px_rgba(94,27,64,0.22)]"
        aria-live="polite"
      >
        <div className="relative aspect-video w-full bg-brand-pale-pink">
          {reduced ? (
            // eslint-disable-next-line @next/next/no-img-element -- poster swap for a video
            <img src={clip.poster} alt="" aria-hidden="true" className="h-full w-full object-cover" />
          ) : (
            <video
              key={index}
              className="h-full w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster={clip.poster}
              aria-hidden="true"
            >
              <source src={clip.mp4} type="video/mp4" />
              <source src={clip.webm} type="video/webm" />
            </video>
          )}
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-end sm:p-7">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-brand-deep-magenta">
              {COPY.howItWorks.stepOf(index + 1, count)}
            </p>
            <h3 className="mt-1 font-display text-[24px] font-extrabold leading-7 text-brand-berry sm:text-[30px] sm:leading-9">
              {step.title}
            </h3>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-5 text-brand-berry/85 sm:text-[15px] sm:leading-6">
              {step.body}
            </p>
          </div>
          <div className="flex items-center gap-2 self-end">
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label={COPY.howItWorks.prevStep}
              className="grid h-11 w-11 place-items-center rounded-full border-2 border-brand-berry text-brand-berry hover:bg-brand-berry/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-deep-magenta"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label={COPY.howItWorks.nextStep}
              className="grid h-11 w-11 place-items-center rounded-full bg-brand-berry text-brand-cream hover:bg-brand-deep-magenta focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-deep-magenta"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <ol className="mt-4 flex items-center justify-center gap-2" aria-label={COPY.howItWorks.title}>
        {steps.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => go(i)}
              aria-label={COPY.howItWorks.stepOf(i + 1, count)}
              aria-current={i === index ? 'step' : undefined}
              className={`block h-2.5 rounded-full transition-[width,background-color] duration-200 ${
                i === index ? 'w-7 bg-brand-berry' : 'w-2.5 bg-brand-berry/35 hover:bg-brand-berry/60'
              }`}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
