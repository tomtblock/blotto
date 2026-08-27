'use client';

/*
 * The verify page's client half (R13, roadmap 3.6): everything runs
 * IN-BROWSER — the same scoring engine the crank runs, over the published
 * bundle and the on-chain record. Two inputs, one report, green or red.
 *
 * C11: both inputs AUTO-FETCH — the on-chain record from the indexer read
 * API's /verify-record for a pasted pool address, the bundle from its
 * published URI (the Irys gateway address the crank emitted). Pasting the
 * JSON directly still works and always will: verification must work
 * against a hostile or absent operator — the wallet is never involved.
 */

import { useState } from 'react';
import { COPY } from '@/copy';
import { verifyPool, type OnChainRecord, type PublishedBundle, type VerifyReport } from '@/verify/logic';

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
      <h1 className="text-2xl">{COPY.verify.title}</h1>
      <p className="text-sm opacity-80">{COPY.verify.explainer}</p>
      <div className="flex flex-col gap-2 rounded border p-3">
        <label className="flex flex-col gap-1 text-sm">
          Pool address (fetches the on-chain record)
          <input
            className="rounded border bg-transparent p-2 font-mono text-xs"
            value={pool}
            onChange={(e) => setPool(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Published bundle URI (the pool page links it)
          <input
            className="rounded border bg-transparent p-2 font-mono text-xs"
            value={bundleUri}
            onChange={(e) => setBundleUri(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="self-start rounded border px-4 py-1"
          disabled={fetching || (!pool.trim() && !bundleUri.trim())}
          onClick={autoFetch}
        >
          {fetching ? '…' : 'Fetch both'}
        </button>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Published reveal bundle (JSON)
        <textarea
          className="h-32 rounded border bg-transparent p-2 font-mono text-xs"
          value={bundleText}
          onChange={(e) => setBundleText(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        On-chain record (JSON — from the events, or the read API&apos;s /verify-record)
        <textarea
          className="h-32 rounded border bg-transparent p-2 font-mono text-xs"
          value={recordText}
          onChange={(e) => setRecordText(e.target.value)}
        />
      </label>
      <button type="button" className="rounded border px-4 py-2" onClick={run}>
        Recompute
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {report && (
        <div
          className={`rounded border p-4 ${report.ok ? 'border-green-500' : 'border-red-500'}`}
          role="status"
        >
          <p className="mb-3 font-medium">
            {report.ok ? COPY.verify.match : COPY.verify.mismatch}
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {report.checks.map((c) => (
              <li key={c.name} className="flex gap-2">
                <span>{c.ok ? '✓' : '✗'}</span>
                <span className="font-mono">{c.name}</span>
                <span className="opacity-60">{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
