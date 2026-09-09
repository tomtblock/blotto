'use client';

/*
 * The landing hero's ambient clip (master prompt D): muted, looping,
 * playsInline, poster-first — THE one ambient loop for the top viewport
 * (motion rule: one per viewport). Reduced motion renders the poster
 * image and no <video> at all. H.264 + VP9 sources, same reasoning as
 * the preloader: Chromium builds without proprietary codecs must not
 * lose the hero.
 *
 * Founder 2026-09-09 ("videos optimised to 4K, super clear"): the clip
 * ships in tiers. Each tier is a pair of sources with a media query; the
 * browser takes the first tier whose query matches, so a 4K screen
 * streams the 2160p master and a phone the 1080p cut — one download, the
 * right one. Tiers are listed largest first; the last carries no query
 * and is the fallback.
 */

import { usePrefersReducedMotion } from '@/components/blot/springs';

export interface ClipTier {
  mp4: string;
  webm: string;
  /** CSS media query this tier is for; omit on the fallback tier. */
  media?: string;
}

export interface HeroClipProps {
  /** Largest first; the last tier has no `media`. */
  tiers: readonly ClipTier[];
  poster: string;
  className?: string;
}

export function HeroClip({ tiers, poster, className }: HeroClipProps) {
  const reduced = usePrefersReducedMotion();
  if (reduced) {
    // eslint-disable-next-line @next/next/no-img-element -- poster swap for a video; next/image adds nothing here
    return <img src={poster} alt="" aria-hidden="true" className={className} />;
  }
  return (
    <video
      className={className}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      poster={poster}
      aria-hidden="true"
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
