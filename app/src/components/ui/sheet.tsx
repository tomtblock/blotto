"use client";

/*
 * Sheet (D1): a bottom sheet for secondary flows on mobile (details,
 * settings), docking with the `settle` motion. It is a dialog: focus is
 * trapped by the browser's native <dialog>, Escape closes, and the
 * background is inert while open.
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
        "m-0 mt-auto w-full max-w-full bg-transparent p-0 " +
        "backdrop:bg-black/60 open:animate-settle sm:mx-auto sm:max-w-lg"
      }
    >
      <div
        className="rounded-t-2xl border border-b-0 border-line bg-raised px-5 pb-8 pt-3"
        style={{ boxShadow: "var(--elevation-sheet)" }}
      >
        <div aria-hidden className="mx-auto mb-4 h-1 w-10 rounded-full bg-overlay" />
        <h2 className="mb-4 font-display text-[24px] font-bold text-ink">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
