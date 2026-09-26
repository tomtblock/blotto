# CHANGE — 2026-09-24: the sign-in surface reviewed against a real browser, and Apple removed

The founder asked for every sign-in option to be reviewed and ratified. **Ratification was
refused: two of the five did not work.** This records what was found, what was fixed, and the one
thing that cannot be fixed from this repository.

Method: a real Chromium browser against the live deployment, each option followed through to the
provider's own door. No credential was entered anywhere, and nothing was created in the Privy
account — the one probe that needed a wallet used a throwaway key and declined at the signature,
so the sequence stopped before `loginWithSiws`.

---

## 1. What the review found

| Option | Verdict | Evidence |
|---|---|---|
| Continue with Google | **Works** | Reached Google's own sign-in page with a live client id; no failed request |
| Continue with Apple | **Never worked** | Privy's own API: `403 {"error":"Login with Apple not allowed","code":"disallowed_login_method"}` |
| Continue with X | **Unproven** | Reached `x.com/i/oauth2/authorize`, which answered `403`. Indistinguishable from X refusing this datacentre, so it is NOT reported as a defect |
| Phantom · Solflare · Backpack · WalletConnect | **Offered correctly** | With no extension present each offered install-and-wait, which is the right behaviour; `standard-wallets.test.ts` + `privy-chain.test.ts` 14 green |

Three findings came out of it. Two are the founder's, one was ours.

---

## 2. Apple: removed, not enabled (founder, 2026-09-24)

It had never worked. The application asked for Apple, the Privy dashboard refused it, and — the
worse half — **the refusal reached the player as nothing at all**: the modal sat there showing the
Apple button while `useLogin`'s `onError` never fired, because the provider handles that failure
inside its own modal. A player pressed a button that did nothing, indefinitely.

That is the same failure CLASS as the incident recorded in `privy-bridge.tsx` for 2026-09-08 —
"every sign-in failure was dispatched into an empty listener list and vanished" — surviving the
handler added then, by a route that handler cannot see.

The founder chose removal over enabling it. **It is removed in four places, and that is the
point:**

| Where | Why it is not enough on its own |
|---|---|
| `wallet/types.ts` — `SocialProvider` loses `"apple"` | The type is the enforcement: a provider the application cannot name is one it cannot offer again from a second surface |
| `privy-bridge.tsx` — `loginMethods` loses `"apple"` | This is what the PROVIDER'S OWN MODAL offers. A page that merely stopped drawing its button would still hand a player an Apple row the moment any other path opened that modal |
| `signin/signin-client.tsx` — the button | What a player sees |
| `copy/index.ts`, `wallet-icons.tsx` | The string and the mark, removed rather than left as dead weight |

The dead `user?.apple?.email` fallback went with it: provably dead, not merely unused, because the
provider refused every Apple sign-in, so no account in this application can carry one.

**This diverges from D-08**, which named three socials. Recorded here rather than left in a diff.

The icon row is now single-column: one tile in a two-column grid renders at half width. If a second
social ever returns, take it back to two.

---

## 3. Phantom: the cause, and why no code change can fix it

The founder's error, in Phantom's own words:

> The wallet signed in, but the sign-in could not be completed. The app's signature request cannot
> be shown as the chain ID does not match the provided chain ID for verification.

A fake wallet-standard wallet was registered in the live page to capture the message Privy asks a
wallet to sign. **This is the message, verbatim:**

```
blotto-jade.vercel.app wants you to sign in with your Solana account:
93czHSVPyYGeWDqnt1x8d65MrZeKdtmJTwMK9kKQhn15

You are proving you own 93czHSVPyYGeWDqnt1x8d65MrZeKdtmJTwMK9kKQhn15.

URI: https://blotto-jade.vercel.app
Version: 1
Chain ID: mainnet          ← this line
Nonce: 723138d9cca57aa77b6c160319e8d8fa27327fe894cc2cf3d6fc4a65fc3fa986
Issued At: 2026-09-24T16:40:56.115Z
Resources:
- https://privy.io
```

**`Chain ID: mainnet`.** Every part of this application is devnet — `SOLANA_CHAIN`, the RPC
configuration, the program, the settlement daemon. Phantom compares the field against the chain it
is connected on, finds a mismatch, and refuses to display the request. That is exactly the error,
and it is not a defect in this repository.

**No code change can correct it.** `generateSiwsMessage` takes one parameter:

```ts
generateSiwsMessage: ({ address }: { address: string }) => Promise<string>;
```

There is no chain argument, checked twice against the installed SDK's own type declarations. The
message is composed by Privy's server from the Privy application's configured Solana chain, so the
remedy is in the Privy dashboard and nowhere else. The `defaultChain` options that do exist in that
SDK belong to its EVM connector manager, not to SIWS.

This is worth keeping in mind beyond today: **the dashboard holds settings this repository declares
but cannot enforce.** `SOLANA_RPCS_CONFIG` declares devnet and only devnet, and it did not stop the
provider issuing a mainnet sign-in message.

---

## 4. Google: the consent screen is not ours

Google's own consent screen reads:

```
App name:      Privy Auth
Support email: henri@privy.io
```

A player paying to enter a tournament is asked to trust an application named "Privy Auth" belonging
to an address at privy.io. Privy supports supplying your own Google credentials so that screen
carries the product's name instead. Not a defect and not changed here — a founder decision, recorded
so it is not discovered by a player first.

---

## 5. Verification

```
ten repo gates            all clean
app     typecheck clean · lint clean · 66 files / 553 tests passed
live    every option driven in a real browser (§1)
```

---

## 6. Founder actions

1. **The Privy dashboard's Solana chain → devnet.** This is what unblocks Phantom, Solflare,
   Backpack and every other wallet sign-in. Nothing in this repository can do it.
2. **Decide on the Google consent screen** (§4): supply our own Google credentials to Privy, or
   accept that the screen says Privy Auth.
3. Once both are settled, this review should be **re-run against `blotto.gg` itself** rather than
   the Vercel alias. The alias was used because the pre-launch gate needs a cookie; sign-in
   providers can be configured per domain, so the ratification is not complete until it passes on
   the real one.
