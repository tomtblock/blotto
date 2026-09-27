/*
 * StopCard (V2, founder 2026-09-27: "make sure all failure notifications
 * are designed in the same manner across the site"). Every place the site
 * stops a player — a dead end, a refusal, an error, a failed action — is
 * this one card: a kind badge, a title, one or two plain lines, and a way
 * out. No page is allowed to leave a player without a way out, so the
 * card always carries at least one action; "Find another pool" and "Back
 * to the home page" are the two most pages want.
 *
 * Server-renderable (no state), so the 404 page and the server-side pool
 * stops use it as well as the entry flow.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { COPY } from '@/copy';

export type StopKind = 'dead-end' | 'refusal' | 'error' | 'failure';

export interface StopAction {
  label: string;
  /** A link, or an onClick handler (client components only). */
  href?: string;
  onClick?: () => void;
  /** `primary` is the one yellow key; the rest are quiet. */
  intent?: 'primary' | 'quiet';
  'data-testid'?: string;
}

const KIND: Record<StopKind, string> = {
  'dead-end': 'border-white/30 text-ink',
  refusal: 'border-(--color-loss)/60 bg-(--color-loss)/15 text-ink',
  error: 'border-brand-coral/60 bg-brand-coral/15 text-ink',
  failure: 'border-(--color-loss)/60 bg-(--color-loss)/15 text-ink',
};

/** The two ways out most stops offer. */
export const STOP_ACTIONS = {
  findAnotherPool: (): StopAction => ({ href: '/', label: COPY.stop.findAnotherPool, intent: 'primary' }),
  backHome: (): StopAction => ({ href: '/', label: COPY.stop.backHome, intent: 'quiet' }),
  seePools: (): StopAction => ({ href: '/pools', label: COPY.stop.seePools, intent: 'quiet' }),
  wallet: (): StopAction => ({ href: '/wallet', label: COPY.stop.openWallet, intent: 'quiet' }),
} as const;

const PRIMARY =
  'key-action flex h-12 items-center justify-center rounded-full bg-brand px-6 font-display text-[16px] font-bold uppercase tracking-wide text-(--color-base) hover:bg-brand-hot';
const QUIET =
  'flex h-12 items-center justify-center rounded-full border border-white/25 px-6 text-[15px] font-semibold text-ink hover:border-brand hover:text-brand';

function Action({ a }: { a: StopAction }) {
  const cls = a.intent === 'primary' ? PRIMARY : QUIET;
  if (a.href) {
    return (
      <Link href={a.href} className={cls} data-testid={a['data-testid']}>
        {a.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={a.onClick} className={cls} data-testid={a['data-testid']}>
      {a.label}
    </button>
  );
}

export function StopCard({
  kind,
  title,
  children,
  actions,
  'data-testid': testId,
}: {
  kind: StopKind;
  title: string;
  children?: ReactNode;
  /** At least one. The first primary action is the key. */
  actions: readonly StopAction[];
  'data-testid'?: string;
}) {
  return (
    <section
      role={kind === 'dead-end' ? undefined : 'alert'}
      data-testid={testId}
      data-stop-kind={kind}
      className="candy candy-gloss animate-rise relative flex flex-col gap-4 overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,var(--color-overlay)_0%,var(--color-raised)_38%,var(--color-base)_100%)] p-6 sm:p-7"
    >
      <span
        className={`inline-flex w-max items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] ${KIND[kind]}`}
      >
        {COPY.stop.kinds[kind]}
      </span>
      <h2 className="font-display text-[26px] leading-[30px] font-extrabold text-ink">{title}</h2>
      {children ? (
        <div className="flex max-w-prose flex-col gap-2 text-[15px] leading-6 text-ink-muted">{children}</div>
      ) : null}
      <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {actions.map((a) => (
          <Action key={a.label} a={a} />
        ))}
      </div>
    </section>
  );
}
