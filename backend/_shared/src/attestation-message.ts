/**
 * The canonical attestation message (D-B4) — the exact bytes a wallet signs
 * to accept the terms + 18+ clickwrap. ONE definition, browser-bundleable:
 * the app builds it for signing, the packet service rebuilds it to verify.
 * Human-readable on purpose — wallets display the text, so the signer sees
 * exactly what is being attested. Any wording change is a new terms version
 * by definition.
 */
export function attestationMessage(wallet: string, termsVersion: number): Uint8Array {
  return new TextEncoder().encode(
    `Blotto Cup — attestation v${termsVersion}\n` +
      `I confirm I am 18 or older and accept the terms (version ${termsVersion}).\n` +
      `Wallet: ${wallet}\n`
  );
}
