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
 *   - THE POSTER IS THE PAGE'S FIRST PICTURE (2026-10-26, D-E12 page
 *     speed). The server renders the poster as an <img>; the <video> takes
 *     its place after hydration. A below-the-fold clip (`preload="none"`)
 *     loads that <img> lazily, so it does not compete with the top of the
 *     page for the first second of a phone connection. A `priority` clip
 *     (the landing hero, whose poster is the page's largest paint) asks for
 *     its poster first, and hands over to the <video> only once the poster
 *     has painted — swapped any earlier, the paint that counts becomes the
 *     video's, which waits on every script on the page (one Lighthouse run
 *     of 2026-10-26 recorded exactly that: the video as the largest paint,
 *     at 6.6 s). The video then reuses the cut the <img> chose, so nothing
 *     is fetched twice.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePrefersReducedMotion } from '@/components/blot/springs';

export interface ClipTier {
  mp4: string;
  webm: string;
  /** CSS media query this tier is for; omit on the fallback tier. */
  media?: string;
}

/** A larger cut of the poster and the CSS media query it is for. */
export interface PosterTier {
  src: string;
  media: string;
}

export interface AmbientClipProps {
  /** Largest first; the last tier has no `media`. */
  tiers: readonly ClipTier[];
  /** The poster; with `posterTiers`, the smallest cut (the fallback). */
  poster: string;
  /**
   * Larger cuts of the poster, largest first, chosen by media query like
   * `tiers`. Media queries rather than a width `srcset`: a `srcset` image is
   * sized by its density-corrected width, which the largest-paint measure
   * can read as upscaled — and then the video's poster that replaces it
   * would count as a new, later paint.
   */
  posterTiers?: readonly PosterTier[];
  /** This poster is the page's largest paint: fetch it first, swap after it paints. */
  priority?: boolean;
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
  posterTiers,
  priority = false,
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
  const imgRef = useRef<HTMLImageElement>(null);
  // A priority clip's poster, once it has painted: the cut the <img> chose.
  const [painted, setPainted] = useState<string | null>(null);
  const video = !reduced && hydrated && (!priority || painted !== null);

  useEffect(() => {
    const img = imgRef.current;
    if (!priority || reduced || !img) return;
    let frame = 0;
    // One frame after load, so the poster is on screen before it is replaced.
    // A poster that fails to load hands over too: the video is still wanted.
    const shown = () => {
      frame = requestAnimationFrame(() => setPainted(img.currentSrc || poster));
    };
    if (img.complete) shown();
    else {
      img.addEventListener('load', shown);
      img.addEventListener('error', shown);
    }
    return () => {
      cancelAnimationFrame(frame);
      img.removeEventListener('load', shown);
      img.removeEventListener('error', shown);
    };
  }, [priority, reduced, poster]);

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
    const img = (
      // eslint-disable-next-line @next/next/no-img-element -- poster swap for a video; next/image adds nothing here
      <img
        ref={imgRef}
        src={poster}
        alt=""
        aria-hidden="true"
        className={className}
        fetchPriority={priority ? 'high' : undefined}
        loading={preload === 'none' ? 'lazy' : undefined}
      />
    );
    if (!posterTiers?.length) return img;
    return (
      // `display: contents`: the <img> keeps its place in the caller's layout.
      <picture className="contents">
        {posterTiers.map((t) => (
          <source key={t.src} srcSet={t.src} media={t.media} />
        ))}
        {img}
      </picture>
    );
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
      poster={painted ?? poster}
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
