'use client';

/*
 * <Preloader /> — the first-visit curtain (preloader prompt v2; Figma page
 * 08 is intent). A 15-second reveal: 0–10 s the camera draws back from a
 * crowd of Blots to the inflated BLOTTO word; 10–15 s hold, the O's churn,
 * and the film loops its last five seconds until the visitor presses
 * Enter. One Enter, one quiet Skip, the age/territory line — nothing
 * else. No sound, no controls, no progress bar, no "loading…" copy: the
 * video IS the loading indicator.
 *
 * All behaviour rules live in preloader-model.ts (pure, tested). This
 * file is the DOM shell: video wiring, timers, focus, the flag write.
 * The flag is written ON ENTER ONLY — Skip and load never write it.
 *
 * Two-layer rule on this surface: brand layer only. Berry text on pink,
 * the yellow lives INSIDE the film, and the one commit-coloured object is
 * the Enter pill. The only numbers on the surface are the footer line's
 * words — written out, not digits.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { COPY } from '@/copy';
import { usePrefersReducedMotion } from '@/components/blot/springs';
import {
  CANPLAY_TIMEOUT_MS,
  ENTER_DEADLINE_MS,
  PRELOADER_FLAG_KEY,
  PRELOADER_FLAG_VALUE,
  initialPreloaderState,
  reducePreloader,
} from './preloader-model';
import './preloader.css';

const BASE = '/motion/preloader';
/* Each variant ships H.264 (universal) plus a VP9 WebM fallback — Linux
 * Chromium builds without proprietary codecs would otherwise fall to the
 * poster on every visit. The browser walks the <source> list. */
const SRC_1080 = { mp4: `${BASE}/blotto_preloader_v2_15s_1080.mp4`, webm: `${BASE}/blotto_preloader_v2_15s_1080.webm` };
const SRC_720 = { mp4: `${BASE}/blotto_preloader_v2_15s_720.mp4`, webm: `${BASE}/blotto_preloader_v2_15s_720.webm` };
/** 9:16 reframe for phones; null until the asset ships → letterbox. */
const SRC_PORTRAIT: { mp4: string; webm?: string } | null = null;
const POSTER_START = `${BASE}/poster_start.jpg`;
const POSTER_SETTLE = `${BASE}/poster_settle.jpg`;

export interface PreloaderProps {
  /** Called after the 300 ms exit fade completes — unmount me. */
  onDone: () => void;
}

