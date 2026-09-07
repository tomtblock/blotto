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

/** Null when the service is not configured or unreachable — the page then
 * offers nothing rather than guessing. */
export async function fetchAppealPosition(
  apiBase: string | undefined,
  pool: string,
  player: string,
  fetchImpl: typeof fetch = fetch
): Promise<AppealPosition | null> {
  if (!apiBase) return null;
  try {
    const res = await fetchImpl(
      `${apiBase}/appeals?pool=${encodeURIComponent(pool)}&player=${encodeURIComponent(player)}`
    );
    if (!res.ok) return null;
    return (await res.json()) as AppealPosition;
  } catch {
    return null;
  }
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
