'use client';

/*
 * The complaints desk (2026-09-22) — the panel on the admin review page that
 * makes the published response windows keepable.
 *
 * Until this, nothing in the repository could append an `acknowledged` or a
 * `resolved` row, so a player checking their reference read *received*
 * however promptly a person had actually answered. The terms publish five
 * working days to acknowledge and thirty days to answer; a window nobody can
 * record meeting is a window we look to have missed.
 *
 * Plain markup, matching the rest of this page rather than the player-facing
 * pages: this is the operator's desk, it is behind the reviewer gate, and it
 * is the one surface in the product where clarity beats styling outright.
 * All logic is in `complaints-desk.ts` and unit-tested there; this renders
 * its values and nothing else.
 *
 * WHAT IS ON SCREEN AND WHY. The complainant's own words in full, because
 * answering half a complaint is worse than not answering it. Whether they
 * SIGNED, because that is what decides how much weight the desk can put on
 * an address. And the two published windows, read from the service's own
 * constants rather than typed here.
 */

import { useCallback, useState } from 'react';
import { COPY } from '@/copy';
import { useAuth } from '@/wallet/auth-context';
import {
  answerComplaint,
  loadComplaintQueue,
  noteValid,
  type AnswerOutcome,
  type QueueRead,
  type QueuedComplaint,
} from './complaints-desk';

const REVIEW_API = process.env.NEXT_PUBLIC_REVIEW_API_URL;

/** One line per ending of a queue read. Said plainly; an operator reads it. */
const QUEUE_NOTE: Record<Exclude<QueueRead['kind'], 'queue'>, string> = {
  cannot_sign: 'sign in with a reviewer wallet that can sign messages — the queue is reviewer-only',
  declined: 'signing was declined, so the queue was not requested',
  unauthorized: 'refused: this wallet is not in the reviewer list, or the request was stale',
  not_configured:
    'the complaints queue is not configured for this deployment (operator token or review URL absent)',
  unreachable: 'the complaints queue could not be read — nothing was changed',
};

/** One line per ending of an answer. Each says what actually happened. */
const ANSWER_NOTE: Record<AnswerOutcome, string> = {
  recorded: 'recorded — the player’s status now follows it',
  cannot_sign: 'this wallet cannot sign messages, and an answer must be signed to be attributable',
  declined: 'signing was declined, so nothing was recorded',
  unauthorized: 'refused: not a reviewer key, a bad signature, or a stale request',
  not_found: 'no complaint carries that reference',
  already_recorded: 'that exact answer is already on the thread. Nothing was recorded twice',
  malformed: 'the service would not accept that answer — check the reference and the note',
  not_configured: 'the complaints service is not configured for this deployment',
  unreachable: 'the complaints service could not be reached — nothing was recorded',
};

