'use client';

/*
 * Modal (V3, founder 2026-09-27, "Colour palette and box shadow"): the
 * cream card that opens over a page — plum text, the yellow glow the easy
 * entry card wears — for the legal pages' sections (section-tiles.tsx) and
 * the profile's pool matrix (components/profile/finishes.tsx). A click
 * outside, Escape or the close key returns to the page.
 *
 * It is a real <dialog>: the browser traps focus, the page behind is inert,
 * and Escape closes. The Sheet (sheet.tsx) stays the plum dialog for the
 * app's own flows (the notifications, the leave question); this is the
 * one for reading.
 *
 * `on-cream` (globals.css) re-points the game layer's ink names inside, so
 * a section written for a plum box — tables, lists, links — reads as plum
 * on cream without a second set of classes.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { COPY } from '@/copy';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** A quieter line over the title (a section's short label, a pool's state). */
  kicker?: string;
  children: ReactNode;
  'data-testid'?: string;
}

export function Modal({ open, onClose, title, kicker, children, 'data-testid': testId }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Backdrop click: the dialog element itself is the click target
        // only when the click lands outside the card.
        if (e.target === ref.current) onClose();
      }}
      data-testid={testId}
      className={
        'm-auto w-[calc(100%-24px)] max-w-2xl overflow-visible bg-transparent p-0 ' +
        'backdrop:bg-[rgba(94,27,64,0.55)] backdrop:backdrop-blur-[2px] open:animate-settle'
      }
    >
      <div className="on-cream home-card relative flex max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-[28px] border-2 border-brand-yellow bg-brand-cream text-brand-berry">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-2 bg-brand-yellow" />
        <div className="flex items-start justify-between gap-4 px-5 pt-7 pb-3 sm:px-7 sm:pt-8">
          <div className="min-w-0">
            {kicker ? <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-brand-deep-magenta">{kicker}</p> : null}
            <h2 className="font-display text-[26px] leading-8 font-extrabold text-brand-berry sm:text-[32px] sm:leading-9">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={COPY.shell.close}
            data-testid="modal-close"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-brand-berry/30 text-brand-berry hover:bg-brand-berry/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-deep-magenta"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-6 sm:px-7 sm:pb-7">{children}</div>
      </div>
    </dialog>
  );
}
