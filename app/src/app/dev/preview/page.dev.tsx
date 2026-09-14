/*
 * /dev/preview — every screen, in every state, without a tournament.
 *
 * DEV ONLY, and like /dev/components the FILENAME is the gate: `page.dev.tsx`
 * is a route only while `pageExtensions` includes `dev.tsx`, which
 * next.config.ts does outside a production build and never inside one. So a
 * production build compiles no route here at all; the `notFound()` below is
 * the second layer, kept in case that exclusion is ever lost (audit
 * 2026-09-11, A-30). Nothing here is a public surface and no copy on it
 * needs founder sign-off. It links only to real application routes: the
 * preview does not reimplement any screen, because a preview that drifts
 * from the pages it previews is worse than none.
 *
 * WHAT IT SOLVES. Design work was blocked on state nobody controls — you
 * could not see the settled-results screen without a settled pool, or the
 * refund screen without a pool that failed to fill. Each row below is an
 * ordinary URL against the fixture catalogue in `src/data/scenarios.ts`, so
 * every state is one click away and stays put while you work on it.
 *
 * SIGNED-IN SCREENS. `/play`, `/profile` and the share control need a wallet.
 * Run the app with the automation signer enabled (B-e) and they work here
 * too; the banner below says how. Without it those routes render their
 * signed-out state, which is also a state worth designing.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FIXTURE_PLAYER, SCENARIOS } from '@/data/scenarios';

export const metadata = { title: 'Preview — dev only' };

interface Row {
  readonly href: string;
  readonly label: string;
  readonly what: string;
  /** Stable file-safe name. `scripts/capture-screens.mjs` reads these off the
   *  rendered page, so the screenshot set can never drift from this index. */
  readonly name: string;
  /** Needs a signed-in wallet to show its interesting state. */
  readonly auth?: boolean;
}

const STANDALONE: Row[] = [
  { href: '/', name: 'home', label: '/', what: 'Home — the live pool, or the empty state when none is open.' },
  { href: '/pools', name: 'pools', label: '/pools', what: 'The pool list, with every lifecycle state present at once.' },
  { href: '/play', name: 'play', label: '/play', what: 'The entry session: age gate, seven battles, review, sealed submit.', auth: true },
  { href: '/profile', name: 'profile', label: '/profile', what: 'Career, prize totals, the cosmetic class collection.', auth: true },
  { href: '/verify', name: 'verify', label: '/verify', what: 'The public recompute page. Works signed out, by design.' },
  { href: '/rules', name: 'rules', label: '/rules', what: 'Rules and the §8.6 statements.' },
  { href: '/custody', name: 'custody', label: '/custody', what: 'How the pass and the sealed entry are held.' },
  { href: '/signin', name: 'signin', label: '/signin', what: 'The signed-out entry point.' },
  { href: '/admin/treasury', name: 'admin-treasury', label: '/admin/treasury', what: 'Treasury by tier — one row per status (open, settling, openable, short).' },
  { href: '/admin/review', name: 'admin-review', label: '/admin/review', what: 'The detection review queue.' },
  { href: '/dev/components', name: 'dev-components', label: '/dev/components', what: 'The design-system gallery — tokens and components in isolation.' },
];

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 font-display text-[22px] leading-7 font-bold text-ink">{title}</h2>
      {note ? <p className="mb-4 text-[13px] leading-5 text-ink-muted">{note}</p> : null}
      <div className="overflow-hidden rounded-xl border border-line">{children}</div>
    </section>
  );
}

function RowLink({ href, label, what, auth, name }: Row) {
  return (
    <Link
      href={href}
      data-capture={name}
      className="flex flex-col gap-0.5 border-b border-line px-4 py-3 last:border-b-0 hover:bg-raised"
    >
      <span className="font-mono text-[13px] text-ink">
        {label}
        {auth ? <span className="ml-2 rounded bg-raised px-1.5 py-0.5 text-[11px] text-ink-muted">needs a signer</span> : null}
      </span>
      <span className="text-[13px] leading-5 text-ink-muted">{what}</span>
    </Link>
  );
}

export default function PreviewIndexPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="mb-1 font-display text-[34px] leading-[38px] font-extrabold text-ink">
        Preview
      </h1>
      <p className="mb-6 text-[13px] leading-5 text-ink-muted">
        Every screen, in every state, served from fixtures. Development builds only — this route
        404s in production. Nothing here touches a chain, a wallet or an indexer.
      </p>

      <div className="mb-10 rounded-xl border border-line bg-raised px-4 py-3">
        <p className="mb-1 text-[13px] font-semibold text-ink">Signed-in screens</p>
        <p className="text-[13px] leading-5 text-ink-muted">
          Rows marked <span className="font-mono">needs a signer</span> show their signed-out state
          unless the automation signer is enabled. Start the app with{' '}
          <span className="font-mono">NEXT_PUBLIC_ALLOW_TEST_SIGNER=1</span> and a devnet RPC, then
          inject a keypair at <span className="font-mono">window.__BLOTTO_TEST_SIGNER__</span>. The
          fixture career answers for whatever address you inject, so the profile is never empty.
        </p>
      </div>

      <Section title="Screens">
        {STANDALONE.map((r) => (
          <RowLink key={r.href} {...r} />
        ))}
      </Section>

      <Section
        title="Pool states"
        note="One pool per lifecycle state. The pool page and its results page for each."
      >
        {SCENARIOS.map((s) => (
          <div key={s.key} className="border-b border-line last:border-b-0">
            <div className="px-4 pt-3">
              <span className="font-mono text-[13px] text-ink">{s.key}</span>
              <span className="ml-2 rounded bg-raised px-1.5 py-0.5 text-[11px] text-ink-muted">
                {s.summary.state} · {s.summary.entrants}/64
              </span>
            </div>
            <p className="px-4 pt-0.5 text-[13px] leading-5 text-ink-muted">{s.what}</p>
            <div className="flex gap-4 px-4 pt-1.5 pb-3">
              <Link
                href={`/pools/${s.summary.pool}`}
                data-capture={`pool-${s.key}`}
                className="font-mono text-[13px] text-prize hover:underline"
              >
                pool page
              </Link>
              <Link
                href={`/pools/${s.summary.pool}/results`}
                data-capture={`results-${s.key}`}
                className="font-mono text-[13px] text-prize hover:underline"
              >
                results
              </Link>
              <Link
                href={`/card/${s.summary.pool}/${FIXTURE_PLAYER}`}
                data-capture={`card-${s.key}`}
                className="font-mono text-[13px] text-prize hover:underline"
              >
                share card
              </Link>
            </div>
          </div>
        ))}
      </Section>
    </main>
  );
}
