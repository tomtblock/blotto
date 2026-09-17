'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeNext } from '@/gate/gate';

/* The code form, and nothing else.
 *
 * The heading and lead sentence moved to the server component on 2026-09-13
 * (see page.tsx): `useSearchParams()` keeps this subtree out of the prerender,
 * so anything rendered here is invisible until the client bundle arrives, and
 * on the day the bundle was refused that meant an entirely blank page. Only
 * what genuinely needs interactivity belongs in here.
 *
 * The refusal message deliberately says nothing about WHY a code failed —
 * wrong code, empty body and unconfigured deployment are indistinguishable
 * from here, and that is the point. */
export function GateClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'refused'>('idle');

  async function submit() {
    if (code.trim() === '' || state === 'checking') return;
    setState('checking');
    const res = await fetch('/api/gate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }).catch(() => null);

    if (res?.ok) {
      router.replace(safeNext(params.get('next')));
      router.refresh();
      return;
    }
    setState('refused');
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="password"
        inputMode="text"
        autoComplete="off"
        autoFocus
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          if (state === 'refused') setState('idle');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
        placeholder="Access code"
        aria-label="Access code"
        aria-invalid={state === 'refused'}
        className="h-14 rounded-xl border border-line bg-transparent px-4 text-[17px] text-ink outline-none transition-colors focus:border-brand"
      />

      <button
        type="button"
        onClick={() => void submit()}
        disabled={state === 'checking' || code.trim() === ''}
        className="key-action flex h-14 items-center justify-center rounded-full border-[3px] border-brand-cream bg-brand font-display text-[18px] font-bold uppercase tracking-wide text-(--color-base) transition-colors hover:bg-brand-hot disabled:opacity-40"
      >
        {state === 'checking' ? 'Checking…' : 'Continue'}
      </button>

      {state === 'refused' && (
        <p role="alert" className="text-[14px] leading-5 text-ink-muted">
          That code is not valid.
        </p>
      )}
    </div>
  );
}
