"use client";

import Link from "next/link";
import { useAuth } from "@/wallet/auth-context";
import { CopyableAddressPill } from "@/components/copyable-address";

/*
 * App header — wordmark + auth state. Signed out: a sign-in affordance
 * (brand, the D-08 hero path starts here). Signed in: the truncated wallet
 * address as a tap-to-copy pill (house pattern — users tap the address
 * expecting a copy; profile lives in the tab bar) + a disconnect
 * affordance. Depends on useAuth only, never on the provider SDK (D-08
 * swappability).
 */

export function AppHeader() {
  const { status, walletAddress, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-overlay bg-base/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
        {/* TODO_COPY(app-header.wordmark): the product wordmark. Placeholder
            until the Phase 3 language and brand pass (PID §10, C12). */}
        <Link href="/" className="font-display text-sm font-extrabold">
          TODO_COPY<span className="text-brand">(app-header.wordmark)</span>
        </Link>

        {status === "initializing" ? (
          // Reserve the slot so the header doesn't jump when auth resolves.
          <span className="h-8 w-20 rounded-full bg-raised" aria-hidden />
        ) : status === "signed-in" && walletAddress ? (
          <span className="flex items-center gap-2">
            <CopyableAddressPill value={walletAddress} />
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-full px-2 py-1.5 font-mono text-[10px] tracking-[0.12em] text-ink-muted uppercase hover:text-ink"
            >
              disconnect
            </button>
          </span>
        ) : (
          <Link
            href="/signin"
            className="rounded-full bg-brand px-4 py-1.5 font-mono text-xs font-medium tracking-[0.08em] text-ink uppercase"
          >
            sign in
          </Link>
        )}
      </div>
    </header>
  );
}
