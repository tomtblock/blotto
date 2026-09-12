'use client';

/*
 * The verify page's client half (R13, roadmap 3.6; restyled by v3 D2):
 * everything runs IN-BROWSER — the same scoring engine the crank runs, over
 * the published bundle and the on-chain record. Two inputs, one report, and
 * THREE verdicts (audit 2026-09-11, D-10 / D-29): green and red are the
 * priceUp/priceDown pair — a verification verdict is outcome semantics, the
 * one non-market place those tokens apply — and the third, "nothing
 * disagreed, something could not be checked", wears neither, because it is
 * neither a win nor a loss and must not be mistaken for either.
 *
 * C11: both inputs AUTO-FETCH — the on-chain record from the indexer read
 * API's /verify-record for a pasted pool address, the bundle from its
 * published URI (the Irys gateway address the crank emitted). Pasting the
 * JSON directly still works and always will: verification must work
 * against a hostile or absent operator — the wallet is never involved.
 *
 * D-04: the bundle address is FILLED IN rather than demanded. It arrives in
 * the link (`?bundle=`), or is looked up from the pool's published archive
 * when only a pool address is given. Where we cannot supply it, the page
 * says so and says why — it used to leave the field blank and silent, and
 * the case where we have no verified archive to look it up in is precisely
 * the case where a player most needs to check the bundle themselves.
 */

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { indexerApi } from '@/data/api';
import {
  verifyPool,
  type CheckStatus,
  type OnChainRecord,
  type PublishedBundle,
  type VerifyReport,
} from '@/verify/logic';

const FIELD =
  'rounded-lg border border-line bg-base p-2.5 font-mono text-xs text-ink ' +
  'outline-none focus-visible:border-brand';

/*
 * The three verdicts, drawn.
 *
 * `incomplete` deliberately wears NEITHER price token: priceUp/priceDown are
 * reserved for win/loss semantics (design/tokens.ts), and "this could not be
 * checked yet" is neither. Plain ink on the ordinary line colour is the
 * point — it reads as a statement, not as a result.
 */
const VERDICT_BORDER: Record<VerifyReport['verdict'], string> = {
  match: 'border-price-up',
  incomplete: 'border-line',
  mismatch: 'border-price-down',
};
const VERDICT_TEXT: Record<VerifyReport['verdict'], string> = {
  match: 'text-price-up',
  incomplete: 'text-ink',
  mismatch: 'text-price-down',
};
const VERDICT_COPY: Record<VerifyReport['verdict'], string> = {
  match: COPY.verify.match,
  incomplete: COPY.verify.incomplete,
  mismatch: COPY.verify.mismatch,
};
const STATUS_TEXT: Record<CheckStatus, string> = {
  pass: 'text-price-up',
  incomplete: 'text-ink-muted',
  fail: 'text-price-down',
};
const STATUS_MARK: Record<CheckStatus, string> = {
  pass: '✓',
  incomplete: '–',
  fail: '✗',
};

