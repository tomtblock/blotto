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
 * PHASE-0-REVIEW: the tab set is a PLACEHOLDER and Phase 3 owns the real
 * information architecture — see tab-nav.ts. Labels are TODO_COPY placeholders
 * awaiting the Phase 3 language audit (PID §10, C12).
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
 * Icons keyed by tab id.
 *
 * PHASE-0-REVIEW: these are placeholders carried across from the predecessor's
 * icon set and reassigned by position, not by meaning. Phase 3 picks real
 * iconography alongside the real information architecture.
 */
const TAB_ICONS: Record<string, ReactNode> = {
  play: (
    <svg {...iconProps} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15 9-1.4 4.6L9 15l1.4-4.6L15 9Z" />
    </svg>
  ),
  pools: (
    <svg {...iconProps} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17M3.5 12h17" />
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
