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
  /**
   * The SERVER's clock when the data was read (unix seconds; the read API's
   * `server_time`). Prompt v2 §F: every timer derives "now" from the server,
   * never from the device — the offset between server time and the device
   * clock is captured once, at mount, and applied to every tick. Absent
   * (fixtures, the gallery) the device clock is used as is.
   */
  serverTimeUnix?: string | number;
  /** Label above the clock ("Entries close", "Opens in"). */
  label?: string;
  /** Injectable clock for tests (device milliseconds). */
  now?: () => number;
  /** lg matches Stat's lg — the pool page's fixture numbers (2026-09-16). */
  size?: "md" | "lg";
  /**
   * `ink` (default) is the plum surfaces' cream. `inherit` takes the colour
   * of the text around it — the home card's numbers box (V3), which is cream
   * or plum with the card.
   */
  tone?: "ink" | "inherit";
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

export function Countdown({
  deadlineUnix,
  serverTimeUnix,
  label,
  now = Date.now,
  size = "md",
  tone = "ink",
}: CountdownProps) {
  const deadline = Number(deadlineUnix);
  const serverTime = serverTimeUnix === undefined ? null : Number(serverTimeUnix);
  // null until the first client tick — see the hydration rule above.
  const [t, setT] = useState<Remaining | null>(null);

  useEffect(() => {
    // Captured once per mount: how far the device clock sits from the
    // server's. The server time is a snapshot from the read, so it is only
    // ever slightly behind — the offset absorbs a wrong device clock, which
    // is the failure this exists for.
    const offsetMs = serverTime === null ? 0 : serverTime * 1000 - now();
    const tick = () => setT(remaining(deadline, now() + offsetMs));
    // First tick right after mount (async, so hydration completes first),
    // then once a second.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [deadline, serverTime, now]);

  const clock =
    t === null
      ? PLACEHOLDER
      : t.d > 0
        ? `${t.d}d ${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`
        : `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`;

  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <span
          className={`${size === "lg" ? "text-[13px]" : "text-[12px]"} uppercase tracking-[0.14em] ${
            tone === "inherit" ? "opacity-70" : "text-ink-muted"
          }`}
        >
          {label}
        </span>
      ) : null}
      <time
        className={
          `tnum font-display ${tone === "inherit" ? "" : "text-ink "}` +
          (size === "lg" ? "text-[40px] leading-[44px] font-extrabold" : "text-[24px] leading-[30px] font-bold")
        }
      >
        {clock}
      </time>
    </div>
  );
}
