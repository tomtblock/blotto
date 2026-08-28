import { describe, expect, it } from "vitest";
import { SHELL_TABS, isTabActive, type TabDef } from "./tab-nav";

/*
 * Pins the shell's active-state logic. Pure, no DOM — the rendering itself is
 * viewport-visual and belongs to a browser pass, not here.
 *
 * Carried from the predecessor repository, retargeted at the placeholder tab set.
 * The three destinations are NOT ratified (see tab-nav.ts); what this file pins is
 * the prefix-matching behaviour, which is what actually has edge cases — exact
 * matching at root, sub-path matching elsewhere, and the trailing-slash rule that
 * stops one route spuriously highlighting another's tab.
 */

function tab(id: TabDef["id"]): TabDef {
  const found = SHELL_TABS.find((t) => t.id === id);
  if (!found) throw new Error(`no tab ${id}`);
  return found;
}

describe("SHELL_TABS", () => {
  it("has three tabs, in order", () => {
    expect(SHELL_TABS.map((t) => t.id)).toEqual(["play", "pools", "profile"]);
  });

  it("routes each tab at its own path", () => {
    expect(tab("play").href).toBe("/");
    expect(tab("pools").href).toBe("/pools");
    expect(tab("profile").href).toBe("/profile");
  });

  it("carries real copy from the copy module — no placeholder survives (v3 D-UI-3)", () => {
    for (const t of SHELL_TABS) {
      expect(t.label, `${t.id} label`).not.toContain("TODO_COPY");
      expect(t.label.length, `${t.id} label`).toBeGreaterThan(0);
    }
  });
});

describe("isTabActive", () => {
  it("matches the root tab EXACTLY, not as a prefix of everything", () => {
    const play = tab("play");
    expect(isTabActive("/", play)).toBe(true);
    expect(isTabActive("/pools", play)).toBe(false);
    expect(isTabActive("/profile", play)).toBe(false);
  });

  it("matches a non-root tab on its own path and its sub-paths", () => {
    const profile = tab("profile");
    expect(isTabActive("/profile", profile)).toBe(true);
    expect(isTabActive("/profile/anything", profile)).toBe(true);
    expect(isTabActive("/", profile)).toBe(false);
    expect(isTabActive("/pools", profile)).toBe(false);
  });

  it("does not let one route highlight another tab by shared prefix", () => {
    // The sub-path match appends a trailing slash, so `/pools` must not match
    // `/poolside`. This is the case the predecessor's suite caught between its
    // own two similarly-prefixed routes, and it is worth keeping.
    expect(isTabActive("/poolside", tab("pools"))).toBe(false);
    expect(isTabActive("/pools/12", tab("pools"))).toBe(true);
  });

  it("activates exactly one tab per route", () => {
    for (const pathname of ["/", "/pools", "/pools/12", "/profile"]) {
      const active = SHELL_TABS.filter((t) => isTabActive(pathname, t));
      expect(active.length, `${pathname} matched ${active.map((t) => t.id).join(", ")}`).toBe(1);
    }
  });
});
