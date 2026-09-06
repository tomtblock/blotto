/* The montage grid, pinned: 4+3, inside the frame, even, non-overlapping. */
import { describe, expect, it } from 'vitest';
import { MONTAGE_H, MONTAGE_W, montageLayout } from './montage';

describe('montageLayout', () => {
  const tiles = montageLayout();
  it('lays out seven tiles, battles 1..7 in order', () => {
    expect(tiles.map((t) => t.battle)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('keeps every tile fully inside the 1080×1350 frame with label room', () => {
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.size).toBeLessThanOrEqual(MONTAGE_W);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y + t.size + 48).toBeLessThanOrEqual(MONTAGE_H - 120); // labels + footer
    }
  });
  it('rows do not overlap and the second row is centred', () => {
    const row1 = tiles.slice(0, 4);
    const row2 = tiles.slice(4);
    expect(Math.min(...row2.map((t) => t.y))).toBeGreaterThan(row1[0].y + row1[0].size);
    const left = row2[0].x;
    const right = MONTAGE_W - (row2[2].x + row2[2].size);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });
});
