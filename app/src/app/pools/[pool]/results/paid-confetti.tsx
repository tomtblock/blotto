'use client';

/*
 * The confetti burst (master prompt D — Results): plays ONCE PER PAID
 * RESULT, EVER — a localStorage latch per pool guarantees a revisit never
 * replays it, and reduced motion never sees it. It fires only for the
 * signed-in player's own paid result, never for spectators. One second,
 * then gone from the DOM entirely.
 *
 * The burst itself is the shared <ConfettiBurst> (also the seventh-lock
 * crescendo in the battle run); this component owns only the latch.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/wallet/auth-context';
import { usePrefersReducedMotion } from '@/components/blot/springs';
import { ConfettiBurst } from '@/components/celebrate/confetti-burst';

const LATCH_PREFIX = 'blotto.confetti.';

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
    return () => cancelAnimationFrame(raf);
  }, [isPaid, reduced, pool]);

  if (!burst) return null;
  return <ConfettiBurst onDone={() => setBurst(false)} />;
}
