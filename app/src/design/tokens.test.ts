/*
 * The two-file parity gate (D1): `tokens.ts` is canonical; `tokens.css` is
 * its CSS mirror. Every palette hex, easing and duration must appear in the
 * CSS with the same value — a token edited in one file without the other
 * fails here instead of shipping a two-faced design system.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { motion, palette } from './tokens';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

/** tokens.ts camelCase → tokens.css custom-property name. */
function cssName(token: string): string {
  return `--color-${token.replace(/([A-Z])/g, '-$1').replace(/([a-z])([0-9])/g, '$1-$2').toLowerCase()}`;
}

describe('design token parity (tokens.ts ↔ tokens.css)', () => {
  it('every palette value appears in the CSS under its derived name', () => {
    // Plain substring matching (`name: value;`) rather than a constructed
    // pattern: the trailing semicolon stops a shorter hex matching a longer
    // one, and both files keep hex values lowercase.
    for (const [token, hex] of Object.entries(palette)) {
      const name = cssName(token);
      expect(css.toLowerCase(), `${name} should be ${hex}`).toContain(
        `${name}: ${hex.toLowerCase()};`
      );
    }
  });

  it('every easing appears verbatim', () => {
    const cssEase: Record<string, string> = {
      out: '--ease-out',
      inOut: '--ease-in-out',
    };
    for (const [name, value] of Object.entries(motion.easing)) {
      expect(css, cssEase[name]).toContain(`${cssEase[name]}: ${value}`);
    }
  });

  it('every motion duration appears in ms', () => {
    const cssDuration: Record<string, string> = {
      fast: '--duration-fast',
      base: '--duration-base',
      slow: '--duration-slow',
    };
    for (const [name, ms] of Object.entries(motion.duration)) {
      expect(css).toContain(`${cssDuration[name]}: ${ms}ms`);
    }
  });

  it('the grammar vocabulary is exposed as animate-* utilities', () => {
    for (const name of [
      'light-in',
      'light-pass',
      'stamp',
      'warmth-rise',
      'enter',
      'enter-fast',
      'exit',
      'verify-shake',
    ]) {
      expect(css).toContain(`--animate-${name}:`);
    }
    for (const name of [
      'light-in',
      'light-pass',
      'stamp',
      'warmth-rise',
      'enter',
      'exit-fade',
      'verify-shake',
    ]) {
      expect(css).toContain(`@keyframes ${name} `);
    }
  });

  it('FROST is the only blur on the site', () => {
    // The frost crossfade animates opacity between a sharp and a
    // pre-blurred layer; no stylesheet may animate or transition a blur.
    expect(css).not.toMatch(/transition:[^;]*filter/);
    expect(css).toContain('.frost-veil');
    expect(css).toContain('.frost-sharp');
  });

  it('no hex colour exists in the CSS that tokens.ts does not know', () => {
    const cssHexes = [...css.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase());
    const known = new Set(Object.values(palette).map((v) => v.toLowerCase()));
    for (const hex of cssHexes) {
      expect(known.has(hex), `${hex} in tokens.css is not in tokens.ts`).toBe(true);
    }
  });
});
