'use client';

/*
 * Tabs (V2, founder 2026-09-27: "tab and toggle rather than a long page").
 * One section on screen at a time, a tab strip above it, and — because the
 * terms and the privacy notice are documents a reader (or counsel) may want
 * whole — an optional "Read as one page" switch that lays every section out
 * in order. Also the profile's Wallet / Record / Prize record / Battle notes.
 *
 * The chosen tab is remembered in the URL hash (a bare token), so a link to
 * `/rules#scoring` opens on that tab and the browser's back button works.
 * Nothing here reads or writes storage.
 */

import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { COPY } from '@/copy';

export interface Tab {
  /** URL-safe token; becomes the hash and the ids. */
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  tabs: readonly Tab[];
  /** The strip's accessible name. */
  label: string;
  /** Offer "Read as one page" (documents); off for app screens. */
  allowAll?: boolean;
  /** `cream` strip on a plum surface; `berry` on the pink field. */
  tone?: 'cream' | 'berry';
  /** Sync the chosen tab with `location.hash` (documents); off for app screens. */
  hash?: boolean;
  initial?: string;
  className?: string;
}

const STRIP: Record<NonNullable<TabsProps['tone']>, { on: string; off: string; rail: string }> = {
  cream: {
    on: 'bg-brand-cream text-brand-berry',
    off: 'text-brand-cream/80 hover:bg-white/10 hover:text-brand-cream',
    rail: 'border-white/20',
  },
  berry: {
    on: 'bg-brand-berry text-brand-cream',
    off: 'text-brand-berry hover:bg-brand-berry/10',
    rail: 'border-brand-berry/30',
  },
};

function readHash(): string | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hash.replace(/^#/, '');
  return /^[A-Za-z0-9._~-]+$/.test(h) ? h : null;
}

export function Tabs({ tabs, label, allowAll = false, tone = 'berry', hash = false, initial, className = '' }: TabsProps) {
  const id = useId();
  const first = tabs[0]?.id ?? '';
  const [current, setCurrent] = useState<string>(() => {
    const fromHash = hash ? readHash() : null;
    if (fromHash && tabs.some((t) => t.id === fromHash)) return fromHash;
    return initial && tabs.some((t) => t.id === initial) ? initial : first;
  });
  const [all, setAll] = useState(false);

  // A hash typed or followed after mount (a link inside the document).
  useEffect(() => {
    if (!hash) return;
    const onHash = () => {
      const h = readHash();
      if (h && tabs.some((t) => t.id === h)) {
        setCurrent(h);
        setAll(false);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [hash, tabs]);

  const choose = (tabId: string) => {
    setCurrent(tabId);
    setAll(false);
    if (hash && typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${tabId}`);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.id === current);
    if (at === -1) return;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (at + 1) % tabs.length;
    if (e.key === 'ArrowLeft') next = (at - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    choose(tabs[next]!.id);
    document.getElementById(`${id}-tab-${tabs[next]!.id}`)?.focus();
  };

  const s = STRIP[tone];
  return (
    <div className={`flex flex-col gap-5 ${className}`}>
      <div className={`flex flex-wrap items-center gap-2 border-b pb-3 ${s.rail}`}>
        <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex flex-wrap gap-1">
          {tabs.map((t) => {
            const on = !all && t.id === current;
            return (
              <button
                key={t.id}
                id={`${id}-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={`${id}-panel-${t.id}`}
                tabIndex={on ? 0 : -1}
                onClick={() => choose(t.id)}
                className={
                  'rounded-full px-3.5 py-1.5 font-display text-[14px] font-bold uppercase tracking-wide ' +
                  'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-cream ' +
                  (on ? s.on : s.off)
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {allowAll ? (
          <button
            type="button"
            aria-pressed={all}
            onClick={() => setAll((a) => !a)}
            className={
              'ml-auto rounded-full px-3 py-1.5 text-[12px] underline underline-offset-2 ' +
              (tone === 'berry' ? 'text-brand-berry' : 'text-brand-cream/80')
            }
          >
            {all ? COPY.shell.tabsOneAtATime : COPY.shell.tabsReadAsOnePage}
          </button>
        ) : null}
      </div>
      {tabs.map((t) => {
        const shown = all || t.id === current;
        return (
          <section
            key={t.id}
            id={`${id}-panel-${t.id}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${t.id}`}
            hidden={!shown}
            className="flex flex-col gap-4"
          >
            {all ? (
              <h2 className="font-display text-[24px] leading-7 font-extrabold text-brand-berry">{t.label}</h2>
            ) : null}
            {shown ? t.content : null}
          </section>
        );
      })}
    </div>
  );
}
