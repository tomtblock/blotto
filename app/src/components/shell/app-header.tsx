"use client";

import Link from "next/link";
import { COPY } from "@/copy";
import { useAuth } from "@/wallet/auth-context";
import { useBalance } from "@/wallet/use-balance";
import { formatSolShort } from "@/data/format";
import { CopyableAddressPill } from "@/components/copyable-address";
import { NotificationsBell } from "./notifications";

/*
 * App header — wordmark + auth state. Signed out: a sign-in affordance
 * (brand, the D-08 hero path starts here). Signed in: the live balance of
 * the active wallet (tap → the wallet screen) beside the truncated address
 * as a tap-to-copy pill (house pattern — users tap the address expecting a
 * copy) + a disconnect affordance. Depends on useAuth only, never on the
 * provider SDK (D-08 swappability).
 *
 * The balance is new on 2026-09-08: until then nothing in the product ever
 * showed a player what they held, and a winner had no way to confirm a prize
 * had arrived. It reads through `useBalance`, a bigint end to end.
 */

function BalancePill({ wallet }: { wallet: string }) {
  const { data, isError } = useBalance(wallet);
  const figure = data !== undefined ? formatSolShort(data) : isError ? "–" : "…";
  return (
    <Link
      href="/wallet"
      data-testid="header-balance"
      title={COPY.wallet.title}
      className="tnum rounded-full border border-line px-3 py-1.5 font-mono text-xs text-ink hover:border-brand"
    >
      ◎ {figure}
    </Link>
  );
}

export function AppHeader() {
  const { status, walletAddress, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-overlay bg-base/90 backdrop-blur-md">
      {/* Founder 2026-09-16: on a wide screen the wordmark lines up with the
          landing column (max-w-5xl) instead of floating in a phone-width box. */}
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4 lg:max-w-5xl lg:px-6">
        <Link
          href="/"
          className="font-display text-[17px] font-extrabold tracking-[0.06em] text-ink uppercase"
        >
          {COPY.shell.title}
        </Link>

        {status === "initializing" ? (
          // Reserve the slot so the header doesn't jump when auth resolves.
          <span className="h-8 w-20 rounded-full bg-raised" aria-hidden />
        ) : status === "signed-in" && walletAddress ? (
          <span className="flex items-center gap-2">
            <NotificationsBell />
            <BalancePill wallet={walletAddress} />
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
            className="rounded-full bg-brand px-4 py-1.5 font-mono text-xs font-semibold tracking-[0.08em] text-(--color-base) uppercase"
          >
            sign in
          </Link>
        )}
      </div>
    </header>
  );
}
