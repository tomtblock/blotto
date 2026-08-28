'use client';

/*
 * The verify page's client half (R13, roadmap 3.6; restyled by v3 D2):
 * everything runs IN-BROWSER — the same scoring engine the crank runs, over
 * the published bundle and the on-chain record. Two inputs, one report,
 * green or red (the priceUp/priceDown pair: a verification verdict is
 * outcome semantics, the one non-market place those tokens apply).
 *
 * C11: both inputs AUTO-FETCH — the on-chain record from the indexer read
 * API's /verify-record for a pasted pool address, the bundle from its
 * published URI (the Irys gateway address the crank emitted). Pasting the
 * JSON directly still works and always will: verification must work
 * against a hostile or absent operator — the wallet is never involved.
 */

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { verifyPool, type OnChainRecord, type PublishedBundle, type VerifyReport } from '@/verify/logic';

const FIELD =
  'rounded-lg border border-line bg-base p-2.5 font-mono text-xs text-ink ' +
  'outline-none focus-visible:border-brand';

export function VerifyClient() {
  // Deep links (?pool=…) from winners cards and pool pages prefill the
  // instrument; the reader still presses the buttons — "I checked", not
  // "it checked itself".
  const params = useSearchParams();
  const [pool, setPool] = useState(() => params.get('pool') ?? '');
  const [bundleUri, setBundleUri] = useState('');
  const [bundleText, setBundleText] = useState('');
  const [recordText, setRecordText] = useState('');
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [runId, setRunId] = useState(0);

  const autoFetch = async () => {
    setError(null);
    setFetching(true);
    try {
      // The on-chain record from the indexer read API (paste overrides).
      const indexerBase = process.env.NEXT_PUBLIC_INDEXER_URL;
      if (pool.trim() && indexerBase) {
        const res = await fetch(
          `${indexerBase}/pools/${encodeURIComponent(pool.trim())}/verify-record`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`verify-record: ${res.status}`);
        setRecordText(JSON.stringify(await res.json(), null, 2));
      } else if (pool.trim() && !indexerBase) {
        throw new Error('indexer not configured (NEXT_PUBLIC_INDEXER_URL) — paste the record');
      }
      // The published bundle from its permanent URI.
      if (bundleUri.trim()) {
        const res = await fetch(bundleUri.trim(), { cache: 'no-store' });
        if (!res.ok) throw new Error(`bundle fetch: ${res.status}`);
        setBundleText(JSON.stringify(await res.json(), null, 2));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setFetching(false);
  };

  const run = () => {
    try {
      setError(null);
      const bundle = JSON.parse(bundleText) as PublishedBundle;
      const record = JSON.parse(recordText) as OnChainRecord;
      setReport(verifyPool(bundle, record));
      setRunId((n) => n + 1); // replay the instrument sequence per run
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">
        {COPY.verify.title}
      </h1>
      <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{COPY.verify.explainer}</p>
      <Card className="flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
          {COPY.verify.poolLabel}
          <input className={FIELD} value={pool} onChange={(e) => setPool(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
          {COPY.verify.bundleUriLabel}
          <input
            className={FIELD}
            value={bundleUri}
            onChange={(e) => setBundleUri(e.target.value)}
          />
        </label>
        <Button
          intent="secondary"
          className="self-start"
          disabled={fetching || (!pool.trim() && !bundleUri.trim())}
          onClick={autoFetch}
        >
          {fetching ? '…' : COPY.verify.fetchBoth}
        </Button>
      </Card>
      <label className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
        {COPY.verify.bundleTextLabel}
        <textarea
          className={`h-32 ${FIELD}`}
          value={bundleText}
          onChange={(e) => setBundleText(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
        {COPY.verify.recordTextLabel}
        <textarea
          className={`h-32 ${FIELD}`}
          value={recordText}
          onChange={(e) => setRecordText(e.target.value)}
        />
      </label>
      <Button size="lg" onClick={run}>
        {COPY.verify.run}
      </Button>
      {error && (
        <p className="error-surface text-[14px] leading-5 text-price-down" role="alert">
          {error}
        </p>
      )}
      {report && <InstrumentPanel key={runId} report={report} />}
    </section>
  );
}

/* 6.7: the instrument panel. Checks complete top-to-bottom (a 90ms
 * cadence), each tick drawing in as its row settles into the verdict
 * colour — LIGHT as truth, its purest use. A failed check pins to the top
 * and takes the site's ONLY shake (≤200ms), once. The verdict banner
 * settles last, after the instruments. Motion here reads as instruments,
 * never celebration; reduced motion renders the settled panel instantly. */
const CHECK_CADENCE_MS = 90;

function InstrumentPanel({ report }: { report: VerifyReport }) {
  // Failures pin to the top; order is otherwise the engine's.
  const checks = [...report.checks].sort((a, b) => Number(a.ok) - Number(b.ok));
  const bannerDelay = checks.length * CHECK_CADENCE_MS + 150;
  return (
    <div
      className={
        'rounded-2xl border-2 bg-raised p-5 ' +
        (report.ok ? 'border-price-up' : 'border-price-down')
      }
      role="status"
    >
      <ul className="flex flex-col gap-1.5 text-sm">
        {checks.map((c, i) => (
          <li
            key={c.name}
            className="animate-enter-fast flex items-baseline gap-2"
            style={{ animationDelay: `${i * CHECK_CADENCE_MS}ms` }}
          >
            <span
              className={
                (c.ok ? '' : 'animate-verify-shake ') + 'flex items-baseline gap-2'
              }
              style={c.ok ? undefined : { animationDelay: `${i * CHECK_CADENCE_MS + 120}ms` }}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 self-center" aria-hidden>
                {c.ok ? (
                  <path
                    d="m3 8.5 3.2 3.2L13 5"
                    fill="none"
                    stroke="var(--color-price-up)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    className="tick-draw"
                    style={{ animationDelay: `${i * CHECK_CADENCE_MS + 80}ms` }}
                  />
                ) : (
                  <path
                    d="m4 4 8 8M12 4l-8 8"
                    fill="none"
                    stroke="var(--color-price-down)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    pathLength={1}
                    className="tick-draw"
                    style={{ animationDelay: `${i * CHECK_CADENCE_MS + 80}ms` }}
                  />
                )}
              </svg>
              <span className="sr-only">{c.ok ? 'passed:' : 'FAILED:'}</span>
              <span
                className={
                  'font-mono text-[13px] ' + (c.ok ? 'text-ink' : 'font-semibold text-price-down')
                }
              >
                {c.name}
              </span>
              <span className="text-[13px] text-ink-muted">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p
        className={
          'animate-enter mt-4 font-display text-[18px] font-bold ' +
          (report.ok ? 'text-price-up' : 'text-price-down')
        }
        style={{ animationDelay: `${bannerDelay}ms` }}
      >
        {report.ok ? COPY.verify.match : COPY.verify.mismatch}
      </p>
    </div>
  );
}
