/*
 * NeonSection (founder 2026-09-16): one section of an informational page on
 * the pink field — a marquee heading mounted on a plum panel ringed in neon
 * (marquee.css). Body typography inside is the game layer's (ink on plum),
 * so tables, lists and links keep the classes they already have.
 *
 * `id` lands on the <section> so in-page anchors keep working, with a
 * scroll margin for the sticky header.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { MarqueeHeading } from './marquee-heading';

export interface NeonSectionProps extends HTMLAttributes<HTMLElement> {
  heading: ReactNode;
  children: ReactNode;
}

export function NeonSection({ id, heading, className = '', children, ...rest }: NeonSectionProps) {
  return (
    <section id={id} className={`neon-section scroll-mt-24 ${className}`} {...rest}>
      <MarqueeHeading as="h2">{heading}</MarqueeHeading>
      <div className="neon-box">{children}</div>
    </section>
  );
}
