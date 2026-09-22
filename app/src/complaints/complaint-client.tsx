'use client';

/*
 * The complaint form's state: the draft, the submission, and the status
 * lookup. The rendering is `complaint-form.tsx` and `complaint-status.tsx`,
 * pure functions of that state, so every ending — including a service that
 * is absent or cannot be reached — is a rendering that can be asserted on
 * (the C-04 pattern the appeal panel established).
 *
 * The signed-in wallet is used where it exists and is not required where it
 * does not: a complaint about a decision or a payment is signed by the
 * wallet it concerns, and everything else can be sent by a player who cannot
 * get into their wallet at all.
 */

import { useState } from 'react';
import { useAuth } from '@/wallet/auth-context';
import {
  fetchComplaintStatus,
  mintReference,
  submitComplaint,
  type ComplaintCategory,
  type ComplaintOutcome,
  type ComplaintStatusRead,
} from './complaint';
import { ComplaintForm } from './complaint-form';
import { ComplaintStatusPanel } from './complaint-status';

const REVIEW_API = process.env.NEXT_PUBLIC_REVIEW_API_URL;

export function ComplaintClient({
  /** Pre-selected category — the results page opens on `decision`. */
  initialCategory = 'other',
  /** The pool it is about, when the caller knows one. */
  pool = null,
  heading,
  lead,
  /** The status lookup belongs on the standalone page, not inline. */
  withStatusLookup = false,
}: {
  initialCategory?: ComplaintCategory;
  pool?: string | null;
  heading?: string;
  lead?: string;
  withStatusLookup?: boolean;
}) {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const signer = wallet !== null ? auth.signers.find((s) => s.address === wallet) : undefined;

  const [category, setCategory] = useState<ComplaintCategory>(initialCategory);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ComplaintOutcome | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const [lookupRef, setLookupRef] = useState('');
  const [lookup, setLookup] = useState<ComplaintStatusRead | 'idle' | 'loading'>('idle');

  const submit = async () => {
    setBusy(true);
    const result = await submitComplaint(
      REVIEW_API,
      { category, text: text.trim(), pool },
      { wallet, signer },
      fetch,
      mintReference()
    );
    setOutcome(result.outcome);
    setReference(result.reference);
    setBusy(false);
  };

  const check = async () => {
    setLookup('loading');
    setLookup(await fetchComplaintStatus(REVIEW_API, lookupRef.trim().toUpperCase(), wallet));
  };

  return (
    <>
      <ComplaintForm
        category={category}
        text={text}
        pool={pool}
        busy={busy}
        outcome={outcome}
        reference={reference}
        canSign={Boolean(wallet && signer?.signMessage)}
        heading={heading}
        lead={lead}
        onCategoryChange={setCategory}
        onTextChange={setText}
        onSubmit={() => void submit()}
      />
      {withStatusLookup && (
        <ComplaintStatusPanel
          reference={lookupRef}
          read={lookup}
          onReferenceChange={setLookupRef}
          onCheck={() => void check()}
        />
      )}
    </>
  );
}