export function VerifyClient() {
  // The pool page links here with ?pool=<address> (founder 2026-09-09: the
  // address arrives filled in; the guide below says what to press next).
  const params = useSearchParams();
  const [pool, setPool] = useState(() => params.get('pool') ?? '');
  // D-04: the pool page and the results page link the bundle address they
  // already hold, so the ordinary journey never has an empty field here.
  const [bundleUri, setBundleUri] = useState(() => params.get('bundle') ?? '');
  const [bundleText, setBundleText] = useState('');
  const [recordText, setRecordText] = useState('');
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uriNote, setUriNote] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  /**
   * The pool's published bundle address, from its verified archive. Returns
   * null when there is no archive to read it from — including the case the
   * read API fails closed on, a bundle whose root does NOT match. Never
   * throws: a missing address must not stop the on-chain record arriving.
   */
  const lookUpBundleUri = async (poolAddress: string): Promise<string | null> => {
    try {
      return (await indexerApi().getLeaderboard(poolAddress))?.uri ?? null;
    } catch {
      return null;
    }
  };

  const autoFetch = async () => {
    setError(null);
    setUriNote(null);
    setFetching(true);
    try {
      const poolAddress = pool.trim();
      // The on-chain record from the indexer read API (paste overrides).
      const indexerBase = process.env.NEXT_PUBLIC_INDEXER_URL;
      if (poolAddress && indexerBase) {
        const res = await fetch(
          `${indexerBase}/pools/${encodeURIComponent(poolAddress)}/verify-record`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`verify-record: ${res.status}`);
        setRecordText(JSON.stringify(await res.json(), null, 2));
      } else if (poolAddress && !indexerBase) {
        throw new Error('indexer not configured (NEXT_PUBLIC_INDEXER_URL) — paste the record');
      }
      // The bundle address: given, or looked up for the pool. Filling the
      // FIELD (not just a variable) is the point — the player keeps the
      // address, can read it, and can fetch it themselves from anywhere.
      let uri = bundleUri.trim();
      if (!uri && poolAddress) {
        const found = await lookUpBundleUri(poolAddress);
        if (found) {
          uri = found;
          setBundleUri(found);
          setUriNote(COPY.verify.bundleUriFound);
        } else {
          setUriNote(COPY.verify.bundleUriUnavailable);
        }
      }
      // The published bundle from its permanent URI.
      if (uri) {
        const res = await fetch(uri, { cache: 'no-store' });
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

      <Card className="flex flex-col gap-3 p-5" data-testid="verify-guide">
        <h2 className="font-display text-[20px] font-bold text-ink">{COPY.verify.howTitle}</h2>
        <ol className="flex flex-col gap-3">
          {COPY.verify.howSteps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand font-mono text-[12px] font-bold text-(--color-base)"
              >
                {i + 1}
              </span>
              <p className="text-[14px] leading-6 text-ink">{step}</p>
            </li>
          ))}
        </ol>
        <p className="text-[13px] leading-5 text-ink-muted">{COPY.verify.howVerdict}</p>
        <p className="text-[13px] leading-5 text-ink-muted">{COPY.verify.howWhen}</p>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
          <span>
            <span className="mr-2 font-mono text-[11px] text-brand">1</span>
            {COPY.verify.poolLabel}
          </span>
          <input className={FIELD} value={pool} onChange={(e) => setPool(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
          {COPY.verify.bundleLabel}
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
          <span className="mr-2 font-mono text-[11px] text-brand">2</span>
          {fetching ? '…' : COPY.verify.fetchBoth}
        </Button>
        {uriNote ? (
          <p
            role="status"
            data-testid="verify-uri-note"
            className="max-w-prose text-[13px] leading-5 text-ink-muted"
          >
            {uriNote}
          </p>
        ) : null}
      </Card>
      <label className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
        {COPY.verify.bundleField}
        <textarea
          className={`h-32 ${FIELD}`}
          value={bundleText}
          onChange={(e) => setBundleText(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
        {COPY.verify.recordField}
        <textarea
          className={`h-32 ${FIELD}`}
          value={recordText}
          onChange={(e) => setRecordText(e.target.value)}
        />
      </label>
      <Button size="lg" onClick={run} disabled={!bundleText.trim() || !recordText.trim()}>
        <span className="mr-2 font-mono text-[12px] opacity-70">3</span>
        {COPY.verify.recompute}
      </Button>
      {error && (
        <p className="text-[14px] leading-5 text-price-down" role="alert">
          {error}
        </p>
      )}
      {report && (
        <div
          className={'animate-settle rounded-2xl border-2 bg-raised p-5 ' + VERDICT_BORDER[report.verdict]}
          role="status"
          data-testid="verify-report"
          data-verdict={report.verdict}
        >
          <p className={'mb-3 font-display text-[18px] font-bold ' + VERDICT_TEXT[report.verdict]}>
            {VERDICT_COPY[report.verdict]}
          </p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {report.checks.map((c) => (
              <li key={c.name} className="flex gap-2" data-testid={`check-${c.name}`} data-status={c.status}>
                <span className={STATUS_TEXT[c.status]} aria-label={c.status}>
                  {STATUS_MARK[c.status]}
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
