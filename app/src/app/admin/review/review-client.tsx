'use client';

/*
 * The admin review page (roadmap 4.4, wired to the C10 review service):
 * flagged entries in a pool, a decision per row — WALLET-SIGNED. The page
 * signs the same canonical message the server verifies (one shared module,
 * backend/detection/src/review-message.ts), with the signed-in wallet as
 * the reviewer; the server accepts only wallets in the founder-maintained
 * member list (config/reviewers.json). The pool's decision log renders
 * below the table so a reviewer sees the record they are appending to.
 *
 * Admin surface: raw strings by design (not player copy — same as the dev
 * pages; the COPY module owns player-facing language only).
 */

import { useCallback, useState } from 'react';
import { canonicalReviewMessage } from '@blotto/detection/review-message';
import { indexerApi } from '@/data/api';
import type { EntryRow } from '@/data/types';
import { useAuth } from '@/wallet/auth-context';
import { decisionOutcome, type DecisionOutcome } from './decision-outcome';
import { ComplaintsPanel } from './complaints-panel';
import { detectionRequestMessage } from './detection-request';

const REVIEW_API = process.env.NEXT_PUBLIC_REVIEW_API_URL;

interface LoggedDecision {
  player: string;
  action: string;
  criterion: string;
  decidedBy: string;
  decidedAt: string;
}

/** One row of GET /pending — an upheld forfeit the chain does not carry. */
interface PendingForfeit {
  player: string;
  decidedBy: string;
  decidedAt: string;
  criterion: string;
  /** False when the service could not read an entry for this wallet. */
  entryFound: boolean;
}

/** What GET /detection answers (through our own proxy route). */
interface DetectionReport {
  pool: string;
  producedAt: string;
  reviewRecommended: string[];
  /** Reported, NEVER acted on — founder ruling D-E9. */
  hardBlocks: string[];
  findings: Array<{ signal: string; player: string; severity: string; detail: string }>;
}

