'use client';

/*
 * <Cabinet /> — the machine (founder 2026-09-09: "the whole container should
 * look like the grab machine", two reference clips: a dark plum cabinet
 * outlined in hot-pink neon, a warm backlit BLOTTO marquee, a glass window
 * with the Blot on a glowing disc, a control deck of pentagon and bars).
 *
 * Pure presentation: a frame around a stage (the Blot) and a deck (the
 * dials). Every colour is a token; the neon is layered box-shadow. The
 * chute at the bottom of the window is where a locked Blot drops out
 * (battle-flow.tsx animates the drop; the cabinet only draws the slot).
 *
 * Used by the landing demo and by every battle screen, so the machine the
 * player learns on the landing page is the machine they play in.
 */

import type { ReactNode } from 'react';
import { COPY } from '@/copy';
import './cabinet.css';

export interface CabinetProps {
  /** The stage contents — the Blot. */
  children: ReactNode;
  /** The control deck — the dials and the lock-in control. */
  deck: ReactNode;
  /** Marquee line under the brand word (e.g. "Battle 3 of 7"). */
  status?: string;
  /** Something pinned to the window's top-right (the run clock). */
  corner?: ReactNode;
  /** Stage height in CSS px (the window's inner height). */
  stageHeight?: number;
  className?: string;
}

export function Cabinet({ children, deck, status, corner, stageHeight = 300, className }: CabinetProps) {
  return (
    <div className={`cab${className ? ` ${className}` : ''}`}>
      <div className="cab-marquee">
        <span className="cab-marquee-word">{COPY.shell.title}</span>
        {status ? <span className="cab-marquee-status">{status}</span> : null}
      </div>
      <div className="cab-window" style={{ minHeight: stageHeight }}>
        <div className="cab-lightbar" aria-hidden="true" />
        <div className="cab-disc" aria-hidden="true" />
        <div className="cab-stage">{children}</div>
        <div className="cab-glare" aria-hidden="true" />
        {corner ? <div className="cab-corner">{corner}</div> : null}
      </div>
      <div className="cab-chute" aria-hidden="true">
        <div className="cab-chute-slot" />
      </div>
      <div className="cab-deck">
        <div className="cab-deck-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M12 2.5 21 9.3l-3.4 10.6H6.4L3 9.3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>
        {deck}
      </div>
    </div>
  );
}
