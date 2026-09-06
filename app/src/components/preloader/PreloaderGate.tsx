'use client';

/*
 * The gate around <Preloader />: root route, first visit only. Mounted
 * from the root page alone, so deep links can never see the curtain even
 * before the flag check runs — the route rule is structural, the flag
 * rule is here.
 *
 * useSyncExternalStore keeps hydration honest: the server snapshot says
 * "no preloader", the client snapshot reads the real flag after
 * hydration, and pressing Enter notifies the store instead of poking
 * component state from a storage side-effect.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { PRELOADER_FLAG_KEY, shouldShowPreloader } from './preloader-model';
import { Preloader } from './Preloader';

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function readFlag(): string | null {
  try {
    return localStorage.getItem(PRELOADER_FLAG_KEY);
  } catch {
    // Storage unreadable (private mode / blocked): show the curtain once
    // per load — the safe direction is showing it, never trapping.
    return null;
  }
}

function snapshot(): boolean {
  return shouldShowPreloader(window.location.pathname, readFlag());
}

export function PreloaderGate() {
  const show = useSyncExternalStore(subscribe, snapshot, () => false);
  const done = useCallback(() => {
    // The flag was written by Enter; re-read it through the store.
    for (const cb of listeners) cb();
  }, []);
  if (!show) return null;
  return <Preloader onDone={done} />;
}
