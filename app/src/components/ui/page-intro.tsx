/*
 * PageIntro (2026-09-13): the top of every leaf page — an optional way back,
 * the page title, an optional lead. One shape so the twelve pages that each
 * hand-wrote an h1 read as one product, and so every leaf gets the back
 * affordance without each page remembering to add it.
 */
import type { ReactNode } from "react";
import { BackLink } from "./back-link";
import { MarqueeHeading } from "./marquee-heading";

export function PageIntro({
  title,
  lead,
  back,
  aside,
  tone = "plain",
}: {
  title: ReactNode;
  lead?: ReactNode;
  /** Where "back" goes and what it says — the page the player most likely came from. */
  back?: { href: string; label: string };
  /** Right-aligned companion to the title (a state pill, a verify link). */
  aside?: ReactNode;
  /**
   * `plain`: the h1 as display type on a plum page. `marquee` (founder
   * 2026-09-16): the h1 as the landing machine's backlit sign, on the pink
   * field, with berry ink around it.
   */
  tone?: "plain" | "marquee";
}) {
  const marquee = tone === "marquee";
  return (
    <div className="mb-6">
      {back ? (
        <BackLink href={back.href} tone={marquee ? "berry" : "ink"}>
          {back.label}
        </BackLink>
      ) : null}
      <div className={"flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 " + (back ? "mt-2" : "")}>
        {marquee ? (
          <MarqueeHeading as="h1">{title}</MarqueeHeading>
        ) : (
          <h1 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">{title}</h1>
        )}
        {aside}
      </div>
      {lead ? (
        <p
          className={
            "mt-3 max-w-prose text-[15px] leading-6 " + (marquee ? "text-brand-berry" : "text-ink-muted")
          }
        >
          {lead}
        </p>
      ) : null}
    </div>
  );
}
