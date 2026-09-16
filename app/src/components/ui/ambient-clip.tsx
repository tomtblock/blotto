'use client';

/*
 * AmbientClip (founder 2026-09-16): the one way an ambient loop is put on a
 * page — lifted from the landing hero (HeroClip) so the pool card, the pool
 * page's conveyor rails and the seal stage all follow the same rules:
 *
 *   - muted, looping, playsInline, poster-first; H.264 + VP9 sources so a
 *     Chromium build without proprietary codecs never loses the clip;
 *   - tiers, largest first, the last without a media query (the fallback);
 *   - reduced motion renders the poster image and no <video> at all;
 *   - `playWhenVisible` (the motion rule: ONE ambient loop per viewport):
 *     the clip plays only while `visibleFraction` of it is on screen and
 *     pauses otherwise, so a page that carries two loops never runs both
 *     for long — PHASE-N-REVIEW: they can overlap for a beat mid-scroll.
 *
 * HeroClip stays as it is (the landing's own copy); nothing on the landing
 * changes by this file existing.
 */

import { useEffect, useRef } from 'react';
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
  /** `auto` when the clip must be ready the moment it shows (the seal stage). */
  preload?: 'metadata' | 'auto';
  /** Hold the last frame instead of looping (a one-shot clip). */
  once?: boolean;
  /** Fired when a one-shot clip reaches its end. */
  onEnded?: () => void;
  /** Mirror horizontally — the pool page's right rail is the left rail's asset. */
  mirror?: boolean;
  /** Hold the clip still (a stopped belt after a failure); clears to resume. */
  paused?: boolean;
}

export function AmbientClip({
  tiers,
  poster,
  className = '',
  playWhenVisible,
  preload = 'metadata',
  once = false,
  onEnded,
  mirror = false,
  paused = false,
}: AmbientClipProps) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);
  const style = mirror ? { transform: 'scaleX(-1)' } : undefined;

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    if (paused) el.pause();
    else if (playWhenVisible === undefined) void el.play().catch(() => {});
  }, [paused, playWhenVisible, reduced]);

  useEffect(() => {
    const el = ref.current;
    if (!el || playWhenVisible === undefined || reduced) return;
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
  }, [playWhenVisible, reduced]);

  if (reduced) {
    // eslint-disable-next-line @next/next/no-img-element -- poster swap for a video; next/image adds nothing here
    return <img src={poster} alt="" aria-hidden="true" className={className} style={style} />;
  }
  return (
    <video
      ref={ref}
      className={className}
      style={style}
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
        <source key={`${t.mp4}:${t.media ?? ''}`} src={t.mp4} type="video/mp4" media={t.media} />
      ))}
      {tiers.map((t) => (
        <source key={`${t.webm}:${t.media ?? ''}`} src={t.webm} type="video/webm" media={t.media} />
      ))}
    </video>
  );
}
