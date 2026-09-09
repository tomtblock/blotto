/*
 * <BlottSprite /> — one rendered pose of the Blott as a plain image, for
 * the antics (Antics.tsx) and any surface that wants the character without
 * the machine's warp. Decorative by default (empty alt); pass `label` to
 * make it announce itself.
 *
 * The twelve poses are the founder's character rendered by the same
 * pipeline as the hero frame (public/blott/*.webp, 1024² and a 384² set
 * for small uses). Names are the file names.
 */

import './blott.css';

export type BlottPose =
  | 'hero'
  | 'cheer'
  | 'strain'
  | 'run-a'
  | 'run-b'
  | 'jump'
  | 'peek'
  | 'wave'
  | 'sleep'
  | 'tumble'
  | 'dance'
  | 'trophy';

export const BLOTT_POSES: readonly BlottPose[] = [
  'hero',
  'cheer',
  'strain',
  'run-a',
  'run-b',
  'jump',
  'peek',
  'wave',
  'sleep',
  'tumble',
  'dance',
  'trophy',
];

export function blottPoseUrl(pose: BlottPose, small = false): string {
  return small ? `/blott/sm/${pose}.webp` : `/blott/${pose}.webp`;
}

export function BlottSprite({
  pose,
  size,
  label,
  className,
  flip = false,
}: {
  pose: BlottPose;
  /** CSS px, square. Sizes up to 160 use the small set. */
  size: number;
  label?: string;
  className?: string;
  /** Mirror horizontally (a runner heading left). */
  flip?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static character art, sized by the caller
    <img
      src={blottPoseUrl(pose, size <= 160)}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      width={size}
      height={size}
      draggable={false}
      loading="lazy"
      decoding="async"
      className={`blott-sprite${flip ? ' is-flipped' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
    />
  );
}
