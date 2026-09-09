/*
 * Which connected wallet is THE ACTIVE one — the wallet that enters, is
 * paid, and whose balance the header shows. Pure, so the rule the founder
 * hit on 2026-09-09 is pinned by a unit test rather than by a browser run:
 *
 *   "When I try and sign in, it will connect me to a MetaMask wallet."
 *
 * A Solana-enabled MetaMask exposes an account to the page at the
 * wallet-standard level without the player choosing it in this product, and
 * the previous rule — "the first external signer" — took it ahead of the
 * Phantom wallet the player had signed in with. The attestation prompt then
 * went to MetaMask, which could not sign it, and the player could not enter.
 *
 * The rule now: the player's stored choice wins while that wallet is still
 * connected; otherwise a wallet the provider's own record LINKS to this
 * account — external before embedded, because a second linked wallet only
 * exists through the player's own action (a Phantom sign-in has no embedded
 * wallet; a Google sign-in gets one only by attaching it); otherwise the
 * first signer at all; otherwise the linked address even without a signer,
 * so the play flow can show "connecting your wallet" for it.
 */

export interface ActiveWalletCandidate {
  address: string;
  kind: "embedded" | "external";
}

export function pickActiveWallet<T extends ActiveWalletCandidate>(input: {
  /** Every wallet that can sign right now, in the adapter's order. */
  signers: readonly T[];
  /** Addresses the provider's record links to THIS account. */
  linked: ReadonlySet<string>;
  /** The player's persisted choice, if any. */
  chosen: string | null;
}): string | null {
  const { signers, linked, chosen } = input;
  if (chosen && signers.some((s) => s.address === chosen)) return chosen;
  const linkedSigners = signers.filter((s) => linked.has(s.address));
  const linkedExternal = linkedSigners.find((s) => s.kind === "external");
  if (linkedExternal) return linkedExternal.address;
  const linkedEmbedded = linkedSigners.find((s) => s.kind === "embedded");
  if (linkedEmbedded) return linkedEmbedded.address;
  if (signers[0]) return signers[0].address;
  const first = linked.values().next();
  return first.done ? null : first.value;
}
