/*
 * BackLink (2026-09-13). The informational pages — rules, fair play, verify,
 * custody, a pool, its results — are leaves reached by a link, and until now
 * had no way back but the browser button: the tab bar jumps to a tab root,
 * which loses where the player came from. This is the one back affordance,
 * extracted from the link idiom that was copied twenty-one times across the
 * app, and given the keyboard focus ring those copies never had.
 */
import Link from "next/link";
import type { ReactNode } from "react";

export function BackLink({
  href,
  children,
  className = "",
  tone = "ink",
}: {
  href: string;
  children: ReactNode;
  className?: string;
  /** `ink` on a plum surface; `berry` on the pink field (founder 2026-09-16). */
  tone?: "ink" | "berry";
}) {
  const colour =
    tone === "berry"
      ? "text-brand-berry hover:text-brand-deep-magenta"
      : "text-ink-muted hover:text-ink";
  return (
    <Link
      href={href}
      className={
        "inline-flex items-center gap-1.5 rounded-full py-1 pr-2 text-[13px] transition-colors " +
        colour +
        " " +
        className
      }
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
        <path
          d="M12 4 6 10l6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </Link>
  );
}
