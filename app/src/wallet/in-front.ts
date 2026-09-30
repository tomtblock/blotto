/*
 * "Is this page in front?" — the wait a mobile wallet prompt takes before it
 * launches (2026-09-30, found on an emulator inside the Android shell).
 *
 * THE RACE. The mobile wallet standard reaches the wallet app through an
 * Android intent (`solana-wallet://…`) and one wallet SESSION per request:
 * connect is a session, a signature is another. The wallet answers over the
 * loopback socket a moment BEFORE its own screen has closed. A browser will
 * not fire an external intent from a page that is not in front, so in
 * Chrome the next session waits until the wallet is gone. The shell's
 * WebView fires it at once — into the wallet activity that is still on top,
 * mid-teardown — and Phantom, tearing the first session down, revokes the
 * token the second one just received ("Revoking AuthRecord", then the
 * sign-in page again). Deterministic on a slow emulator; a race everywhere.
 *
 * THE RULE. No wallet prompt launches while the page is not in front: wait
 * for the page to be visible and focused, then a short grace for the
 * wallet's activity to finish closing, then go. If the page never reports
 * itself in front, go anyway after a ceiling — this must never hold a
 * prompt hostage to a WebView that does not fire focus events.
 *
 * Applied on the mobile channel only (direct-session.tsx): on the web the
 * wallet is an extension whose popup never covers the page's activity, and
 * the web path must stay exactly what it was.
 *
 * Pure core (`whenInFront`, an injectable view of the page) so it is
 * unit-tested with fake timers; `pageInFront` binds it to the browser.
 */

export interface PageView {
  /** `document.visibilityState === 'visible'`. */
  visible(): boolean;
  /** `document.hasFocus()`; a page that cannot say is taken as focused. */
  focused(): boolean;
  /** Subscribe to the events that can bring the page in front; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
}

export interface InFrontOptions {
  /** How long to wait for the page to come in front before going anyway. */
  maxWaitMs: number;
  /** After the page came in front, the time the wallet's screen takes to finish closing. */
  graceMs: number;
}

// PHASE-N-REVIEW (2026-09-30): implementation timing, not a product number.
// 300 ms grace: on the emulator the wallet's session teardown logged within
// tens of milliseconds of its answer; 300 ms covers a slow device without
// being felt. 2500 ms ceiling: comfortably past any activity transition, and
// bounded so a WebView that never fires focus costs at most that per prompt.
export const IN_FRONT_DEFAULTS: InFrontOptions = { maxWaitMs: 2500, graceMs: 300 };

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves once the page is in front (visible and focused) plus the grace,
 * or after the ceiling, whichever comes first. Resolves at once when the
 * page is already in front: a first prompt from a tap pays nothing.
 */
export async function whenInFront(view: PageView, options: InFrontOptions = IN_FRONT_DEFAULTS): Promise<void> {
  const inFront = (): boolean => view.visible() && view.focused();
  if (inFront()) return;

  const cameInFront = await new Promise<boolean>((resolve) => {
    let off: () => void = () => {};
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, options.maxWaitMs);
    off = view.onChange(() => {
      if (!inFront()) return;
      clearTimeout(timer);
      off();
      resolve(true);
    });
  });
  if (cameInFront) await delay(options.graceMs);
}

/** The browser's own view of the page. */
export function browserPageView(): PageView {
  return {
    visible: () => document.visibilityState === 'visible',
    focused: () => (typeof document.hasFocus === 'function' ? document.hasFocus() : true),
    onChange: (listener) => {
      window.addEventListener('focus', listener);
      document.addEventListener('visibilitychange', listener);
      return () => {
        window.removeEventListener('focus', listener);
        document.removeEventListener('visibilitychange', listener);
      };
    },
  };
}

/** The wait a mobile wallet prompt takes before it launches, bound to this page. */
export const pageInFront = (): Promise<void> => whenInFront(browserPageView());
