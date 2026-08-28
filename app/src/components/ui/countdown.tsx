"use client";

/*
 * Countdown (D1): visible, tabular, and CALM — a fixture clock, not a
 * pressure device. It never changes colour as time runs down, never pulses,
 * and never sits adjacent to a payment button (D3's do-not-build list bans
 * countdown pressure on pay); the per-screen session timer in the
 * allocation flow is a separate component with its own ratified rules (R9).
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

function remaining(deadline: number, nowMs: number): { d: number; h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(deadline - nowMs / 1000));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function Countdown({ deadlineUnix, label, now = Date.now }: CountdownProps) {
  const deadline = Number(deadlineUnix);
  const [t, setT] = useState(() => remaining(deadline, now()));

  useEffect(() => {
    const id = setInterval(() => setT(remaining(deadline, now())), 1000);
    return () => clearInterval(id);
  }, [deadline, now]);

  const clock =
    t.d > 0 ? `${t.d}d ${pad(t.h)}:${pad(t.m)}:${pad(t.s)}` : `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`;

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
