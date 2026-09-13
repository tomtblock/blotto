import { Suspense } from 'react';
import type { Metadata } from 'next';
import { GateClient } from './gate-client';

/* The pre-launch code gate (src/gate/gate.ts).
 *
 * THE SHELL IS SERVER-RENDERED, THE FORM IS NOT (2026-09-13).
 *
 * This page used to be a bare `<Suspense>` around the whole client component,
 * with no fallback. `GateClient` calls `useSearchParams()`, so that subtree is
 * excluded from the prerender — and with nothing to fall back to, the server
 * sent a document whose body was EMPTY. Every pixel depended on the client
 * bundle arriving.
 *
 * On 2026-09-13 it did not: the founder's browser was served 403 for every
 * script and stylesheet on the page (a platform-level refusal upstream of the
 * app — the same favicon answered 404 elsewhere and 403 to them). What they
 * saw was a blank page with a correct tab title and no explanation of any
 * kind, and it took a browser console to learn anything at all. A first-run
 * door that can fail silently and completely is the wrong shape for the first
 * page anyone meets.
 *
 * So the heading and the lead sentence are rendered HERE, on the server,
 * outside the client boundary; the `<Suspense>` has a real fallback shaped
 * like the control it replaces; and a `<noscript>` states the requirement
 * plainly. None of this makes a blocked bundle work — nothing in the page can
 * — but it changes an invisible failure into a legible one.
 */
export const metadata: Metadata = {
  title: 'Blotto Cup',
  robots: { index: false, follow: false },
};

export default function GatePage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">
            Blotto Cup
          </h1>
          <p className="mt-2 text-[15px] leading-6 text-ink-muted">
            This preview is invitation only. Enter your access code to continue.
          </p>
        </div>

        <noscript>
          <p className="text-[14px] leading-5 text-ink-muted">
            The access form needs JavaScript. If it is switched on and you are still seeing
            this, something is blocking this page&rsquo;s scripts — an extension, a network
            filter, or a proxy.
          </p>
        </noscript>

        <Suspense
          fallback={
            <div
              aria-hidden
              className="flex flex-col gap-3"
            >
              <div className="h-14 rounded-xl border border-line" />
              <div className="h-14 rounded-xl bg-brand opacity-40" />
            </div>
          }
        >
          <GateClient />
        </Suspense>
      </div>
    </main>
  );
}
