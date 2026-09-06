'use client';

/*
 * The landing hero's ambient clip (master prompt D): muted, looping,
 * playsInline, poster-first — THE one ambient loop for the top viewport
 * (motion rule: one per viewport). Reduced motion renders the poster
 * image and no <video> at all. H.264 + VP9 sources, same reasoning as
 * the preloader: Chromium builds without proprietary codecs must not
 * lose the hero.
 */

import { usePrefersReducedMotion } from '@/components/blot/springs';

export interface HeroClipProps {
  mp4: string;
  webm: string;
  poster: string;
  className?: string;
}

export function HeroClip({ mp4, webm, poster, className }: HeroClipProps) {
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
      <source src={mp4} type="video/mp4" />
      <source src={webm} type="video/webm" />
    </video>
  );
}
