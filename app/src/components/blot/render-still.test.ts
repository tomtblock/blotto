/*
 * The lock-in still: the SEALING property is that the image can never
 * carry the numbers, and the SHARE property is that the same allocation
 * always produces the same bytes (brief §9.9 — SHA-equal PNGs follow from
 * byte-equal SVGs, since the rasteriser is deterministic for a fixed
 * document; the PNG half is covered in the browser capture pass).
 */
import { describe, expect, it } from 'vitest';
import { palette } from '@/design/tokens';
import { SHAPE_REFERENCES } from './blotGeometry';
import { STILL_SIZE, blotStillSvg } from './render-still';

describe('blotStillSvg', () => {
  it('is a standalone document: xmlns present, no CSS variables, no classes', () => {
    const svg = blotStillSvg([37, 22, 12, 8, 21]);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toContain('var(');
    expect(svg).not.toContain('class=');
  });

  it('carries the palette literally — the still must not depend on a stylesheet', () => {
    const svg = blotStillSvg([20, 20, 20, 20, 20]);
    expect(svg).toContain(palette.brandCream);
    expect(svg).toContain(palette.brandYellow);
    expect(svg).toContain(palette.blotHeart);
    expect(svg).toContain(palette.blotVisor);
  });

  it('renders at 1024 by default', () => {
    const svg = blotStillSvg([20, 20, 20, 20, 20]);
    expect(STILL_SIZE).toBe(1024);
    expect(svg).toContain(`width="${STILL_SIZE}"`);
    expect(svg).toContain(`height="${STILL_SIZE}"`);
  });

  it('NEVER embeds text — the montage shows shapes only, nothing leaks (sealing)', () => {
    for (const ref of SHAPE_REFERENCES) {
      const svg = blotStillSvg(ref.allocation as unknown as [number, number, number, number, number]);
      expect(svg).not.toContain('<text');
    }
  });

  it('is deterministic: identical allocations → byte-identical SVG', () => {
    for (const ref of SHAPE_REFERENCES) {
      const alloc = ref.allocation as unknown as [number, number, number, number, number];
      expect(blotStillSvg(alloc)).toBe(blotStillSvg(alloc));
    }
    // And different allocations differ.
    expect(blotStillSvg([20, 20, 20, 20, 20])).not.toBe(blotStillSvg([21, 19, 20, 20, 20]));
  });
});
