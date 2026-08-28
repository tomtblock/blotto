'use client';

/*
 * Toasts (UI constitution PART 5.9): Sonner, styled to the tokens — the
 * pick-ui-library call for toasts, replacing the bespoke provider. Toast
 * discipline carried over from the old module: toasts confirm state
 * changes ("Allocation sealed", "Choice recorded"); there is deliberately
 * NO error toast — failures render in place, next to the fix, via
 * ErrorSurface. The `prize` tone exists for paid moments only.
 *
 * Sonner enters/exits with transform+opacity transitions (interruptible),
 * bottom-center like the old toasts, and respects reduced motion on its
 * own; the global collapse in tokens.css covers the rest.
 */

import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      gap={8}
      duration={3200}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'rounded-full border px-5 py-2.5 text-[15px] font-medium ' +
            'border-line bg-overlay text-ink flex items-center justify-center w-fit mx-auto',
        },
      }}
    />
  );
}

/** Confirm a state change. Tone 'prize' is for paid moments only. */
export function showToast(message: string, tone: 'ink' | 'prize' = 'ink') {
  sonnerToast(message, {
    className:
      tone === 'prize'
        ? 'rounded-full border px-5 py-2.5 text-[15px] font-medium border-prize/50 bg-overlay text-prize flex items-center justify-center w-fit mx-auto'
        : undefined,
  });
}
