'use client';

/*
 * The confetti burst (master prompt D — Results): plays ONCE PER PAID
 * RESULT, EVER — a localStorage latch per pool guarantees a revisit never
 * replays it, and reduced motion never sees it. This is the single
 * celebratory flourish in the product beside the Blot's paid arm-raise;
 * it fires only for the signed-in player's own paid result, never for
 * spectators. One second, then gone from the DOM entirely.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/wallet/auth-context';
import { usePrefersReducedMotion } from '@/components/blot/springs';
import { palette } from '@/design/tokens';
import './confetti.css';

const LATCH_PREFIX = 'blotto.confetti.';
const PIECES = 26;
const COLOURS = [palette.brandYellow, palette.brandPink, palette.brandCream, palette.brandCoral];

export function PaidConfetti({ pool, paidPlayers }: { pool: string; paidPlayers: string[] }) {
  const auth = useAuth();
  const reduced = usePrefersReducedMotion();
  const [burst, setBurst] = useState(false);

  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const isPaid = wallet !== null && paidPlayers.includes(wallet);

  useEffect(() => {
    if (!isPaid || reduced) return;
    const key = `${LATCH_PREFIX}${pool}`;
    try {
      if (localStorage.getItem(key) === '1') return;
      localStorage.setItem(key, '1'); // latch BEFORE playing: replays lose
    } catch {
      return; // no storage → no way to keep "once ever" → don't play
    }
    // Deferred a frame (lint: no sync setState in effects); the latch
    // above already holds, so a re-run can never double-fire.
    const raf = requestAnimationFrame(() => setBurst(true));
    const t = setTimeout(() => setBurst(false), 1200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [isPaid, reduced, pool]);

  if (!burst) return null;
  return (
    <div className="confetti-field" aria-hidden="true">
      {Array.from({ length: PIECES }, (_, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${(i * 37) % 100}%`,
            background: COLOURS[i % COLOURS.length],
            animationDelay: `${(i % 7) * 40}ms`,
            transform: `rotate(${(i * 53) % 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}
