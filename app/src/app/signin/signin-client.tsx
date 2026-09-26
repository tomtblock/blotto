"use client";

/*
 * The sign-in surface (D-08), in the shape players already know from other
 * Solana products: one hero social button, the other socials as icon
 * buttons, then "or connect a wallet" and the wallets this browser actually
 * has, each marked DETECTED, with a door to everything else. Depends on
 * useAuth only, never on the provider SDK.
 *
 * A detected wallet signs in with ONE tap (the seam's `signInWithWallet`:
 * wallet-standard connect → sign-in-with-Solana → done, no provider chrome).
 * The social buttons and "More wallets" open the provider's own flow,
 * filtered to that one method.
 *
 * Once auth lands in "signed-in", this page's job is done: it forwards to
 * the arena. Builds without credentials (previews, local dev) render the
 * buttons disabled with an explicit note instead of silently doing nothing —
 * and since 2026-09-08 a failed attempt SAYS so, from `lastError`, where
 * before the page had no channel to hear about one at all.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { COPY } from "@/copy";
import { useAuth } from "@/wallet/auth-context";
import type { SocialProvider } from "@/wallet/types";
import { GoogleMark, WalletGlyph, XMark } from "@/wallet/wallet-icons";
import { CopyableAddressPill } from "@/components/copyable-address";
import { signInDestination } from "./return-to";

/*
 * Whether sign-in works is asked of the AUTH PROVIDER, not of the
 * environment: `unavailable` is the provider's word, never a read of
 * NEXT_PUBLIC_PRIVY_APP_ID here (that read was true for any non-empty
 * string, so a malformed ID rendered live buttons that did nothing).
 */

/**
 * The socials that sit under the Google hero.
 *
 * APPLE WAS REMOVED HERE on 2026-09-24 (founder), and from `SocialProvider`
 * so it cannot be offered from another surface by accident. The review that
 * prompted it drove this page in a browser: Privy's own API refuses Apple
 * with `403 disallowed_login_method`, and the failure reached the player as
 * nothing at all — the modal simply sat there.
 *
 * The grid is single-column because one tile in a two-column grid renders at
 * half width. If a second social ever returns, take it back to two.
 */
const ICON_SOCIALS: Array<{ provider: SocialProvider; label: string; Mark: typeof XMark }> = [
  { provider: "twitter", label: COPY.signin.twitter, Mark: XMark },
];

/**
 * EXTERNAL WALLET SIGN-IN IS HIDDEN (founder, 2026-09-24). Hidden, not
 * removed: this is a vendor outage, not a product decision, and the day it
 * lifts we want the buttons back without rebuilding them.
 *
 * WHY. Privy's sign-in-with-Solana always states `Chain ID: mainnet`, for an
 * application that is devnet end to end. Phantom compares that line and
 * refuses to display the request — "the chain ID does not match the provided
 * chain ID for verification" — and Privy's own login modal fails the same
 * way, so both routes are shut. Privy support have confirmed it in writing:
 * `generateSiwsMessage` takes only an address, and SIWS "messages default to
 * mainnet regardless of your RPC configuration".
 *
 * Nothing in this repository can correct it; the full diagnosis, the captured
 * message and the costed alternatives are in
 * `docs/guide/HOSTING.md`.
 *
 * TO RESTORE: set this to true. The handlers, the detection and the whole
 * `siwsSignIn` sequence are untouched and still under test — only the buttons
 * are withheld. Restore it once Privy emits a devnet chain id, and re-run the
 * sign-in review before saying it works.
 */
const EXTERNAL_WALLET_SIGNIN_ENABLED = false;

const ROW =
  "flex h-14 w-full items-center gap-3 rounded-xl border border-line bg-raised px-4 text-left " +
  "text-[15px] text-ink transition-colors hover:border-brand focus-visible:ring-2 " +
  "focus-visible:ring-brand-cream focus-visible:outline-none disabled:cursor-not-allowed " +
  "disabled:opacity-50 disabled:hover:border-line";

