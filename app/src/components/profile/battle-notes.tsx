'use client';

/*
 * Battle notes (V2, founder 2026-09-27): a place for a player's own notes
 * for their next entry. Saved in THIS browser, per wallet, and nowhere
 * else — there is no store for it on the backend, and the privacy notice
 * lists what we hold; notes are not on that list and this keeps it that way.
 * The key is opaque (storage/opaque-key.ts): it names neither the purpose
 * nor the wallet.
 */

import { useId, useState } from 'react';
import { COPY } from '@/copy';
import { opaqueKey } from '@/storage/opaque-key';
import { Button } from '@/components/ui/button';

function read(key: string | null): string | null {
  if (key === null) return null;
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return null;
  }
}

export function BattleNotes({ wallet }: { wallet: string }) {
  const id = useId();
  const key = opaqueKey('battle-notes', wallet);
  // Mounted client-side only (the notes tab renders on a tap, never on the
  // server), so the stored text is read once as the initial state.
  const [text, setText] = useState<string>(() => read(key) ?? '');
  const [state, setState] = useState<'clean' | 'dirty' | 'saved' | 'unavailable'>(() =>
    read(key) === null ? 'unavailable' : 'clean'
  );

  const save = () => {
    if (key === null) return;
    try {
      localStorage.setItem(key, text);
      setState('saved');
    } catch {
      setState('unavailable');
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="battle-notes">
      <p className="max-w-prose text-[14px] leading-5 text-ink-muted">{COPY.profile.notesLine}</p>
      <label htmlFor={id} className="sr-only">
        {COPY.profile.notesTitle}
      </label>
      <textarea
        id={id}
        value={text}
        disabled={state === 'unavailable'}
        onChange={(e) => {
          setText(e.target.value);
          setState('dirty');
        }}
        placeholder={COPY.profile.notesPlaceholder}
        rows={8}
        className="w-full rounded-2xl border border-white/15 bg-black/20 px-4 py-3 text-[15px] leading-6 text-ink placeholder:text-ink-muted/70 focus:border-brand focus:outline-none disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button intent="cream" onClick={save} disabled={state !== 'dirty'} data-testid="battle-notes-save">
          {COPY.profile.notesSave}
        </Button>
        <span role="status" className="text-[13px] text-ink-muted">
          {state === 'saved' ? COPY.profile.notesSaved : state === 'unavailable' ? COPY.profile.notesUnavailable : ''}
        </span>
      </div>
    </div>
  );
}