export function ComplaintsPanel() {
  const auth = useAuth();
  const reviewer = auth.status === 'signed-in' ? auth.walletAddress : null;
  const signer = reviewer !== null ? auth.signers.find((s) => s.address === reviewer) : undefined;

  const [read, setRead] = useState<QueueRead | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which complaint is being answered, and with what. */
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [answerNote, setAnswerNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setAnswerNote(null);
    setRead(await loadComplaintQueue(reviewer, signer));
    setBusy(false);
  }, [reviewer, signer]);

  const send = useCallback(
    async (reference: string, kind: 'acknowledged' | 'resolved') => {
      setBusy(true);
      const outcome = await answerComplaint(REVIEW_API, reviewer, signer, {
        reference,
        kind,
        note,
      });
      setAnswerNote(`${reference}: ${ANSWER_NOTE[outcome]}`);
      setBusy(false);
      if (outcome === 'recorded') {
        setOpenRef(null);
        setNote('');
        // Re-read, so the desk sees the queue it has actually left behind
        // rather than the one it started from.
        setRead(await loadComplaintQueue(reviewer, signer));
      }
    },
    [reviewer, signer, note]
  );

  return (
    <div data-testid="complaints-desk">
      <h2 className="mb-2 text-lg">{COPY.complaints.title}</h2>
      <p className="text-sm opacity-80">
        Complaints players have sent, oldest answer first to go. Reading this asks your wallet to
        sign, because it is other people’s words; answering asks again, because the answer is
        recorded under your key.
      </p>

      <button
        type="button"
        onClick={() => void load()}
        disabled={busy}
        data-testid="complaints-load"
        className="mt-3 rounded border px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {busy ? 'working…' : 'Load the queue'}
      </button>

      {read !== null && read.kind !== 'queue' && (
        <p className="mt-2 text-sm opacity-90" data-testid="complaints-queue-note">
          {QUEUE_NOTE[read.kind]}
        </p>
      )}
      {answerNote && (
        <p className="mt-2 text-sm opacity-90" data-testid="complaints-answer-note">
          {answerNote}
        </p>
      )}

      {read !== null && read.kind === 'queue' && (
        <div className="mt-3 flex flex-col gap-3 text-sm" data-testid="complaints-queue">
          <p className="opacity-70">
            {read.open.length === 0
              ? 'Nothing open. Every complaint sent has been answered.'
              : `${read.open.length} open. Acknowledge within ${read.acknowledgeWorkingDays} working days, answer within ${read.resolveDays} days.`}
          </p>
          {read.open.map((c) => (
            <Row
              key={c.reference}
              complaint={c}
              busy={busy}
              expanded={openRef === c.reference}
              note={openRef === c.reference ? note : ''}
              onExpand={() => {
                setOpenRef(openRef === c.reference ? null : c.reference);
                setNote('');
                setAnswerNote(null);
              }}
              onNote={setNote}
              onSend={(kind) => void send(c.reference, kind)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  complaint: c,
  busy,
  expanded,
  note,
  onExpand,
  onNote,
  onSend,
}: {
  complaint: QueuedComplaint;
  busy: boolean;
  expanded: boolean;
  note: string;
  onExpand: () => void;
  onNote: (note: string) => void;
  onSend: (kind: 'acknowledged' | 'resolved') => void;
}) {
  return (
    <div className="rounded border p-3" data-testid={`complaint-${c.reference}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono">{c.reference}</span>
        <span>{COPY.complaints.categories[c.category]}</span>
        <span className="text-xs opacity-60">{c.receivedAt}</span>
        {/* Whether the complainant proved the address, which is what decides
            how much weight the desk can put on it. */}
        <span className="text-xs opacity-80">
          {c.signed ? `signed by ${c.wallet?.slice(0, 8)}…` : 'sent without a signature'}
        </span>
        {c.pool && <span className="font-mono text-xs opacity-60">pool {c.pool.slice(0, 8)}…</span>}
      </div>

      {/* Their own words, in full and never truncated: answering half a
          complaint is worse than not answering it. */}
      <p className="mt-2 whitespace-pre-wrap">{c.text}</p>

      <button
        type="button"
        onClick={onExpand}
        className="mt-2 rounded border px-3 py-1 text-sm"
        data-testid={`complaint-answer-${c.reference}`}
      >
        {expanded ? 'Close' : 'Answer this'}
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          <label className="text-xs uppercase tracking-wide opacity-60" htmlFor={`note-${c.reference}`}>
            What the player is told
          </label>
          <textarea
            id={`note-${c.reference}`}
            data-testid={`complaint-note-${c.reference}`}
            className="min-h-24 rounded border bg-transparent p-2"
            value={note}
            onChange={(e) => onNote(e.target.value)}
          />
          <p className="text-xs opacity-70">
            This is signed with the note in it, so it cannot be changed afterwards without signing
            again.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !noteValid(note)}
              onClick={() => onSend('acknowledged')}
              data-testid={`complaint-ack-${c.reference}`}
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Acknowledge
            </button>
            <button
              type="button"
              disabled={busy || !noteValid(note)}
              onClick={() => onSend('resolved')}
              data-testid={`complaint-resolve-${c.reference}`}
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Answer and close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
