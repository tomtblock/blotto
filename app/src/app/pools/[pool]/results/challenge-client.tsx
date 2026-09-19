'use client';

/*
 * Challenging a decision on this pool (2026-09-19) — the inline form on the
 * results page, for the signed-in wallet whose own share was forfeited here.
 *
 * WHAT THIS REPLACES. Until today this was `appeal-client.tsx`, which lodged
 * an appeal against an upheld flag on the published promise that "the appeal
 * is decided by a different reviewer". That promise could not be kept: the
 * founder-owned reviewer registry holds one person, so no appeal could be
 * decided at all (audit O24). The named-reviewer apparatus is out of the
 * player-facing product — Blotto Cup is the reviewer of record, a human
 * still decides — and a challenge now goes through the complaints route,
 * which a person reads and answers within the published windows.
 *
 * The machinery behind the old route is untouched: the append-only decision
 * log, the canonical signed messages, the per-key budget and the
 * preconditions mirror all stay, and so does the seven-day window to lodge.
 * What changed is that the second REVIEWER is no longer named to a player,
 * and the form they use is the one on /complaints.
 *
 * Renders ONLY for the forfeited wallet, decided from ON-CHAIN data by the
 * caller before this is reached — so nothing here tells a spectator
 * anything. Nothing here can move a lamport.
 */

import { COPY } from '@/copy';
import { useAuth } from '@/wallet/auth-context';
import { ComplaintClient } from '@/complaints/complaint-client';

export function ChallengeClient({
  pool,
  forfeitedPlayers,
}: {
  pool: string;
  forfeitedPlayers: string[];
}) {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const mine = wallet !== null && forfeitedPlayers.includes(wallet);
  if (!mine) return null;

  return (
    <ComplaintClient
      initialCategory="decision"
      pool={pool}
      heading={COPY.results.challenge.title}
      lead={COPY.results.challenge.note}
    />
  );
}
