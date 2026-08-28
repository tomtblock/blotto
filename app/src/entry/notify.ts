/*
 * The client half of the email-notification opt-in (v3 D3): sign the
 * canonical message with the wallet and POST it to the entry service. The
 * message bytes come from the SAME module the server verifies with
 * (@blotto/packet/notify) — the two ends cannot drift.
 */

import { notifyMessage } from '@blotto/packet/notify';

export interface MessageSigner {
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Sign and submit the opt-in choice. Resolves true only when the service
 * stored it (204). False on any failure — missing signer, declined prompt,
 * network, refusal — the caller re-prompts rather than guessing.
 */
export async function submitNotifyPreference(
  apiBase: string | undefined,
  signer: MessageSigner | undefined,
  wallet: string,
  emailOptIn: boolean
): Promise<boolean> {
  if (!apiBase || !signer?.signMessage) return false;
  const atUnix = BigInt(Math.floor(Date.now() / 1000));
  let signature: Uint8Array;
  try {
    signature = await signer.signMessage(notifyMessage(wallet, emailOptIn, atUnix));
  } catch {
    return false;
  }
  try {
    const res = await fetch(`${apiBase}/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        wallet,
        emailOptIn,
        atUnix: atUnix.toString(),
        signature: btoa(String.fromCharCode(...signature)),
      }),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}
