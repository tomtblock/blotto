"use client";

/*
 * The sign-in surface (D-08): social first — each provider button opens the
 * provider SDK's own flow via the app's Auth seam — with classic wallet
 * connect underneath. Depends on useAuth only, never on the provider SDK.
 *
 * Once auth lands in "signed-in", this page's job is done: it forwards to
 * the arena. Builds without credentials (previews, local dev) render the
 * buttons disabled with an explicit note instead of silently doing nothing.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { COPY } from "@/copy";
import { useAuth } from "@/wallet/auth-context";
import type { SocialProvider } from "@/wallet/types";
import { Button } from "@/components/ui/button";
import { CopyableAddressPill } from "@/components/copyable-address";

/*
 * Whether sign-in works is asked of the AUTH PROVIDER, not of the
 * environment. This read `Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID)`,
 * which is true for any non-empty string — so a malformed app ID rendered
 * these buttons ENABLED and clicking one did nothing at all, with no
 * explanation on screen. The provider is the only thing that knows whether
 * the SDK actually initialised, so it is the thing that is asked.
 */

const SOCIALS: Array<{ provider: SocialProvider; label: string }> = [
  { provider: "google", label: COPY.signin.google },
  { provider: "apple", label: COPY.signin.apple },
  { provider: "twitter", label: COPY.signin.twitter },
];

export function SignInClient() {
  const { status, walletAddress, signInWithSocial, connectWallet, unavailable } =
    useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-in") router.replace("/play");
  }, [status, router]);

  if (status === "signed-in" && walletAddress) {
    // Visible for the moment before the redirect lands (and if the user
    // navigates back here deliberately while signed in).
    return (
      <div className="flex flex-col items-start gap-3 pt-2">
        <p className="text-[15px] text-ink-muted">{COPY.signin.signedInAs}</p>
        <CopyableAddressPill value={walletAddress} />
        <Link href="/play" className="text-[15px] text-brand underline underline-offset-2">
          {COPY.signin.continueLink}
        </Link>
      </div>
    );
  }

  const busy = status === "initializing";
  const disabled = busy || unavailable !== undefined;

  return (
    <div className="flex flex-col gap-3 pt-1">
      <p className="mb-2 max-w-prose text-[15px] leading-6 text-ink-muted">
        {COPY.signin.subtitle}
      </p>

      {unavailable ? (
        <p className="mb-1 rounded-lg border border-line px-4 py-3 text-[13px] leading-5 text-ink-muted">
          {unavailable === "absent"
            ? COPY.signin.unavailable
            : COPY.signin.unavailableRejected}
        </p>
      ) : null}

      {SOCIALS.map(({ provider, label }) => (
        <Button
          key={provider}
          size="lg"
          disabled={disabled}
          onClick={() => signInWithSocial(provider)}
        >
          {label}
        </Button>
      ))}

      <div className="my-2 flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">
          {COPY.signin.walletDivider}
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button size="lg" intent="quiet" disabled={disabled} onClick={() => connectWallet()}>
        {COPY.signin.wallet}
      </Button>
    </div>
  );
}
