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
import { migrateLegacyKey, opaqueKey } from '@/storage/opaque-key';

/** The pre-2026-09-16 latch named the pool it was paid in; carried once. */
const LEGACY_LATCH_PREFIX = 'blotto.confetti.';

export function PaidConfetti({ pool, paidPlayers }: { pool: string; paidPlayers: string[] }) {
  const auth = useAuth();
  const reduced = usePrefersReducedMotion();
  const [burst, setBurst] = useState(false);

  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const isPaid = wallet !== null && paidPlayers.includes(wallet);

  useEffect(() => {
    if (!isPaid || reduced) return;
    // Opaque since 2026-09-16 (storage/opaque-key.ts): the latch no longer
    // names the pool. No storage → no way to keep "once ever" → don't play.
    const key = opaqueKey('confetti', pool);
    if (key === null) return;
    migrateLegacyKey(`${LEGACY_LATCH_PREFIX}${pool}`, key);
    try {
      if (localStorage.getItem(key) === '1') return;
      localStorage.setItem(key, '1'); // latch BEFORE playing: replays lose
    } catch {
      return;
    }
    // Deferred a frame (lint: no sync setState in effects); the latch
    // above already holds, so a re-run can never double-fire.
    const raf = requestAnimationFrame(() => setBurst(true));
    return () => cancelAnimationFrame(raf);
  }, [isPaid, reduced, pool]);

  if (!burst) return null;
  return <ConfettiBurst onDone={() => setBurst(false)} />;
}
