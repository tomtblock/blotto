'use client';

/*
 * AmbientClip (founder 2026-09-16): the one way an ambient loop is put on a
 * page — the landing hero, the pool card, the pool page's rails, the steps,
 * the signing hold — so every clip follows the same rules:
 *
 *   - muted, looping, playsInline, poster-first; VP9 + H.264 sources so a
 *     Chromium build without proprietary codecs never loses the clip;
 *   - THE VP9 SOURCE IS LISTED FIRST (2026-09-27, page speed): a browser
 *     takes the first source it can play, and every browser but Safari
 *     plays VP9, whose file is 40–60% of the H.264 one AT THE SAME
 *     RESOLUTION (the 2160p hero: 18.6 MB against 44.4 MB). Safari falls
 *     through to the H.264 file. Nothing is re-encoded; only the order.
 *   - tiers, largest first, the last without a media query (the fallback);
 *   - reduced motion renders the poster image and no <video> at all;
 *   - `playWhenVisible` (the motion rule: ONE ambient loop per viewport):
 *     the clip plays only while `visibleFraction` of it is on screen and
 *     pauses otherwise, so a page that carries two loops never runs both
 *     for long — PHASE-N-REVIEW: they can overlap for a beat mid-scroll.
 *     `preload="none"` with it means an off-screen clip costs nothing
 *     until it scrolls in: play() starts the download then;
 *   - `media`: a clip that exists only at some widths (the pool rails, the
 *     strip) mounts its <video> only when the query matches, so a phone
 *     never streams the rails and a desktop never streams the strip. The
 *     server and the first client render agree on the poster.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { usePrefersReducedMotion } from '@/components/blot/springs';

export interface ClipTier {
  mp4: string;
  webm: string;
  /** CSS media query this tier is for; omit on the fallback tier. */
  media?: string;
}

export interface AmbientClipProps {
  /** Largest first; the last tier has no `media`. */
  tiers: readonly ClipTier[];
  poster: string;
  className?: string;
  /** Play only while this much of the clip is in view (0–1); omit to play always. */
  playWhenVisible?: number;
  /**
   * `metadata` (default) fetches the header and first frames at once —
   * right for a clip at the top of the page; `none` fetches nothing until
   * it plays — right for a clip below the fold with `playWhenVisible`;
   * `auto` when the clip must be ready the moment it shows (the hold).
   */
  preload?: 'none' | 'metadata' | 'auto';
  /** Hold the last frame instead of looping (a one-shot clip). */
  once?: boolean;
  /** Fired when a one-shot clip reaches its end. */
  onEnded?: () => void;
  /** Hold the clip still (a stopped belt after a failure); clears to resume. */
  paused?: boolean;
}

/* Hydration as an external store: false on the server and for the
 * hydrating render (so both draw the poster), true after. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function AmbientClip({
  tiers,
  poster,
  className = '',
  playWhenVisible,
  preload = 'metadata',
  once = false,
  onEnded,
  paused = false,
}: AmbientClipProps) {
  const reduced = usePrefersReducedMotion();
  const hydrated = useHydrated();
  const ref = useRef<HTMLVideoElement>(null);
  const video = !reduced && hydrated;

  useEffect(() => {
    const el = ref.current;
    if (!el || !video) return;
    if (paused) el.pause();
    else if (playWhenVisible === undefined) void el.play().catch(() => {});
  }, [paused, playWhenVisible, video]);

  useEffect(() => {
    const el = ref.current;
    if (!el || playWhenVisible === undefined || !video) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.intersectionRatio >= playWhenVisible) {
          void el.play().catch(() => {});
        } else {
          el.pause();
        }
      },
      { threshold: [0, playWhenVisible, 1] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [playWhenVisible, video]);

  if (!video) {
    // eslint-disable-next-line @next/next/no-img-element -- poster swap for a video; next/image adds nothing here
    return <img src={poster} alt="" aria-hidden="true" className={className} />;
  }
  return (
    <video
      ref={ref}
      className={className}
      autoPlay={playWhenVisible === undefined}
      muted
      loop={!once}
      playsInline
      preload={preload}
      poster={poster}
      aria-hidden="true"
      onEnded={onEnded}
    >
      {tiers.map((t) => (
        <source key={`${t.webm}:${t.media ?? ''}`} src={t.webm} type="video/webm" media={t.media} />
      ))}
      {tiers.map((t) => (
        <source key={`${t.mp4}:${t.media ?? ''}`} src={t.mp4} type="video/mp4" media={t.media} />
      ))}
    </video>
  );
}
