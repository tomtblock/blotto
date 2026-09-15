'use client';

/*
 * A quiet in-progress hold (checks, loads, the wait for a confirmation) —
 * never a bare ellipsis. Past SLOW_HOLD_MS it names the stage as slow so a
 * stuck step is reportable.
 *
 * Lived inside play-client.tsx until 2026-09-15, when the entry takeover
 * needed the same hold for its waiting beat (the founder's instruction of
 * 2026-09-14 removed the egg that used to fill that wait) and importing a
 * page's private component from the takeover it mounts would have been a
 * circular import.
 */

import { useEffect, useState } from 'react';
import { COPY } from '@/copy';

const SLOW_HOLD_MS = 4_000;

export function PendingPanel({ label }: { label: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_HOLD_MS);
    return () => clearTimeout(t);
  }, [label]);
  return (
    <section aria-live="polite" className="flex flex-col items-center gap-4 py-14">
      <div className="h-8 w-8 rounded-full border-2 border-overlay border-t-brand motion-safe:animate-rotate" aria-hidden />
      <p className="text-[13px] uppercase tracking-[0.14em] text-ink-muted">{label}</p>
      {slow && <p className="max-w-prose text-center text-[13px] leading-5 text-ink-muted">{COPY.gate.slowHold}</p>}
    </section>
  );
}
