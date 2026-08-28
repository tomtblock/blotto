/*
 * Skeleton (UI constitution PART 5.9): a loading placeholder that breathes
 * at most once per second and is replaced by content with a crossfade and
 * zero layout jump — size it to the content it stands in for. A wait is a
 * state, not a performance.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}
