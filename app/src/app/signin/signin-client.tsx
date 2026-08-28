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

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { COPY } from "@/copy";
import { useAuth } from "@/wallet/auth-context";
import type { SocialProvider } from "@/wallet/types";
import { Button } from "@/components/ui/button";
import { CopyableAddressPill } from "@/components/copyable-address";
import { ErrorSurface } from "@/components/ui/error-surface";

const CONFIGURED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

const SOCIALS: Array<{ provider: SocialProvider; label: string }> = [
  { provider: "google", label: COPY.signin.google },
  { provider: "apple", label: COPY.signin.apple },
  { provider: "twitter", label: COPY.signin.twitter },
];

export function SignInClient() {
  const { status, walletAddress, signInWithSocial, connectWallet, lastAuthError } =
    useAuth();
  const router = useRouter();
  // Which button was pressed last, so the failure line names the provider
  // the player actually chose.
  const [attempted, setAttempted] = useState<string | null>(null);

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
  const disabled = busy || !CONFIGURED;

  return (
    <div className="flex flex-col gap-3 pt-1">
      <p className="mb-2 max-w-prose text-[15px] leading-6 text-ink-muted">
        {COPY.signin.subtitle}
      </p>

      {!CONFIGURED ? (
        <p className="mb-1 rounded-lg border border-line px-4 py-3 text-[13px] leading-5 text-ink-muted">
          {COPY.signin.unavailable}
        </p>
      ) : null}

      {/* A provider that is not enabled for this app — or a domain that is
          not allow-listed with the provider — fails inside the provider's
          own flow. The app says so, in place, instead of leaving a button
          that appears to do nothing. */}
      {lastAuthError ? (
        <ErrorSurface className="mb-1">{COPY.signin.failed(attempted ?? "Sign-in")}</ErrorSurface>
      ) : null}

      {SOCIALS.map(({ provider, label }) => (
        <Button
          key={provider}
          size="lg"
          disabled={disabled}
          onClick={() => {
            setAttempted(label.replace(/^Continue with /, ""));
            signInWithSocial(provider);
          }}
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

      <Button
        size="lg"
        intent="secondary"
        disabled={disabled}
        onClick={() => {
          setAttempted("Wallet");
          connectWallet();
        }}
      >
        {COPY.signin.wallet}
      </Button>
    </div>
  );
}
