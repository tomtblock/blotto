'use client';

/*
 * The share affordance (v3 D3, R16): a link to the signed-in player's own
 * result card — the server-rendered OG image at /card/[pool]/[player].
 * Sharing changes nothing on-chain and carries no reward (any reward
 * attached to sharing is a PID §8.4 question); the prize intent is the
 * celebration-adjacent button this intent exists for.
 */

import { COPY } from '@/copy';
import { useAuth } from '@/wallet/auth-context';

export function ShareResult({
  pool,
  seatByPlayer,
  paidSeats,
}: {
  pool: string;
  seatByPlayer: Record<string, number>;
  paidSeats: number[];
}) {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const mySeat = wallet !== null && wallet in seatByPlayer ? seatByPlayer[wallet] : null;
  // The card exists for any entrant; surface the button once results are in.
  if (wallet === null || mySeat === null || paidSeats.length === 0) return null;

  return (
    <a
      href={`/card/${pool}/${wallet}`}
      target="_blank"
      rel="noreferrer"
      className="key-prize flex h-14 items-center justify-center rounded-full bg-prize font-display text-[18px] font-bold uppercase tracking-wide text-(--color-base) transition-colors hover:bg-prize-hot"
    >
      {COPY.share.button}
    </a>
  );
}
