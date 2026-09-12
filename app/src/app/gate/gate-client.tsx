'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeNext } from '@/gate/gate';

/* The code form. The refusal message deliberately says nothing about WHY a
 * code failed — wrong code, empty body and unconfigured deployment are
 * indistinguishable from here, and that is the point. */
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">
          Blotto Cup
        </h1>
        <p className="mt-2 text-[15px] leading-6 text-ink-muted">
          This preview is invitation only. Enter your access code to continue.
        </p>
      </div>

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
          className="flex h-14 items-center justify-center rounded-xl bg-brand text-[17px] font-semibold text-(--color-base) transition-colors hover:bg-brand-hot disabled:opacity-40"
        >
          {state === 'checking' ? 'Checking…' : 'Continue'}
        </button>

        {state === 'refused' && (
          <p role="alert" className="text-[14px] leading-5 text-ink-muted">
            That code is not valid.
          </p>
        )}
      </div>
    </div>
  );
}
