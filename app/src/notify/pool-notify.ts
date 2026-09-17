/*
 * The one-message opt-in (founder 2026-09-17, CHANGE-2026-09-16_ui-uplift.md
 * §E): "keep me updated when this pool ends". A wallet-signed, PER-POOL
 * consent that carries the address the one message goes to.
 *
 * This is v2 of the notify message. v1 (backend/packet/src/notify.ts, cut
 * from the app by D-E11 on 2026-09-13) recorded a per-wallet yes/no with no
 * address and no pool, on the assumption the sign-in provider would supply
 * the address at send time — and nothing ever sent. v2 makes the consent
 * complete on its own: the pool, the address, the wallet's signature over
 * all three and a timestamp, verified by the entry service before anything
 * is stored (backend/packet/src/notify-pool.ts), and sent by its dispatcher
 * when the pool reaches a terminal state. The address is deleted there the
 * moment the message goes.
 *
 * Pure over fetch and the signer, like entry/attestation.ts, so the shape
 * is tested without a browser.
 */

export const NOTIFY_POOL_VERSION = 'v2';

/** Canonical signed message — the same bytes the service verifies. */
export function notifyPoolMessage(wallet: string, pool: string, email: string, atUnix: bigint): Uint8Array {
  return new TextEncoder().encode(
    `blotto-cup notify ${NOTIFY_POOL_VERSION}\nwallet: ${wallet}\npool: ${pool}\nemail: ${email}\nat: ${atUnix}`
  );
}

/** Enough shape to refuse a typo before a wallet prompt; the service checks again. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function looksLikeEmail(value: string): boolean {
  const s = value.trim();
  return s.length <= 254 && EMAIL_SHAPE.test(s);
}

export interface PoolNotifySigner {
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * ok — recorded. refused — the service said no (a bad address, a bad
 * signature, a stale clock). unsigned — no signer able to sign a message, or
 * the player declined the prompt. unavailable — the service could not be
 * reached or answered something else; try again later.
 */
export type PoolNotifyOutcome = 'ok' | 'refused' | 'unsigned' | 'unavailable';

export async function submitPoolNotify(
  apiBase: string | undefined,
  signer: PoolNotifySigner | undefined,
  wallet: string,
  pool: string,
  email: string,
  fetchImpl: typeof fetch = fetch,
  nowUnix: () => bigint = () => BigInt(Math.floor(Date.now() / 1000))
): Promise<PoolNotifyOutcome> {
  if (!apiBase || !signer?.signMessage) return 'unsigned';
  const address = email.trim();
  if (!looksLikeEmail(address)) return 'refused';
  const atUnix = nowUnix();
  let signature: Uint8Array;
  try {
    signature = await signer.signMessage(notifyPoolMessage(wallet, pool, address, atUnix));
  } catch {
    return 'unsigned';
  }
  try {
    const res = await fetchImpl(`${apiBase}/notify/pool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        wallet,
        pool,
        email: address,
        atUnix: String(atUnix),
        signature: Buffer.from(signature).toString('base64'),
      }),
    });
    if (res.status === 204) return 'ok';
    if (res.status === 400 || res.status === 403) return 'refused';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * What the entry service can deliver: its `/health` names the notify
 * version it serves (`notify: 'v2'`) once the dispatcher is deployed. The
 * sealed screen offers the opt-in only then — never a promise the backend
 * behind it cannot keep, which is the mistake D-E11 was the ruling on.
 */
export async function entryServiceNotifyVersion(
  apiBase: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  if (!apiBase) return null;
  try {
    const res = await fetchImpl(`${apiBase}/health`, { method: 'GET' });
    if (!res.ok) return null;
    const body = (await res.json()) as { notify?: unknown };
    return typeof body.notify === 'string' ? body.notify : null;
  } catch {
    return null;
  }
}
