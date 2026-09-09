/*
 * Lock-in still capture on the rendered Blott: the same warp the machine
 * shows (warp.ts), drawn at 1024×1024 on the cream field, returned as a
 * PNG blob. CLIENT-SIDE ONLY, exactly as the drawn version was
 * (blot/render-still.ts, retired by this module): the still is a picture
 * of the allocation, so it is treated like the allocation — stored on the
 * device, never uploaded before the pool closes, no text, no numbers.
 *
 * Determinism: the still is a pure function of the allocation on a given
 * device — rest pose, no lean, no breathe, no cheer frame, fixed framing.
 * One offscreen context is kept for the whole page (browsers cap live
 * WebGL contexts), so seven lock-ins cost one context, not seven.
 */

import type { Allocation } from '@/battle/allocation';
import { palette } from '@/design/tokens';
import { CHEER_URL, HERO_URL, createWarp, drawWarp, loadImage, uploadTexture, type WarpProgram } from './warp';

export const STILL_SIZE = 1024;

let shared: Promise<{ canvas: HTMLCanvasElement; warp: WarpProgram; hero: WebGLTexture; cheer: WebGLTexture }> | null =
  null;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function stage() {
  if (!shared) {
    shared = (async () => {
      const canvas = document.createElement('canvas');
      canvas.width = STILL_SIZE;
      canvas.height = STILL_SIZE;
      const warp = createWarp(canvas, true);
      if (!warp) throw new Error('blott still: WebGL unavailable');
      const [heroImg, cheerImg] = await Promise.all([loadImage(HERO_URL), loadImage(CHEER_URL)]);
      return { canvas, warp, hero: uploadTexture(warp.gl, heroImg), cheer: uploadTexture(warp.gl, cheerImg) };
    })();
    shared.catch(() => {
      shared = null;
    });
  }
  return shared;
}

/** Rasterise the still to a PNG blob. Browser-only. */
export async function renderBlottStill(allocation: Allocation): Promise<Blob> {
  const { canvas, warp, hero, cheer } = await stage();
  const [r, g, b] = hexToRgb(palette.brandCream);
  drawWarp(warp, hero, cheer, { display: allocation, puff: 1, lean: 0, glowBoost: 0, mix: 0 }, [r, g, b, 1]);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('blott still: toBlob failed'))), 'image/png');
  });
}
