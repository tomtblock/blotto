'use client';

/*
 * The mobile wallet standard, registered on Android (2026-09-28, D-E18).
 *
 * A phone has no browser extension, so on the web the sign-in surface would
 * list nothing. `@solana-mobile/wallet-standard-mobile` registers a
 * wallet-standard wallet named "Mobile Wallet Adapter" that reaches
 * whichever MWA wallet app is installed (Phantom, Solflare, the Seeker's
 * Seed Vault Wallet …) through an Android intent. Because it registers into
 * the SAME registry standard-wallets.ts already reads, nothing downstream
 * changes: the sign-in page lists it as it lists Phantom on a desktop, and
 * the direct route (direct-sign-in.ts) signs in with it — through the
 * wallet's own sign-in, one wallet session, because every request to a
 * wallet APP is a session of its own and two in a row race (in-front.ts).
 *
 * THREE THINGS ARE DELIBERATE HERE.
 *
 *   1. Android only (channel.ts). On iOS and desktop the library's local
 *      transport has nothing to talk to; registering it would list a wallet
 *      that can never connect. The library is imported lazily inside the
 *      effect so a desktop first load never downloads it.
 *   2. The chain is SOLANA_CHAIN, the one build-time cluster
 *      (chain/cluster.ts). A devnet build asks a wallet for devnet and
 *      nothing else, which is the previews-never-mainnet rule applied to
 *      one more caller.
 *   3. Sign-only. The tx seam (tx/execute.ts) has the wallet SIGN and sends
 *      the transaction itself, with the pass asset's keypair partial-
 *      signing after the wallet — a founder-ruled order. The library exposes
 *      `solana:signTransaction` only when the wallet app advertises
 *      `sign_transactions` (read from its bundle: the feature set is built
 *      from the wallet's capabilities). A wallet that offers sign-AND-send
 *      alone can sign in but not enter; direct-session.tsx reports that
 *      limitation and the play page says so in words (D-E18 keeps the seam
 *      unchanged rather than reversing the signing order for such wallets).
 *
 * The library keeps its authorisation token under one localStorage key of
 * its own; docs/compliance/DATA-INVENTORY.md lists it.
 */

import { useEffect } from 'react';
import { COPY } from '@/copy';
import { SOLANA_CHAIN } from '@/chain/cluster';
import { channelOf, usesMobileWallet } from '@/channel/channel';

// Once per page, whatever re-renders the shell.
let registered = false;

export function MobileWalletAdapter() {
  useEffect(() => {
    if (registered) return;
    if (!usesMobileWallet(channelOf(navigator.userAgent))) return;
    registered = true;
    let cancelled = false;
    void import('@solana-mobile/wallet-standard-mobile').then((mwa) => {
      if (cancelled) return;
      mwa.registerMwa({
        appIdentity: {
          name: COPY.shell.title,
          uri: window.location.origin,
          // Relative to `uri`, per the MWA identity rules: the manifest's own
          // icon (app/manifest.ts), so the wallet's consent screen and the
          // home screen show the same mark.
          icon: 'icon.png',
        },
        authorizationCache: mwa.createDefaultAuthorizationCache(),
        chains: [SOLANA_CHAIN],
        chainSelector: mwa.createDefaultChainSelector(),
        onWalletNotFound: mwa.createDefaultWalletNotFoundHandler(),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
