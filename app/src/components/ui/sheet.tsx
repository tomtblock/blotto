"use client";

/*
 * Sheet (D1): the dialog for secondary flows (details, settings, the
 * leave-the-run question, the notifications). Founder 2026-09-09: "the pop
 * ups in the centre of the screen, not the bottom" — it is a centred card
 * at every width, docking with the `settle` motion. It is a dialog: focus
 * is trapped by the browser's native <dialog>, Escape closes, and the
 * background is inert while open.
 *
 * Round four A2 (founder 2026-09-17): the panel is the site's one box — a
 * neon-ringed plum panel with its title on a backlit marquee (marquee.css,
 * the same recipe every section on every page wears), so a dialog looks
 * like the page it opens over.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { MarqueeHeading } from "./marquee-heading";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
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
        // only when the click lands outside the panel.
        if (e.target === ref.current) onClose();
      }}
      className={
        "m-auto w-[calc(100%-32px)] max-w-lg overflow-visible bg-transparent p-0 " +
        "backdrop:bg-black/60 backdrop:backdrop-blur-[2px] open:animate-settle"
      }
    >
      <div className="neon-section">
        <MarqueeHeading as="h2">{title}</MarqueeHeading>
        <div className="neon-box text-ink">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-overlay hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          {children}
        </div>
      </div>
    </dialog>
  );
}
