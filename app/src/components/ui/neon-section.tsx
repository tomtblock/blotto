/*
 * NeonSection (founder 2026-09-16): one section of an informational page on
 * the pink field — a marquee heading mounted on a plum panel ringed in neon
 * (marquee.css). Body typography inside is the game layer's (ink on plum),
 * so tables, lists and links keep the classes they already have.
 *
 * Round four A2 (founder 2026-09-17): every titled block on every page is
 * one of these — the pools lanes, the standings, the career record, the
 * wallet, the sign-in — so `headingAs` lets the box's sign be the page's
 * h1 where the box IS the page (the wallet, the sign-in, the gate).
 *
 * `id` lands on the <section> so in-page anchors keep working, with a
 * scroll margin for the sticky header.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { MarqueeHeading } from './marquee-heading';

export interface NeonSectionProps extends HTMLAttributes<HTMLElement> {
  heading: ReactNode;
  /** The heading's level; h2 unless the box is the page. */
  headingAs?: 'h1' | 'h2';
  /** A quiet mono word beside the sign's word (a state, a count). Decorative. */
  headingStatus?: ReactNode;
  children: ReactNode;
}

export function NeonSection({
  id,
  heading,
  headingAs = 'h2',
  headingStatus,
  className = '',
  children,
  ...rest
}: NeonSectionProps) {
  return (
    <section id={id} className={`neon-section scroll-mt-24 ${className}`} {...rest}>
      <MarqueeHeading as={headingAs} status={headingStatus}>
        {heading}
      </MarqueeHeading>
      <div className="neon-box">{children}</div>
    </section>
  );
}
