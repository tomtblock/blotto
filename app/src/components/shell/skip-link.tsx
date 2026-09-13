/*
 * SkipLink (2026-09-13): the first focusable thing on every page. Invisible
 * until a keyboard reaches it, then a pill at the top-left that jumps past
 * the header to the page's <main id="main">. Standard, and until now absent.
 */
import { COPY } from "@/copy";

export function SkipLink() {
  return (
    <a
      href="#main"
      className={
        "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] " +
        "focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-[13px] " +
        "focus:font-semibold focus:text-(--color-base)"
      }
    >
      {COPY.shell.skipToContent}
    </a>
  );
}
