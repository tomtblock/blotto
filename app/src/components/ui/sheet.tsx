"use client";

/*
 * Sheet (D1): the dialog for secondary flows (details, settings, the
 * leave-the-run question). Founder 2026-09-09: "the pop ups in the centre
 * of the screen, not the bottom" — it is a centred card at every width
 * now, docking with the `settle` motion. It is a dialog: focus is trapped
 * by the browser's native <dialog>, Escape closes, and the background is
 * inert while open.
 */
import { useEffect, useRef, type ReactNode } from "react";

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
        "m-auto w-[calc(100%-32px)] max-w-lg bg-transparent p-0 " +
        "backdrop:bg-black/60 backdrop:backdrop-blur-[2px] open:animate-settle"
      }
    >
      <div
        className="rounded-2xl border border-line bg-raised px-5 pb-6 pt-5 sm:px-6"
        style={{ boxShadow: "var(--elevation-sheet)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-[24px] font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-overlay hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