export function SignInClient() {
  const {
    status,
    walletAddress,
    unavailable,
    detectedWallets,
    lastError,
    clearError,
    signInWithSocial,
    signInWithWallet,
    connectWallet,
  } = useAuth();
  const router = useRouter();
  const [busyWallet, setBusyWallet] = useState<string | null>(null);

  /*
   * D-17 (audit 2026-09-11): where to go afterwards. This used to be a
   * hard-coded "/play", so a player who arrived from a pool —
   * `/play?pool=<address>` → "Sign in to enter" → here — was forwarded to
   * `/play` with no pool and met "No pool selected". The tournament they
   * had chosen was gone with no explanation. The destination now travels
   * in the link and is validated (`return-to.ts`): an unvalidated `?next=`
   * on a sign-in page is an open redirect.
   */
  const params = useSearchParams();
  const destination = signInDestination(params.get("next"));

  useEffect(() => {
    if (status === "signed-in") router.replace(destination);
  }, [status, router, destination]);

  if (status === "signed-in" && walletAddress) {
    // Visible for the moment before the redirect lands (and if the user
    // navigates back here deliberately while signed in).
    return (
      <div className="flex flex-col items-start gap-3 pt-2">
        <p className="text-[15px] text-ink-muted">{COPY.signin.signedInAs}</p>
        <CopyableAddressPill value={walletAddress} />
        <Link href={destination} className="text-[15px] text-brand underline underline-offset-2">
          {COPY.signin.continueLink}
        </Link>
      </div>
    );
  }

  const initializing = status === "initializing";
  const disabled = initializing || unavailable !== undefined;
  const errorText = lastError
    ? (COPY.signin.errors[lastError.code] ?? COPY.signin.errorFallback)
    : null;

  const onWallet = async (id: string) => {
    clearError();
    setBusyWallet(id);
    try {
      await signInWithWallet(id);
    } finally {
      setBusyWallet(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-1">
      <p className="mb-1 max-w-prose text-[15px] leading-6 text-ink-muted">
        {COPY.signin.subtitle}
      </p>

      {unavailable ? (
        <p
          data-testid="signin-unavailable"
          className="mb-1 rounded-lg border border-line px-4 py-3 text-[13px] leading-5 text-ink-muted"
        >
          {unavailable === "absent"
            ? COPY.signin.unavailable
            : unavailable === "rejected"
              ? COPY.signin.unavailableRejected
              : COPY.signin.unavailableUnreachable}
        </p>
      ) : initializing ? (
        // A row of disabled buttons with no explanation was the dead end the
        // audit named (C-03); the shell now times this state out, and until
        // it does the page says what it is waiting for.
        <p role="status" className="mb-1 text-[13px] leading-5 text-ink-muted">
          {COPY.signin.initializing}
        </p>
      ) : null}

      {errorText ? (
        <div
          role="status"
          data-testid="signin-error"
          className="mb-1 rounded-lg border border-brand/50 bg-brand/10 px-4 py-3 text-[13px] leading-5 text-ink"
        >
          <p>{errorText}</p>
          {lastError?.detail ? (
            <p className="mt-1 font-mono text-[11px] leading-4 break-words text-ink-muted">
              {lastError.detail}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Hero: Google on a light ground, the mark in its own colours. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          clearError();
          signInWithSocial("google");
        }}
        data-testid="signin-google"
        className={
          "key-cream flex h-14 w-full items-center justify-center gap-3 rounded-full " +
          "text-[17px] font-semibold " +
          "focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none " +
          "disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        <GoogleMark size={22} />
        {COPY.signin.google}
      </button>

      <div className="grid grid-cols-1 gap-3">
        {ICON_SOCIALS.map(({ provider, label, Mark }) => (
          <button
            key={provider}
            type="button"
            disabled={disabled}
            aria-label={label}
            title={label}
            data-testid={`signin-${provider}`}
            onClick={() => {
              clearError();
              signInWithSocial(provider);
            }}
            className={
              "key-cream flex h-14 items-center justify-center rounded-full " +
              "focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none " +
              "disabled:cursor-not-allowed disabled:opacity-50"
            }
          >
            <Mark size={22} />
          </button>
        ))}
      </div>

      {EXTERNAL_WALLET_SIGNIN_ENABLED ? (
        <>
        <div className="my-2 flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          <span className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">
            {COPY.signin.walletDivider}
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <ul className="flex flex-col gap-2" data-testid="detected-wallets">
          {detectedWallets.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                disabled={disabled || busyWallet !== null}
                onClick={() => void onWallet(w.id)}
                data-testid={`wallet-${w.id}`}
                className={ROW}
              >
                {/* The wallet's own icon, a data URI it registered itself. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.icon} alt="" width={28} height={28} className="rounded-lg" />
                <span className="font-medium">{w.name}</span>
                <span className="ml-auto rounded-full border border-(--color-ok)/40 bg-(--color-ok)/10 px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] text-(--color-ok) uppercase">
                  {busyWallet === w.id ? "…" : COPY.signin.detected}
                </span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                clearError();
                connectWallet();
              }}
              data-testid="wallet-more"
              className={ROW}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-overlay text-ink-muted">
                <WalletGlyph size={18} />
              </span>
              <span className="flex flex-col">
                <span className="font-medium">{COPY.signin.moreWallets}</span>
                <span className="text-[12px] text-ink-muted">{COPY.signin.moreWalletsNote}</span>
              </span>
              <span className="ml-auto text-ink-muted" aria-hidden>
                ›
              </span>
            </button>
          </li>
        </ul>
        </>
      ) : null}

      <p className="mt-3 text-[12px] leading-5 text-ink-muted">{COPY.pool.ageTerritoryNote}</p>
    </div>
  );
}
