# Wallet and sign-in — 2026-09-08

Branch `claude/wallet-and-signin`. Answers the founder's brief of 2026-09-08: Phantom as a
first-class sign-in option in the shape players know from other Solana products, in Blotto's
skin; the product as the place a player sees what they hold and what they have won,
whichever way they signed in; and the two exits for a player paid into a wallet the
provider made for them.

## What is built

- **Sign-in** (`app/src/app/signin/signin-client.tsx`): Google as the hero button, Apple and
  X as icon buttons, "or connect a wallet", then every Solana wallet registered in the
  browser as a `DETECTED` row carrying the wallet's own icon, and "More wallets" into the
  provider's list. A failed attempt is now SAID on the page (`Auth.lastError`, from the
  provider's `onError`, which was never wired before).
- **One-tap wallet sign-in** (`app/src/wallet/standard-wallets.ts`): wallet-standard connect →
  the provider's sign-in-with-Solana message → signed by the wallet → `loginWithSiws`. Kept
  out of the provider bridge so it is unit-tested with a fake wallet and so detection works
  before the provider SDK loads (and in preview builds with no credential).
- **The wallet screen** (`/wallet`, and the same card atop `/profile`;
  `app/src/components/wallet/wallet-card.tsx`): live balance (`use-balance.ts`, bigint end to
  end, bounded read), *Add SOL* straight onto the deposit-address screen, a devnet faucet
  link behind `NEXT_PUBLIC_DEVNET_FAUCET`, *Send SOL* on the entry tx seam
  (`app/src/tx/send-sol.ts`), *Move my wallet to Phantom* (the provider's key export), *Use a
  different wallet* (link, not a second identity), and a picker when more than one wallet is
  connected.
- **Header**: the active wallet's balance beside the address, linking to `/wallet`.
- **Play flow**: a signed-in wallet with no signer behind it now holds, then says so, instead
  of letting the ninety seconds run into a confirm that did nothing.

## Judgement calls (PHASE-N-REVIEW), for the founder

1. **Active-wallet default prefers an external wallet** when one is connected, because a
   Google sign-in only ever gains a second wallet by the player attaching it deliberately,
   and a Phantom sign-in has no embedded wallet at all. The picker switches back; the
   choice persists per user. Alternative: always the wallet that signed in.
2. **Every new player-facing sentence** (`COPY.signin.errors`, `COPY.wallet.*`,
   `COPY.gate.signer*`) ships as plain prose pending the founder's wording.
3. **Funding errors are logged, not surfaced**: telling a provider refusal apart from a
   deliberate exit needs the SDK's `onUserExited` callback, and the sentence is founder copy.
4. **Whether the provider's connector mirrors a wallet connected outside its modal** is
   unverified against a real extension; the bridge builds a signer from the wallet-standard
   features directly so the answer does not matter.
5. **Apple stays listed** in the provider config and on the page while the dashboard
   decision is open; removing it is one line in `SOCIALS`.

## Verification

- tsc, eslint (0 errors), 301 unit tests (45 files; new: `standard-wallets.test.ts`,
  `send-sol.test.ts`, `auth-state.test.ts` extended), the three gates, `next build`.
- Browser (Playwright, local build on 127.0.0.1, a fake wallet-standard wallet named
  Phantom injected): the page renders the intended shape; the fake wallet renders as
  "Phantom · DETECTED" with its data-URI icon **while the provider is still initialising**;
  `/wallet` renders its signed-out state. The provider never becomes ready in this
  container (its API is unreachable from the sandboxed browser: connection reset at the
  proxy), so the social buttons stay disabled here and no real login was completed — the
  one-tap sequence is proven in `standard-wallets.test.ts` with the provider's two calls
  faked, not in the browser.

## Not in this change

- The mainnet/devnet cluster switch (separate branch): `SOLANA_CHAIN`, the explorer link and
  the "receive" funding default are devnet today by construction.
- A fiat off-ramp: the installed provider ships none; "to my bank" is via an exchange.
