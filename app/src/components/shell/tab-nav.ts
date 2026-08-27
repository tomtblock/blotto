/*
 * Shell bottom-nav model — the pure, presentation-free half of the tab bar, so
 * the active-state logic can be pinned by the node/no-DOM suite. The rendering
 * lives in `tab-bar.tsx`.
 *
 * Carried from the predecessor repository, with its three destinations replaced.
 *
 * PHASE-0-REVIEW: the tab set below is a PLACEHOLDER. Phase 0's brief says the
 * tabs become Play / Pools / Profile and that Phase 3 decides the real
 * information architecture. Nothing about this navigation has been ratified — the
 * routes it points at are the empty scaffolds in app/src/, and the labels are
 * lowercase placeholders awaiting the Phase 3 language audit (PID §10, C12) like
 * every other user-facing string in this directory.
 */

/** The three shell destinations. Placeholder — Phase 3 owns the real IA. */
export type ShellTabId = "play" | "pools" | "profile";

export interface TabDef {
  id: ShellTabId;
  /** The navigation target. */
  href: "/" | "/pools" | "/profile";
  /**
   * TODO_COPY(tab-nav): every label here is a placeholder. The Phase 3 language
   * audit fills them, against PID §8.7 — which forbids a specific vocabulary and
   * names the one to use instead (entry, pass, character, battle, stat,
   * allocation, tournament, prize pool, ranking).
   */
  label: string;
  /**
   * Pathname prefixes that mark this tab active. `"/"` matches the root EXACTLY;
   * any other prefix matches itself and its sub-paths.
   */
  activeOn: readonly string[];
}

export const SHELL_TABS: readonly TabDef[] = [
  { id: "play", href: "/", label: "TODO_COPY(tab-nav.play)", activeOn: ["/"] },
  {
    id: "pools",
    href: "/pools",
    label: "TODO_COPY(tab-nav.pools)",
    activeOn: ["/pools"],
  },
  {
    id: "profile",
    href: "/profile",
    label: "TODO_COPY(tab-nav.profile)",
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
