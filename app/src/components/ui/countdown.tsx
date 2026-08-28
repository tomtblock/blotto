"use client";

/*
 * Countdown (D1): visible, tabular, and CALM — a fixture clock, not a
 * pressure device. It never changes colour as time runs down, never pulses,
 * and never sits adjacent to a payment button (D3's do-not-build list bans
 * countdown pressure on pay); the per-screen session timer in the
 * allocation flow is a separate component with its own ratified rules (R9).
 *
 * HYDRATION RULE (production incident, 2026-08-28): the first render MUST
 * be deterministic. The landing page is statically prerendered, so any
 * clock text computed at render time is hours old by the time a browser
 * hydrates it — React 19 treats the text mismatch as a hydration failure
 * (#418) and the recovery cascade took the whole page down to the default
 * error screen on Vercel. Server and first client render therefore both
 * show the placeholder; the real clock arrives on the first tick,
 * scheduled immediately after mount. Do not reintroduce a `Date.now()`
 * read into the initial render.
 */
import { useEffect, useState } from "react";

export interface CountdownProps {
  /** Unix seconds, decimal string or number. */
  deadlineUnix: string | number;
  /** Label above the clock ("Entries close", "Opens in"). */
  label?: string;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface Remaining {
  d: number;
  h: number;
  m: number;
  s: number;
}

function remaining(deadline: number, nowMs: number): Remaining {
  const total = Math.max(0, Math.floor(deadline - nowMs / 1000));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The deterministic pre-tick placeholder (same width class as the clock). */
const PLACEHOLDER = "--:--:--";

export function Countdown({ deadlineUnix, label, now = Date.now }: CountdownProps) {
  const deadline = Number(deadlineUnix);
  // null until the first client tick — see the hydration rule above.
  const [t, setT] = useState<Remaining | null>(null);

  useEffect(() => {
    const tick = () => setT(remaining(deadline, now()));
    // First tick right after mount (async, so hydration completes first),
    // then once a second.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [deadline, now]);

  const clock =
    t === null
      ? PLACEHOLDER
      : t.d > 0
        ? `${t.d}d ${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`
        : `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`;

  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <span className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">{label}</span>
      ) : null}
      <time className="tnum font-display text-[24px] leading-[30px] font-bold text-ink">
        {clock}
      </time>
    </div>
  );
}
