/*
 * SiteFooter (2026-09-13): the one <footer> landmark. Until now the
 * "18+ only · not available in some territories" line floated as a
 * paragraph at the bottom of some pages and was absent from others, and
 * no page had a footer landmark for assistive tech to jump to. It carries
 * the line, and the pages a player is entitled to find from anywhere:
 * rules, fair play, verify, custody — and, since 2026-09-19, the terms, the
 * privacy notice and the complaints route.
 *
 * This is the ONE extension point for a site-wide page: the tab bar is
 * hard-typed to three routes by design (`tab-nav.ts`) and is not one.
 */
import Link from "next/link";
import { COPY } from "@/copy";

const LINKS = [
  { href: "/rules", label: COPY.rules.title },
  { href: "/fair-play", label: COPY.fairPlay.title },
  { href: "/terms", label: COPY.terms.title },
  { href: "/privacy", label: COPY.privacy.title },
  { href: "/complaints", label: COPY.complaints.title },
  { href: "/verify", label: COPY.shell.footerVerify },
  { href: "/custody", label: COPY.shell.footerCustody },
] as const;

export function SiteFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={"mx-auto w-full max-w-3xl px-4 pt-8 pb-24 text-center " + className}>
      <p className="text-[12px] text-ink-muted">{COPY.pool.ageTerritoryNote}</p>
      <nav aria-label={COPY.shell.footerNavLabel} className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-full text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
