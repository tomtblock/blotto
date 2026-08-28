/*
 * Shell bottom-nav model — the pure, presentation-free half of the tab bar, so
 * the active-state logic can be pinned by the node/no-DOM suite. The rendering
 * lives in `tab-bar.tsx`.
 *
 * The tab set is Play / Pools / Profile (Phase 0 brief, kept by the v3 D2
 * pass); labels come from the copy module like every user-facing string.
 */
import { COPY } from '@/copy';

/** The three shell destinations. */
export type ShellTabId = "play" | "pools" | "profile";

export interface TabDef {
  id: ShellTabId;
  /** The navigation target. */
  href: "/" | "/pools" | "/profile";
  /** Label from the copy module (PID §8.7 vocabulary, CI-enforced). */
  label: string;
  /**
   * Pathname prefixes that mark this tab active. `"/"` matches the root EXACTLY;
   * any other prefix matches itself and its sub-paths.
   */
  activeOn: readonly string[];
}

export const SHELL_TABS: readonly TabDef[] = [
  { id: "play", href: "/", label: COPY.shell.tabs.play, activeOn: ["/"] },
  {
    id: "pools",
    href: "/pools",
    label: COPY.shell.tabs.pools,
    activeOn: ["/pools"],
  },
  {
    id: "profile",
    href: "/profile",
    label: COPY.shell.tabs.profile,
    activeOn: ["/profile"],
  },
];

/** True when `pathname` falls under one of the tab's active prefixes. */
export function isTabActive(pathname: string, tab: TabDef): boolean {
  return tab.activeOn.some((prefix) =>
    prefix === "/"
      ? pathname === "/"
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
