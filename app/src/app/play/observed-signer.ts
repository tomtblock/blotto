/*
 * A signer that reports when it has signed (founder 2026-09-16,
 * CHANGE-2026-09-16_ui-uplift.md §A8).
 *
 * The seal stage wants two facts the page never had: the message is signed
 * (the packet request — the Privy "Sign message" prompt) and the transaction
 * is signed (the money step). Both happen inside the entry path, which this
 * change does not touch. But the signer the entry path uses is handed to it
 * by play-client.tsx — so the observation lives HERE, on the object passed
 * in, and src/entry never learns anything changed.
 *
 * Delegation is by METHOD CALL on the original, never by spread: a wallet
 * adapter may be a class instance whose methods live on its prototype, and
 * a spread would drop them. `signMessage` stays absent when the source has
 * none, so an adapter that cannot sign messages still fails closed exactly
 * as before (services.ts checks for it). A rejection passes through
 * untouched — the observer reports only what resolved.
 */

import type { TxSigner } from '@/tx/types';

export type SignerEvent = 'message-signed' | 'transaction-signed';

export function observeSigner(signer: TxSigner, on: (event: SignerEvent) => void): TxSigner {
  const observed: TxSigner = {
    address: signer.address,
    kind: signer.kind,
    label: signer.label,
    signTransaction: async (transaction) => {
      const signed = await signer.signTransaction(transaction);
      on('transaction-signed');
      return signed;
    },
  };
  if (signer.signMessage) {
    observed.signMessage = async (message) => {
      const signature = await signer.signMessage!(message);
      on('message-signed');
      return signature;
    };
  }
  return observed;
}
