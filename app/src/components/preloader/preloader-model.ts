/*
 * The first-visit preloader's logic, pure and DOM-free (preloader prompt
 * v2, "Behaviour (exact)"). The component is a thin shell over this
 * reducer, so every rule that matters — the gate, the 10-second settle,
 * the skip seek, the degrade-to-static paths, the 10.5 s guard that means
 * the preloader can never trap a visitor — is pinned by node-environment
 * tests with no browser in the loop.
 *
 * GATE RULE: the preloader exists on the SITE ROOT only, for visitors who
 * have not pressed Enter before (the flag is set on Enter — never on
 * Skip, never on load). Deep links never see it; returning visitors never
 * see it. Nothing here touches sealing, payment or any backend seam — it
 * is a curtain in front of the landing page, nothing more.
 */

export const PRELOADER_FLAG_KEY = 'blotto.preloader.seen';
export const PRELOADER_FLAG_VALUE = 'v2';

/** The video settles on the BLOTTO hold at 10 s; the last 5 s loop. */
export const SETTLE_AT_S = 10;
/** If the video cannot reach canplay in this window, fall to the poster. */
export const CANPLAY_TIMEOUT_MS = 1500;
/** Whatever happens, Enter is visible by 10.5 s from mount. */
export const ENTER_DEADLINE_MS = 10_500;

/** Root route + no v2 flag → show. Everything else → never. */
export function shouldShowPreloader(pathname: string, storedFlag: string | null): boolean {
  return pathname === '/' && storedFlag !== PRELOADER_FLAG_VALUE;
}

/**
 * playing — state A: video running, quiet Skip pill.
 * settled — state B: video looping its last 5 s, Enter visible.
 * static  — state C: settle poster, Enter visible, no video at all
 *           (reduced motion, save-data, video error, or slow network).
 * leaving — Enter pressed: flag set, 300 ms fade, then unmount.
 */
export type PreloaderPhase = 'playing' | 'settled' | 'static' | 'leaving';

export type PreloaderEvent =
  | { type: 'timeupdate'; currentTime: number }
  | { type: 'skip' }
  | { type: 'ended' }
  | { type: 'video-error' }
  | { type: 'canplay-timeout' }
  | { type: 'deadline' }
  | { type: 'enter' };

export interface PreloaderState {
  phase: PreloaderPhase;
  /** A seek the component must apply to the video, once per seq. */
  seek: { to: number; seq: number } | null;
}

/** noMotion = prefers-reduced-motion OR navigator.connection.saveData. */
export function initialPreloaderState(noMotion: boolean): PreloaderState {
  return { phase: noMotion ? 'static' : 'playing', seek: null };
}

export function reducePreloader(state: PreloaderState, ev: PreloaderEvent): PreloaderState {
  const { phase } = state;
  if (phase === 'leaving') return state; // the exit is irreversible

  switch (ev.type) {
    case 'enter':
      // Enter is only offered once settled/static, and it always works.
      if (phase === 'settled' || phase === 'static') return { ...state, phase: 'leaving' };
      return state;

    case 'skip':
      // Skip jumps the film to the settle hold — it never sets the flag.
      if (phase === 'playing') return { phase: 'settled', seek: nextSeek(state, SETTLE_AT_S) };
      return state;

    case 'timeupdate':
      if (phase === 'playing' && ev.currentTime >= SETTLE_AT_S) {
        return { ...state, phase: 'settled' };
      }
      return state;

    case 'deadline':
      // The 10.5 s guard: if playback stalled short of the settle point,
      // force the settled state anyway. The preloader never traps.
      if (phase === 'playing') return { phase: 'settled', seek: nextSeek(state, SETTLE_AT_S) };
      return state;

    case 'ended':
      // Loop the last five seconds while the visitor decides.
      if (phase === 'settled' || phase === 'playing') {
        return { phase: 'settled', seek: nextSeek(state, SETTLE_AT_S) };
      }
      return state;

    case 'video-error':
    case 'canplay-timeout':
      // Degrade to the poster. If the film already settled, the loop dying
      // quietly leaves the still frame — same picture, so stay put.
      if (phase === 'playing') return { phase: 'static', seek: null };
      return state;

    default:
      return state;
  }
}

function nextSeek(state: PreloaderState, to: number): { to: number; seq: number } {
  return { to, seq: (state.seek?.seq ?? 0) + 1 };
}
