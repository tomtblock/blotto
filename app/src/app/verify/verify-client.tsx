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
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { verifyPool, type OnChainRecord, type PublishedBundle, type VerifyReport } from '@/verify/logic';

const FIELD =
  'rounded-lg border border-line bg-base p-2.5 font-mono text-xs text-ink ' +
  'outline-none focus-visible:border-brand';

export function VerifyClient() {
  const [pool, setPool] = useState('');
  const [bundleUri, setBundleUri] = useState('');
  const [bundleText, setBundleText] = useState('');
  const [recordText, setRecordText] = useState('');
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

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
          Pool address (fetches the on-chain record)
          <input className={FIELD} value={pool} onChange={(e) => setPool(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
          Published bundle URI (the pool page links it)
          <input
            className={FIELD}
            value={bundleUri}
            onChange={(e) => setBundleUri(e.target.value)}
          />
        </label>
        <Button
          intent="quiet"
          className="self-start"
          disabled={fetching || (!pool.trim() && !bundleUri.trim())}
          onClick={autoFetch}
        >
          {fetching ? '…' : 'Fetch both'}
        </Button>
      </Card>
      <label className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
        Published reveal bundle (JSON)
        <textarea
          className={`h-32 ${FIELD}`}
          value={bundleText}
          onChange={(e) => setBundleText(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
        On-chain record (JSON — from the events, or the read API&apos;s /verify-record)
        <textarea
          className={`h-32 ${FIELD}`}
          value={recordText}
          onChange={(e) => setRecordText(e.target.value)}
        />
      </label>
      <Button size="lg" onClick={run}>
        Recompute
      </Button>
      {error && (
        <p className="text-[14px] leading-5 text-price-down" role="alert">
          {error}
        </p>
      )}
      {report && (
        <div
          className={
            'animate-settle rounded-2xl border-2 bg-raised p-5 ' +
            (report.ok ? 'border-price-up' : 'border-price-down')
          }
          role="status"
        >
          <p
            className={
              'mb-3 font-display text-[18px] font-bold ' +
              (report.ok ? 'text-price-up' : 'text-price-down')
            }
          >
            {report.ok ? COPY.verify.match : COPY.verify.mismatch}
          </p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {report.checks.map((c) => (
              <li key={c.name} className="flex gap-2">
                <span className={c.ok ? 'text-price-up' : 'text-price-down'}>
                  {c.ok ? '✓' : '✗'}
                </span>
                <span className="font-mono text-[13px] text-ink">{c.name}</span>
                <span className="text-[13px] text-ink-muted">{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