export function Preloader({ onDone }: PreloaderProps) {
  const reducedMotion = usePrefersReducedMotion();
  // save-data is a mount-time decision, like the prompt's slow-network rule.
  const [noMotion] = useState<boolean>(() => {
    const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
    return conn?.saveData === true;
  });
  const [state, dispatch] = useReducer(
    reducePreloader,
    reducedMotion || noMotion,
    initialPreloaderState
  );
  const { phase } = state;

  // Source choice at mount (this component never server-renders).
  const [{ src, letterbox }] = useState(() => {
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    if (portrait && SRC_PORTRAIT) return { src: SRC_PORTRAIT, letterbox: false };
    if (portrait) return { src: SRC_720, letterbox: true };
    return { src: window.innerWidth <= 800 ? SRC_720 : SRC_1080, letterbox: false };
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const skipRef = useRef<HTMLButtonElement | null>(null);
  const enterRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const appliedSeek = useRef(0);

  /* Video-level failure, natively: a per-<source> error must NOT count —
   * the browser is still walking the fallback list when one fires. React's
   * delegated onError on <video> hears descendant source errors too (root
   * capture), so the listener goes on the element with a target check. */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onErr = (e: Event) => {
      if (e.target === v) dispatch({ type: 'video-error' });
    };
    v.addEventListener('error', onErr);
    return () => v.removeEventListener('error', onErr);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ref is set on first commit; the video mounts/unmounts with phase
  }, [phase !== 'static']);

  /* Timers: the canplay watchdog and the 10.5 s Enter guard. */
  useEffect(() => {
    if (phase !== 'playing') return;
    const guard = setTimeout(() => dispatch({ type: 'deadline' }), ENTER_DEADLINE_MS);
    const watchdog = setTimeout(() => {
      const v = videoRef.current;
      // readyState ≥ 3 is canplay; anything less this late means a slow pipe.
      if (!v || v.readyState < 3) dispatch({ type: 'canplay-timeout' });
    }, CANPLAY_TIMEOUT_MS);
    return () => {
      clearTimeout(guard);
      clearTimeout(watchdog);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arm once for the playing phase
  }, [phase === 'playing']);

  /* Apply model-ordered seeks (Skip, the loop, the stall guard) once each. */
  useEffect(() => {
    const seek = state.seek;
    const v = videoRef.current;
    if (!seek || !v || seek.seq === appliedSeek.current) return;
    appliedSeek.current = seek.seq;
    try {
      v.currentTime = seek.to;
      void v.play().catch(() => dispatch({ type: 'video-error' }));
    } catch {
      dispatch({ type: 'video-error' });
    }
  }, [state.seek]);

  /* Focus: Skip while playing, Enter once it exists; trap Tab inside. */
  useEffect(() => {
    if (phase === 'playing') skipRef.current?.focus();
    if (phase === 'settled' || phase === 'static') enterRef.current?.focus();
  }, [phase]);

  /* The page beneath renders from the start; just stop it scrolling. */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const enter = useCallback(() => {
    if (phase !== 'settled' && phase !== 'static') return;
    try {
      localStorage.setItem(PRELOADER_FLAG_KEY, PRELOADER_FLAG_VALUE);
    } catch {
      // Storage refused (private mode): the visitor just sees it again.
    }
    dispatch({ type: 'enter' });
    setTimeout(() => {
      onDone();
      // Land the reader on the page's headline, as if arriving fresh.
      const h1 = document.querySelector('h1');
      if (h1 instanceof HTMLElement) {
        h1.setAttribute('tabindex', '-1');
        h1.focus();
      }
    }, 300);
  }, [phase, onDone]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dispatch({ type: 'skip' });
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && (phase === 'settled' || phase === 'static')) {
        // Buttons handle their own keys; this catches "anywhere else".
        if (e.target === rootRef.current || e.target === videoRef.current) {
          e.preventDefault();
          enter();
        }
      }
      if (e.key === 'Tab') {
        // Two focusables at most; keep the ring inside the dialog.
        const focusables = [skipRef.current, enterRef.current].filter(
          (b): b is HTMLButtonElement => !!b && !b.disabled && b.offsetParent !== null
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [phase, enter]
  );

  const settledOrStatic = phase === 'settled' || phase === 'static';

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={COPY.preloader.dialogLabel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`fixed inset-0 z-50 bg-brand-pink transition-opacity duration-300 ease-out ${
        phase === 'leaving' ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      {/* The film (states A/B). Decorative: the sr-only line below speaks. */}
      {phase !== 'static' && (
        <video
          ref={videoRef}
          className={`h-full w-full ${letterbox ? 'object-contain' : 'object-cover object-[50%_85%]'}`}
          poster={POSTER_START}
          autoPlay
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          onTimeUpdate={(e) => dispatch({ type: 'timeupdate', currentTime: e.currentTarget.currentTime })}
          onEnded={() => dispatch({ type: 'ended' })}
          onClick={settledOrStatic ? enter : undefined}
        >
          {/* VP9 first (2026-09-27, page speed: the same frames at 70% of the
              bytes, and every browser but Safari plays it); H.264 last, and
              its failure means nothing else can play. */}
          {src.webm && <source src={src.webm} type="video/webm" />}
          <source src={src.mp4} type="video/mp4" onError={() => dispatch({ type: 'video-error' })} />
        </video>
      )}
      {phase === 'static' && (
        // State C: the settle poster, no video element at all.
        // eslint-disable-next-line @next/next/no-img-element -- full-viewport poster; next/image adds nothing over a plain eager img here
        <img
          src={POSTER_SETTLE}
          alt=""
          aria-hidden="true"
          className={`h-full w-full ${letterbox ? 'object-contain' : 'object-cover object-[50%_85%]'}`}
          onClick={enter}
        />
      )}

      <span className="sr-only">{COPY.preloader.srIntro}</span>

      {/* Skip — quiet, berry on pink, from t=0 (state A only). */}
      {phase === 'playing' && (
        <button
          ref={skipRef}
          type="button"
          onClick={() => dispatch({ type: 'skip' })}
          className="absolute right-8 top-8 min-h-11 rounded-full border-2 border-brand-berry px-5 py-2 font-mono text-[13px] uppercase tracking-wide text-brand-berry focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand-cream"
          style={{ top: 'max(2rem, env(safe-area-inset-top))' }}
        >
          {COPY.preloader.skip}
        </button>
      )}

      {/* Enter — the one commit-coloured object on the surface (state B/C).
          Founder 2026-09-16 (round two): the block sits in the bottom band,
          on the floor under the word rather than across it — the film is
          cover-cropped from the top (object-position above) so that floor
          survives a wide, short window — and the line is set as display
          capitals in three pieces that wrap whole. Still words, not digits. */}
      {settledOrStatic && (
        <div
          className="absolute inset-x-0 flex flex-col items-center gap-3 px-6 sm:gap-4"
          style={{ bottom: 'max(3.5rem, calc(env(safe-area-inset-bottom) + 3rem))' }}
        >
          <button
            ref={enterRef}
            type="button"
            onClick={enter}
            className="preloader-enter min-h-12 rounded-full border-[3px] border-brand-cream bg-game-action px-12 py-3.5 font-display text-[26px] font-bold uppercase tracking-wide text-brand-berry shadow-[0_6px_24px_rgba(94,27,64,0.35)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-brand-cream sm:px-14 sm:text-[30px]"
          >
            {COPY.preloader.enter}
          </button>
          <p className="text-center font-display text-[22px] font-extrabold uppercase leading-[1.15] tracking-wide text-brand-berry sm:text-[26px] lg:text-[30px]">
            {COPY.preloader.line.split(' \u00b7 ').flatMap((piece, i) => [
              i > 0 ? (
                <span key={`dot-${i}`} aria-hidden="true">
                  {' \u00b7 '}
                </span>
              ) : null,
              <span key={piece} className="inline-block whitespace-nowrap">
                {piece}
              </span>,
            ])}
          </p>
        </div>
      )}

      {/* The age/territory line — always visible, berry on pink. */}
      <p
        className="absolute left-8 text-[12px] text-brand-berry"
        style={{ bottom: 'max(2rem, env(safe-area-inset-bottom))' }}
      >
        {COPY.pool.ageTerritoryNote}
      </p>
    </div>
  );
}
