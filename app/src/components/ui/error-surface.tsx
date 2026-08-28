/*
 * ErrorSurface (UI constitution PART 5.9 / 6.10): errors fade in with a
 * 4px rise — never a modal slam, never a shake (the only shake on the site
 * is a Verify check failure). The urgency is carried by role="alert" and
 * plain words, not by motion. Render it in place, next to the fix.
 */
import type { ReactNode } from 'react';

export function ErrorSurface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={
        'error-surface rounded-xl border border-price-down/40 bg-raised px-4 py-3 ' +
        'text-[14px] leading-5 text-ink ' +
        className
      }
    >
      {children}
    </div>
  );
}
