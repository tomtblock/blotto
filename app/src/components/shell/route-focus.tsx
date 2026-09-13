"use client";

/*
 * RouteFocus (2026-09-13): after a client-side navigation, move focus to
 * the new page's <main id="main">. Without this, focus stays on the link
 * that was clicked (which may no longer exist) or falls to <body>, and a
 * screen reader hears nothing about the page having changed. The first
 * render is left alone — stealing focus on load is the wrong kind of help.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function RouteFocus() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const main = document.getElementById("main");
    if (!main) return;
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}