export function ReviewClient() {
  const auth = useAuth();
  const [pool, setPool] = useState('');
  const [flagged, setFlagged] = useState<EntryRow[] | null>(null);
  const [log, setLog] = useState<LoggedDecision[]>([]);
  const [criterion, setCriterion] = useState('');
  /** The last decision's classified outcome — never a bare string, because
   * "recorded" and "landed on-chain but not logged" must not look alike. */
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null);
  const [pending, setPending] = useState<PendingForfeit[] | null>(null);
  const [report, setReport] = useState<DetectionReport | null>(null);
  const [reportNote, setReportNote] = useState<string | null>(null);

  /** Anything the page needs to say that is not a decision's outcome. */
  const setNote = (message: string, severity: DecisionOutcome['severity'] = 'refused') =>
    setOutcome({ kind: 'failed', severity, settled: false, message });

  const load = useCallback(async () => {
    setOutcome(null);
    const entries = await indexerApi().getEntries(pool);
    setFlagged(entries.filter((e) => e.flagged || e.escrow_settled !== null));
    if (REVIEW_API) {
      try {
        const res = await fetch(`${REVIEW_API}/decisions?pool=${encodeURIComponent(pool)}`);
        setLog(res.ok ? ((await res.json()) as { decisions: LoggedDecision[] }).decisions : []);
      } catch {
        setLog([]);
      }
      /*
       * C-07: upheld forfeits the chain does not carry yet. Between the
       * decision and the admin transaction that lands it, the share sits in
       * the vault under a decision nothing on-chain reflects — a state that
       * used to be visible nowhere.
       */
      try {
        const res = await fetch(`${REVIEW_API}/pending?pool=${encodeURIComponent(pool)}`);
        setPending(res.ok ? ((await res.json()) as { pending: PendingForfeit[] }).pending : null);
      } catch {
        setPending(null);
      }
    }
  }, [pool]);

  /*
   * The detection report (ruling D-E9: reported to the reviewer, never
   * acted on). It is operator-token-only, and that token must never reach a
   * browser bundle — so the page asks OUR OWN server route, which holds the
   * token and proves the caller is a reviewer before it uses it.
   */
  const loadReport = useCallback(async () => {
    setReportNote(null);
    setReport(null);
    if (auth.status !== 'signed-in' || !auth.walletAddress) {
      setReportNote('sign in with a reviewer wallet first');
      return;
    }
    const signer = auth.signers.find((s) => s.address === auth.walletAddress);
    if (!signer?.signMessage) {
      setReportNote('this wallet cannot sign messages, and the report is reviewer-only');
      return;
    }
    const requestedAt = new Date().toISOString();
    let signature: Uint8Array;
    try {
      signature = await signer.signMessage(
        detectionRequestMessage({ pool, reviewer: auth.walletAddress, requestedAt })
      );
    } catch {
      setReportNote('signing was declined — the report was not requested');
      return;
    }
    try {
      const res = await fetch('/api/detection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pool,
          reviewer: auth.walletAddress,
          requestedAt,
          signature: btoa(String.fromCharCode(...signature)),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 200) {
        setReport(body as unknown as DetectionReport);
        return;
      }
      setReportNote(
        res.status === 404
          ? 'no detection report has been produced for this pool yet'
          : res.status === 401
            ? 'refused: this wallet is not in the reviewer list, or the request was stale'
            : res.status === 503
              ? 'the detection report is not configured for this deployment (operator token absent)'
              : `failed: ${res.status}${typeof body.error === 'string' ? ` ${body.error}` : ''}`
      );
    } catch (e) {
      setReportNote(`failed: the report could not be fetched (${String(e)})`);
    }
  }, [auth, pool]);

  const act = async (
    player: string,
    action: 'clear' | 'forfeit' | 'release' | 'flag' | 'appeal_upheld' | 'appeal_dismissed'
  ) => {
    if (!REVIEW_API) {
      setNote('review service not configured (NEXT_PUBLIC_REVIEW_API_URL)', 'failed');
      return;
    }
    if (auth.status !== 'signed-in' || !auth.walletAddress) {
      setNote('sign in with a reviewer wallet first');
      return;
    }
    const signer = auth.signers.find((s) => s.address === auth.walletAddress);
    if (!signer?.signMessage) {
      setNote('this wallet cannot sign messages — decisions must be wallet-signed');
      return;
    }
    if (!criterion.trim()) {
      setNote('cite a published criterion before deciding');
      return;
    }
    const decidedAt = new Date().toISOString();
    let signature: Uint8Array;
    try {
      signature = await signer.signMessage(
        canonicalReviewMessage({
          pool,
          player,
          action,
          criterion: criterion.trim(),
          signedAt: decidedAt,
        })
      );
    } catch {
      setNote('signing was declined — nothing submitted');
      return;
    }
    let res: Response;
    try {
      res = await fetch(`${REVIEW_API}/decisions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pool,
          player,
          action,
          criterion: criterion.trim(),
          decidedBy: auth.walletAddress,
          decidedAt,
          signature: btoa(String.fromCharCode(...signature)),
        }),
      });
    } catch (e) {
      setOutcome({
        kind: 'failed',
        severity: 'failed',
        settled: false,
        message: `failed: the review service could not be reached (${String(e)})`,
      });
      return;
    }
    /*
     * B-24 / B-25: `res.ok` is NOT success any more. A 200 can mean the
     * chain action landed and the published log does not carry it, which is
     * the one outcome a reviewer must never read as done.
     */
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const result = decisionOutcome(action, player, res.status, body);
    setOutcome(result);
    if (result.settled) await load();
  };

  // Stage E: an entry has an OPEN appeal when its latest lodge follows its
  // latest forfeit and no appeal decision follows the lodge — the same rule
  // the service enforces (appeals.ts); the buttons merely offer it.
  const openAppeal = (player: string): boolean => {
    const rows = log.filter((d) => d.player === player);
    const last = (kinds: string[]) =>
      rows.filter((d) => kinds.includes(d.action)).map((d) => Date.parse(d.decidedAt)).sort((a, b) => b - a)[0];
    const forfeit = last(['forfeit']);
    const lodged = last(['appeal_lodged']);
    const decided = last(['appeal_upheld', 'appeal_dismissed']);
    return forfeit !== undefined && lodged !== undefined && lodged >= forfeit && !(decided !== undefined && decided >= lodged);
  };

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl">Review</h1>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border bg-transparent p-2 font-mono text-sm"
          placeholder="pool address"
          value={pool}
          onChange={(e) => setPool(e.target.value)}
        />
        <button type="button" className="rounded border px-4" onClick={load}>
          Load
        </button>
      </div>
      <input
        className="rounded border bg-transparent p-2 text-sm"
        placeholder="criterion the decision cites (from the published list)"
        value={criterion}
        onChange={(e) => setCriterion(e.target.value)}
      />
      {outcome && (
        <p
          data-testid="decision-outcome"
          data-severity={outcome.severity}
          className={
            'rounded border p-3 text-sm ' +
            (outcome.severity === 'ok'
              ? 'opacity-80'
              : outcome.severity === 'attention'
                ? 'border-amber-400 font-semibold'
                : outcome.severity === 'refused'
                  ? 'opacity-90'
                  : 'border-red-400')
          }
        >
          {outcome.message}
        </p>
      )}
      {flagged && flagged.length === 0 && <p className="opacity-70">Nothing flagged in this pool.</p>}
      {flagged && flagged.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="opacity-60">
              <th className="py-2">Player</th>
              <th>Seat</th>
              <th>State</th>
              <th className="text-right">Decision</th>
            </tr>
          </thead>
          <tbody>
            {flagged.map((e) => (
              <tr key={e.player} className="border-t">
                <td className="py-2 font-mono">{e.player.slice(0, 12)}…</td>
                <td>#{e.idx}</td>
                <td>{e.escrow_settled ?? (e.flagged ? 'flagged' : '—')}</td>
                <td className="text-right">
                  <div className="flex justify-end gap-2">
                    <button type="button" className="rounded border px-2 py-1" onClick={() => act(e.player, 'clear')}>
                      Clear
                    </button>
                    <button type="button" className="rounded border px-2 py-1" onClick={() => act(e.player, 'release')}>
                      Release
                    </button>
                    <button type="button" className="rounded border px-2 py-1" onClick={() => act(e.player, 'forfeit')}>
                      Forfeit
                    </button>
                    {openAppeal(e.player) && (
                      <>
                        <button type="button" className="rounded border px-2 py-1" onClick={() => act(e.player, 'appeal_upheld')}>
                          Uphold appeal
                        </button>
                        <button type="button" className="rounded border px-2 py-1" onClick={() => act(e.player, 'appeal_dismissed')}>
                          Dismiss appeal
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/* C-07: upheld forfeits the chain does not carry yet. The share sits
          in the vault under a decision nothing on-chain reflects, and until
          this panel that state was visible nowhere on the desk. */}
      {pending && pending.length > 0 && (
        <div data-testid="pending-forfeits" className="rounded border border-amber-400 p-3">
          <h2 className="mb-2 text-lg">Upheld forfeits the chain does not carry yet</h2>
          <p className="mb-2 text-sm opacity-80">
            Each of these is decided and logged. The share stays in the pool’s vault until an
            admin lands forfeit_escrow (scripts/admin.ts); the daemon refuses to release it in
            the meantime and alerts when the review window closes.
          </p>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="opacity-60">
                <th className="py-2">Player</th>
                <th>Decided at</th>
                <th>By</th>
                <th>Criterion</th>
                <th>Entry</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.player} className="border-t">
                  <td className="py-2 font-mono">{row.player.slice(0, 12)}…</td>
                  <td className="font-mono text-xs">{row.decidedAt}</td>
                  <td className="font-mono">{row.decidedBy.slice(0, 8)}…</td>
                  <td>{row.criterion}</td>
                  <td>{row.entryFound ? 'on-chain' : 'not readable'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* D-E9: the detection report is REPORTED to the reviewer and acted on
          by nobody. Behind our own server route, which holds the operator
          token and proves the caller is a reviewer first. */}
      <div className="rounded border p-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg">Detection report</h2>
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm"
            data-testid="load-report"
            onClick={loadReport}
            disabled={!pool.trim()}
          >
            Load for this pool
          </button>
        </div>
        <p className="mt-2 text-sm opacity-80">
          Signals computed over revealed data. Nothing here acts on anything and nothing here
          has flagged anything: a flag is a reviewer’s decision, cited to a published criterion
          (founder ruling D-E9). Your wallet signs the request because the report is
          reviewer-only.
        </p>
        {reportNote && <p className="mt-2 text-sm opacity-90">{reportNote}</p>}
        {report && (
          <div className="mt-3 flex flex-col gap-2 text-sm" data-testid="detection-report">
            <p className="opacity-70">Produced {report.producedAt}</p>
            <p>
              <strong>Review recommended:</strong>{' '}
              {report.reviewRecommended.length === 0
                ? 'nobody'
                : report.reviewRecommended.map((p) => `${p.slice(0, 8)}…`).join(', ')}
            </p>
            <p>
              <strong>Hard-block candidates (REPORTED ONLY — nothing acts on these):</strong>{' '}
              {report.hardBlocks.length === 0
                ? 'none'
                : report.hardBlocks.map((p) => `${p.slice(0, 8)}…`).join(', ')}
            </p>
            <table className="w-full text-left">
              <thead>
                <tr className="opacity-60">
                  <th className="py-2">Player</th>
                  <th>Signal</th>
                  <th>Severity</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {report.findings.map((f, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-2 font-mono">{f.player.slice(0, 12)}…</td>
                    <td>{f.signal}</td>
                    <td>{f.severity}</td>
                    <td>{f.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* The complaints desk. Its own module because it reads and writes a
          different record from the decision log above, through a different
          route, and shares nothing with it but this page and the reviewer
          gate on the door. */}
      <ComplaintsPanel />

      {log.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg">Decision log</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="opacity-60">
                <th className="py-2">At</th>
                <th>Player</th>
                <th>Action</th>
                <th>Criterion</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {log.map((d, i) => (
                <tr key={i} className="border-t">
                  <td className="py-2 font-mono text-xs">{d.decidedAt}</td>
                  <td className="font-mono">{d.player.slice(0, 8)}…</td>
                  <td>{d.action}</td>
                  <td>{d.criterion}</td>
                  <td className="font-mono">{d.decidedBy.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
