'use client';

/*
 * FadeInView: one micro enter (250ms ease-out, 6px rise) the first time the
 * element scrolls into view, then permanent rest. For below-the-fold
 * content whose mount-time animation would otherwise play unseen. Reduced
 * motion: the global collapse makes it an instant appearance.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function FadeInView({
  children,
  className = '',
  /** Stagger delay in ms (30–80ms between siblings; cap at ~300ms so late
   * items appear instantly rather than queueing). */
  delayMs = 0,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setInView(true);
        }
      },
      { rootMargin: '0px 0px -40px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  return (
    <div
      ref={ref}
      className={`${inView ? 'animate-enter' : 'opacity-0'} ${className}`}
      style={delayMs > 0 && inView ? { animationDelay: `${Math.min(delayMs, 300)}ms` } : undefined}
    >
      {children}
    </div>
  );
}
