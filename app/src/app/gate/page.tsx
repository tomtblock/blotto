import { Suspense } from 'react';
import type { Metadata } from 'next';
import { GateClient } from './gate-client';

/* The pre-launch code gate (src/gate/gate.ts). Server shell only; the form and
 * all behaviour live in the client component. Never indexed. */
export const metadata: Metadata = {
  title: 'Blotto Cup',
  robots: { index: false, follow: false },
};

export default function GatePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <Suspense>
        <GateClient />
      </Suspense>
    </main>
  );
}
