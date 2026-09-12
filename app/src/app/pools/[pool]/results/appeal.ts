/*
 * The client half of the appeal route (Phase 2 Stage E): read the entry's
 * appeal position from the review service's public log, and lodge an
 * appeal signed by the entry's own wallet. The message bytes come from the
 * SAME module the server verifies with (@blotto/detection/appeal-message),
 * exactly as the attestation and notify flows do — the two ends cannot
 * drift. No arithmetic, no ranks: this module carries text and signatures.
 */

import { canonicalAppealMessage } from '@blotto/detection/appeal-message';

export interface MessageSigner {
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
}

/** What GET /appeals answers — `appeals.ts::AppealState`, rows trimmed to
 * the fields the page shows. */
export interface AppealPosition {
  forfeit: { decidedAt: string; decidedBy: string; criterion: string } | null;
  lodged: { decidedAt: string } | null;
  decided: { decidedAt: string; action: 'appeal_upheld' | 'appeal_dismissed'; criterion: string } | null;
  lodgeUntil: string | null;
  decideBy: string | null;
}

/**
 * What reading the position can end as. Until 2026-09-12 all four failures
 * collapsed to `null`, and the panel then rendered nothing at all — no
 * heading, no note, no control — for a player whose share had just been
 * forfeited and whose only route out was this panel (audit 2026-09-11,
 * C-04). Each ending is now named so the page can say which it was, and
 * so an absent service is never mistaken for "nothing to appeal".
 */
export type AppealRead =
  | { kind: 'position'; position: AppealPosition }
  /** No review service in this build (NEXT_PUBLIC_REVIEW_API_URL unset). */
  | { kind: 'not_configured' }
  /** A service is configured but did not answer usably. */
  | { kind: 'unreachable'; reason: 'network' | 'status' | 'malformed' };

export async function fetchAppealPosition(
  apiBase: string | undefined,
  pool: string,
  player: string,
  fetchImpl: typeof fetch = fetch
): Promise<AppealRead> {
  if (!apiBase) return { kind: 'not_configured' };
  let res: Response;
  try {
    res = await fetchImpl(
      `${apiBase}/appeals?pool=${encodeURIComponent(pool)}&player=${encodeURIComponent(player)}`
    );
  } catch {
    return { kind: 'unreachable', reason: 'network' };
  }
  if (!res.ok) return { kind: 'unreachable', reason: 'status' };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: 'unreachable', reason: 'malformed' };
  }
  if (!isAppealPosition(body)) return { kind: 'unreachable', reason: 'malformed' };
  return { kind: 'position', position: body };
}

/** The shape check the old cast skipped: every field present, if null. */
function isAppealPosition(v: unknown): v is AppealPosition {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    'forfeit' in o && 'lodged' in o && 'decided' in o && 'lodgeUntil' in o && 'decideBy' in o
  );
}

export type LodgeOutcome =
  | 'lodged'
  | 'not_configured'
  | 'cannot_sign'
  | 'declined'
  | 'refused'
  | 'window_closed'
  | 'already_lodged'
  | 'nothing_to_appeal'
  | 'failed';

/**
 * Sign and submit the appeal. Every failure is named so the page can say
 * what happened; nothing is retried or guessed on the player's behalf.
 */
export async function lodgeAppeal(
  apiBase: string | undefined,
  signer: MessageSigner | undefined,
  pool: string,
  player: string,
  grounds: string,
  fetchImpl: typeof fetch = fetch
): Promise<LodgeOutcome> {
  if (!apiBase) return 'not_configured';
  if (!signer?.signMessage) return 'cannot_sign';
  const signedAt = new Date().toISOString();
  let signature: Uint8Array;
  try {
    signature = await signer.signMessage(canonicalAppealMessage({ pool, player, grounds, signedAt }));
  } catch {
    return 'declined';
  }
  try {
    const res = await fetchImpl(`${apiBase}/appeals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pool,
        player,
        grounds,
        signedAt,
        signature: btoa(String.fromCharCode(...signature)),
      }),
    });
    if (res.status === 204) return 'lodged';
    if (res.status === 401) return 'refused';
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === 'window_closed') return 'window_closed';
      if (body.error === 'already_lodged') return 'already_lodged';
      if (body.error === 'nothing_to_appeal') return 'nothing_to_appeal';
    }
    return 'failed';
  } catch {
    return 'failed';
  }
}
