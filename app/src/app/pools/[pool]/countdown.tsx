'use client';

/* The 72h fill countdown — correct across refresh because it derives from
 * the ON-CHAIN deadline every render (roadmap 3.2's gate). */
import { useEffect, useState } from 'react';

export function Countdown({ deadlineUnix }: { deadlineUnix: string }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Number(deadlineUnix) - now);
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return (
    <div className="mt-1 font-mono text-xl tabular-nums" aria-live="polite">
      {h}h {String(m).padStart(2, '0')}m {String(s).padStart(2, '0')}s
    </div>
  );
}
