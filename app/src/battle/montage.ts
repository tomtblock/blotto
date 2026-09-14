/*
 * The Seven-made montage (master prompt C5): 1080×1350, candy-pink field,
 * seven cream tiles in a 4+3 grid, mono battle labels, the headline, and
 * the age/territory footer BAKED INTO THE PIXELS — a shared image carries
 * its own disclosure wherever it travels. Composed entirely in the browser.
 *
 * OFFERED ONLY AFTER THE POOL HAS CLOSED (2026-09-13). This header used to
 * say "the stills contain no numbers, so nothing leaks before the pool
 * closes" — and that inference was wrong. A still is the allocation drawn:
 * the Blott's silhouette is a deterministic, per-stat-monotone function of
 * its five stats (components/blott/warp.ts, blotGeometry.ts), so seven
 * labelled stills ARE the seven sealed line-ups, readable from the image.
 * The montage therefore left the review screen, where it was offered
 * before sealing, and is composed only on a closed pool's results page
 * (pools/[pool]/results/share-seven.tsx), where nothing can be countered.
 * The stills themselves never leave the device before then (stills.ts).
 */

import { COPY } from '@/copy';

export const MONTAGE_W = 1080;
export const MONTAGE_H = 1350;

export interface TileRect {
  x: number;
  y: number;
  size: number;
  battle: number; // 1-based
}

/**
 * Pure layout: a 4-up row then a 3-up row, centred, with even gutters —
 * exported separately so the geometry is unit-testable without a canvas.
 */
export function montageLayout(): TileRect[] {
  const gutter = 24;
  const cols = 4;
  const size = Math.floor((MONTAGE_W - gutter * (cols + 1)) / cols); // 234
  const rowY1 = 360;
  const rowY2 = rowY1 + size + gutter;
  const tiles: TileRect[] = [];
  for (let i = 0; i < 4; i++) {
    tiles.push({ x: gutter + i * (size + gutter), y: rowY1, size, battle: i + 1 });
  }
  const row2Width = 3 * size + 2 * gutter;
  const x0 = Math.floor((MONTAGE_W - row2Width) / 2);
  for (let i = 0; i < 3; i++) {
    tiles.push({ x: x0 + i * (size + gutter), y: rowY2, size, battle: i + 5 });
  }
  return tiles;
}

function makeCanvas(): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(MONTAGE_W, MONTAGE_H);
    const ctx = canvas.getContext('2d');
    if (ctx) return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = MONTAGE_W;
  canvas.height = MONTAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('montage: no 2d context');
  return { canvas, ctx };
}

function roundRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Compose the montage from seven still blobs (battle order). */
export async function composeMontage(stills: readonly Blob[], headline: string): Promise<Blob> {
  const { canvas, ctx } = makeCanvas();

  // Field + headline + footer colours are literal brand values — the
  // canvas has no stylesheet. Kept in step with tokens.ts by eye; the
  // shared-image look is reviewed, not computed.
  ctx.fillStyle = '#ff7ac8';
  ctx.fillRect(0, 0, MONTAGE_W, MONTAGE_H);

  ctx.fillStyle = '#5e1b40';
  ctx.font = "800 72px 'Big Shoulders Display', 'Arial Narrow', sans-serif";
  ctx.textAlign = 'center';
  ctx.fillText(headline, MONTAGE_W / 2, 200, MONTAGE_W - 120);

  const tiles = montageLayout();
  const bitmaps = await Promise.all(stills.map((b) => createImageBitmap(b)));
  tiles.forEach((tile, i) => {
    ctx.fillStyle = '#fff6ec';
    roundRect(ctx, tile.x, tile.y, tile.size, tile.size, 24);
    ctx.fill();
    const bmp = bitmaps[i];
    if (bmp) {
      const inset = 8;
      ctx.drawImage(bmp, tile.x + inset, tile.y + inset, tile.size - inset * 2, tile.size - inset * 2);
    }
    ctx.fillStyle = '#5e1b40';
    ctx.font = "600 26px 'JetBrains Mono', monospace";
    ctx.textAlign = 'center';
    ctx.fillText(String(tile.battle), tile.x + tile.size / 2, tile.y + tile.size + 40);
  });

  // The footer is part of the image, not the page (non-negotiable 2).
  ctx.fillStyle = '#5e1b40';
  ctx.font = "600 30px 'JetBrains Mono', monospace";
  ctx.textAlign = 'center';
  ctx.fillText(COPY.battle.montageFooter, MONTAGE_W / 2, MONTAGE_H - 80, MONTAGE_W - 80);

  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('montage: toBlob failed'))), 'image/png')
    );
  }
  return canvas.convertToBlob({ type: 'image/png' });
}
