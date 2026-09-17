/*
 * MarqueeHeading (founder 2026-09-16): a page or section heading drawn as
 * the landing machine's backlit sign (marquee.css — the .cab-marquee recipe,
 * copied so the play machine is never touched by a back-page change).
 *
 * The element is a REAL heading: the journey lane and assistive tech read
 * its accessible name, which is exactly the word on the sign — an optional
 * status word is decorative and hidden from the name.
 */
import type { ReactNode } from 'react';
import './marquee.css';

export function MarqueeHeading({
  as: Tag = 'h2',
  id,
  status,
  className = '',
  children,
}: {
  as?: 'h1' | 'h2';
  id?: string;
  /** A quiet mono word beside the sign's word (e.g. a pool state). Decorative. */
  status?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag id={id} className={`marquee marquee-${Tag} ${className}`}>
      <span className="marquee-word">{children}</span>
      {status ? (
        <span className="marquee-status" aria-hidden="true">
          {status}
        </span>
      ) : null}
    </Tag>
  );
}
