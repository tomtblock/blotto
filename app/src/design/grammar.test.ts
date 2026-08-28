/*
 * Grammar ↔ stylesheet parity. Every class name the grammar module hands to
 * components must exist in tokens.css (as an --animate-* utility or a plain
 * class), so a rename in one file without the other fails here instead of
 * silently shipping motionless markup.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { light, micro, verifyShake, warmth, weight } from './grammar';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

/** `animate-light-in` → `--animate-light-in:`; plain classes → `.name`. */
function cssAnchor(className: string): string {
  return className.startsWith('animate-')
    ? `--${className}:`
    : `.${className}`;
}

describe('motion grammar parity (grammar.ts ↔ tokens.css)', () => {
  it('every grammar class is defined in the stylesheet', () => {
    const classes = [
      ...Object.values(light),
      ...Object.values(weight),
      ...Object.values(warmth),
      ...Object.values(micro),
      verifyShake,
    ];
    for (const name of classes) {
      expect(css, name).toContain(cssAnchor(name));
    }
  });

  it('no grammar animation loops — nothing idles, nothing begs', () => {
    // The one sanctioned loop is the wait spinner (rotate-once). Every
    // other utility must be a finite animation.
    const animateLines = css
      .split('\n')
      .filter((l) => l.includes('--animate-') && !l.includes('--animate-rotate'));
    for (const line of animateLines) {
      expect(line, line.trim()).not.toContain('infinite');
    }
  });

  it('the frost contract classes exist', () => {
    for (const name of ['.frost-sharp', '.frost-veil', "[data-frosted='true']"]) {
      expect(css).toContain(name);
    }
  });
});
