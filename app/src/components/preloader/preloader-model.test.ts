/*
 * The preloader's behaviour rules, pinned (preloader prompt v2 "Tests").
 * The one that matters most: NOTHING can keep Enter away past 10.5 s, and
 * nobody who has entered once ever sees the curtain again.
 */
import { describe, expect, it } from 'vitest';
import {
  PRELOADER_FLAG_VALUE,
  SETTLE_AT_S,
  initialPreloaderState,
  reducePreloader,
  shouldShowPreloader,
  type PreloaderState,
} from './preloader-model';

describe('the gate', () => {
  it('shows on the root route when the flag is absent', () => {
    expect(shouldShowPreloader('/', null)).toBe(true);
  });
  it('never shows for a returning visitor (flag v2)', () => {
    expect(shouldShowPreloader('/', PRELOADER_FLAG_VALUE)).toBe(false);
  });
  it('shows again when the flag is from an older preloader version', () => {
    expect(shouldShowPreloader('/', 'v1')).toBe(true);
  });
  it('never gates deep links, whatever the flag says', () => {
    for (const path of ['/pools', '/pools/abc', '/verify', '/rules', '/play', '/profile']) {
      expect(shouldShowPreloader(path, null)).toBe(false);
    }
  });
});

describe('the film', () => {
  const playing = () => initialPreloaderState(false);

  it('stays playing before the settle point', () => {
    const s = reducePreloader(playing(), { type: 'timeupdate', currentTime: 9.96 });
    expect(s.phase).toBe('playing');
  });

  it('settles the moment currentTime reaches 10 — Enter appears', () => {
    const s = reducePreloader(playing(), { type: 'timeupdate', currentTime: SETTLE_AT_S });
    expect(s.phase).toBe('settled');
    expect(s.seek).toBeNull(); // no jump: the film is already there
  });

  it('Skip jumps to the settle hold and shows Enter — and does NOT set the flag', () => {
    const s = reducePreloader(playing(), { type: 'skip' });
    expect(s.phase).toBe('settled');
    expect(s.seek).toEqual({ to: SETTLE_AT_S, seq: 1 });
    // Flag writing lives in the component's ENTER handler alone; the model
    // has no flag at all, which is the structural version of "not on Skip".
  });

  it('loops the last five seconds while the visitor decides', () => {
    let s = reducePreloader(playing(), { type: 'timeupdate', currentTime: 10.2 });
    s = reducePreloader(s, { type: 'ended' });
    expect(s.phase).toBe('settled');
    expect(s.seek?.to).toBe(SETTLE_AT_S);
    const seq1 = s.seek?.seq;
    s = reducePreloader(s, { type: 'ended' });
    expect(s.seek?.seq).toBe((seq1 ?? 0) + 1); // each loop is a fresh seek
  });

  it('the 10.5 s guard forces Enter even if playback stalls', () => {
    const s = reducePreloader(playing(), { type: 'deadline' });
    expect(s.phase).toBe('settled');
    expect(s.seek?.to).toBe(SETTLE_AT_S);
  });
});

describe('degrading to the poster (state C)', () => {
  it('reduced motion / save-data start static: no video, Enter immediately', () => {
    expect(initialPreloaderState(true).phase).toBe('static');
  });
  it('a video error falls to the poster', () => {
    expect(reducePreloader(initialPreloaderState(false), { type: 'video-error' }).phase).toBe('static');
  });
  it('a canplay timeout falls to the poster', () => {
    expect(reducePreloader(initialPreloaderState(false), { type: 'canplay-timeout' }).phase).toBe(
      'static'
    );
  });
  it('an error AFTER settling keeps the settled still — same picture, no churn', () => {
    let s = reducePreloader(initialPreloaderState(false), { type: 'timeupdate', currentTime: 11 });
    s = reducePreloader(s, { type: 'video-error' });
    expect(s.phase).toBe('settled');
  });
});

describe('Enter', () => {
  it('works from settled and from static, and the exit is irreversible', () => {
    for (const start of ['settled', 'static'] as const) {
      let s: PreloaderState = { phase: start, seek: null };
      s = reducePreloader(s, { type: 'enter' });
      expect(s.phase).toBe('leaving');
      // Nothing moves it after that — not errors, not time, not skip.
      for (const ev of [
        { type: 'skip' } as const,
        { type: 'video-error' } as const,
        { type: 'timeupdate', currentTime: 14 } as const,
        { type: 'deadline' } as const,
      ]) {
        expect(reducePreloader(s, ev).phase).toBe('leaving');
      }
    }
  });
  it('does nothing while still playing — Enter is not on screen yet', () => {
    expect(reducePreloader(initialPreloaderState(false), { type: 'enter' }).phase).toBe('playing');
  });
});
