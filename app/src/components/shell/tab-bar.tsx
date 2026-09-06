"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SHELL_TABS, isTabActive } from "./tab-nav";

/*
 * Bottom tab bar — the app's primary navigation (mobile-first, thumb reach).
 *
 * Carried from the predecessor repository. Its centre "hero" slot and the
 * three destinations it pointed at are gone; the layout mechanics, the token
 * discipline and the active-state wiring are what was worth keeping.
 *
 * The tab set is Play / Pools / Profile — see tab-nav.ts; labels come from
 * the copy module (v3 D-UI-3).
 *
 * Colors are token references only (the reservation rule): ink / ink-muted for
 * tab states. No transition animations on tab switches — page transitions are
 * deliberately instant.
 */

const iconProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/*
 * Icons keyed by tab id — Blot world (v4), replacing the predecessor
 * placeholders. Same 24-grid, 1.8 stroke, round caps as the rest of the
 * icon set.
 *
 * play    — the pentagon: the Blot's body, i.e. the allocation itself.
 * pools   — the seat ring: six seats around a table, the pool motif.
 * profile — a person; kept, it was never a placeholder problem.
 *
 * PHASE-4-REVIEW: drawn in-repo because the Figma icon library page
 * (01 · Icons & Components) is not exposed under the shared file key —
 * only the brand-guide page is. If that page turns up, these swap for
 * the exported icon/nav/* glyphs; the geometry contract stays the same.
 */
const TAB_ICONS: Record<string, ReactNode> = {
  play: (
    <svg {...iconProps} aria-hidden>
      <path d="M12 3.8 20 9.9l-3.1 9.3H7.1L4 9.9 12 3.8Z" />
    </svg>
  ),
  pools: (
    <svg {...iconProps} aria-hidden>
      <circle cx="12" cy="4.6" r="1.7" />
      <circle cx="18.5" cy="8.3" r="1.7" />
      <circle cx="18.5" cy="15.7" r="1.7" />
      <circle cx="12" cy="19.4" r="1.7" />
      <circle cx="5.5" cy="15.7" r="1.7" />
      <circle cx="5.5" cy="8.3" r="1.7" />
    </svg>
  ),
  profile: (
    <svg {...iconProps} aria-hidden>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c1.4-3.2 4-4.8 7-4.8s5.6 1.6 7 4.8" />
    </svg>
  ),
};

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-overlay bg-raised/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <div className="mx-auto grid h-16 max-w-md grid-cols-3">
        {SHELL_TABS.map((tab) => {
          const active = isTabActive(pathname, tab);
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-1 ${
                active ? "text-ink" : "text-ink-muted"
              }`}
            >
              {TAB_ICONS[tab.id]}
              <span className="font-mono text-[9px] leading-none tracking-[0.16em] uppercase">
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
