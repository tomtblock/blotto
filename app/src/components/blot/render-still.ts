/*
 * Lock-in still capture (architect brief §6): render the Blot at
 * 1024×1024 on the cream field and return a PNG blob. CLIENT-SIDE ONLY —
 * the still is stored in IndexedDB under the pool id (wired in the battle
 * run PR) and never leaves the device before the pool closes.
 *
 * SEALING NOTE (hard rule): a Blot silhouette is a readable projection of
 * the allocation, so the still is treated EXACTLY like the allocation
 * itself — client-side until reveal. This module must never gain a
 * network call. The SVG contains no text and no numbers: the montage
 * shows shapes only, so nothing leaks even when shared early. The
 * allocation's own encryption flow is untouched by any of this — the
 * still is a picture, not data.
 *
 * DETERMINISM (brief §9.9): `blotStillSvg` is a pure string of the
 * allocation — geometry serialises at fixed 2-decimal precision and every
 * colour is a literal from tokens.ts (no var(), no classes), so identical
 * allocations produce byte-identical SVG and therefore identical PNGs.
 */

import type { Allocation } from '@/battle/allocation';
import { palette } from '@/design/tokens';
import { blotScene, UNIT } from './blotGeometry';

export const STILL_SIZE = 1024;

/** The standalone SVG document for one locked allocation. */
export function blotStillSvg(allocation: Allocation, size: number = STILL_SIZE): string {
  const s = blotScene(allocation);
  const legHL = Math.max(0, s.legs.bottom - s.legs.left.top);
  const legHR = Math.max(0, s.legs.bottom - s.legs.right.top);
  const f = (v: number) => v.toFixed(2);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${UNIT} ${UNIT}">` +
    `<defs>` +
    `<radialGradient id="b" cx="32%" cy="28%" r="85%">` +
    `<stop offset="0%" stop-color="${palette.blotLit}"/>` +
    `<stop offset="45%" stop-color="${palette.brandYellow}"/>` +
    `<stop offset="100%" stop-color="${palette.blotShade}"/>` +
    `</radialGradient>` +
    `<linearGradient id="r" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="${palette.blotRim}" stop-opacity="0.55"/>` +
    `<stop offset="55%" stop-color="${palette.blotRim}" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<radialGradient id="ao" cx="50%" cy="50%" r="72%">` +
    `<stop offset="78%" stop-color="${palette.blotAmbient}" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="${palette.blotAmbient}" stop-opacity="0.18"/>` +
    `</radialGradient>` +
    `<linearGradient id="l" x1="0%" y1="0%" x2="0%" y2="100%">` +
    `<stop offset="0%" stop-color="${palette.brandYellow}"/>` +
    `<stop offset="100%" stop-color="${palette.blotShade}"/>` +
    `</linearGradient>` +
    `<filter id="sb" filterUnits="userSpaceOnUse" x="-200" y="${UNIT - 300}" width="${UNIT + 400}" height="500">` +
    `<feGaussianBlur stdDeviation="22"/></filter>` +
    `<filter id="hb" filterUnits="userSpaceOnUse" x="200" y="200" width="600" height="600">` +
    `<feGaussianBlur stdDeviation="18"/></filter>` +
    `<filter id="pb" filterUnits="userSpaceOnUse" x="-400" y="-400" width="${UNIT + 800}" height="${UNIT + 800}">` +
    `<feGaussianBlur stdDeviation="14"/></filter>` +
    `</defs>` +
    `<rect width="${UNIT}" height="${UNIT}" fill="${palette.brandCream}"/>` +
    (s.fit < 1 ? `<g transform="translate(500 480) scale(${s.fit.toFixed(4)}) translate(-500 -480)">` : '<g>') +
    `<ellipse cx="${f(s.shadow.cx)}" cy="${f(s.shadow.cy)}" rx="${f(s.shadow.rx)}" ry="${f(s.shadow.ry)}" fill="${palette.blotShadow}" opacity="0.35" filter="url(#sb)"/>` +
    (legHL > 0
      ? `<rect x="${f(s.legs.left.x - s.legs.width / 2)}" y="${f(s.legs.left.top)}" width="${s.legs.width}" height="${f(legHL)}" rx="${f(Math.min(s.legs.rx, legHL / 2))}" fill="url(#l)"/>`
      : '') +
    (legHR > 0
      ? `<rect x="${f(s.legs.right.x - s.legs.width / 2)}" y="${f(s.legs.right.top)}" width="${s.legs.width}" height="${f(legHR)}" rx="${f(Math.min(s.legs.rx, legHR / 2))}" fill="url(#l)"/>`
      : '') +
    `<rect x="${f(s.arms.left.x - s.arms.width / 2)}" y="${f(s.arms.left.y)}" width="${s.arms.width}" height="${s.arms.length}" rx="${s.arms.rx}" fill="url(#l)" transform="rotate(${s.arms.left.angle} ${f(s.arms.left.x)} ${f(s.arms.left.y)})"/>` +
    `<rect x="${f(s.arms.right.x - s.arms.width / 2)}" y="${f(s.arms.right.y)}" width="${s.arms.width}" height="${s.arms.length}" rx="${s.arms.rx}" fill="url(#l)" transform="rotate(${s.arms.right.angle} ${f(s.arms.right.x)} ${f(s.arms.right.y)})"/>` +
    `<path d="${s.bodyPath}" fill="url(#b)"/>` +
    `<path d="${s.bodyPath}" fill="url(#ao)"/>` +
    `<path d="${s.bodyPath}" fill="none" stroke="url(#r)" stroke-width="10" stroke-linejoin="round"/>` +
    `<path d="${s.seamPath}" fill="none" stroke="${palette.blotSeam}" stroke-width="3" opacity="0.8"/>` +
    `<circle cx="${f(s.heart.cx)}" cy="${f(s.heart.cy)}" r="${f(s.heart.r * 1.35)}" fill="${palette.blotHeart}" opacity="0.45" filter="url(#hb)"/>` +
    `<circle cx="${f(s.heart.cx)}" cy="${f(s.heart.cy)}" r="${f(s.heart.r)}" fill="${palette.blotHeart}" opacity="0.6"/>` +
    `<rect x="${f(s.visor.cx - s.visor.width / 2)}" y="${f(s.visor.cy - s.visor.height / 2)}" width="${f(s.visor.width)}" height="${s.visor.height}" rx="${f(s.visor.rx)}" fill="${palette.blotVisor}"/>` +
    `<rect x="${f(s.visor.cx - s.visor.width / 2 + s.visor.rx)}" y="${f(s.visor.cy - s.visor.height / 2 + 8)}" width="${f(Math.max(0, s.visor.width - s.visor.rx * 2))}" height="6" rx="3" fill="${palette.brandCream}" opacity="0.45"/>` +
    `<ellipse cx="${f(s.specular.cx)}" cy="${f(s.specular.cy)}" rx="${s.specular.rx}" ry="${s.specular.ry}" fill="${palette.brandCream}" opacity="0.32" filter="url(#pb)"/>` +
    `</g>` +
    `</svg>`
  );
}

/**
 * Rasterise the still to a PNG blob. Browser-only. OffscreenCanvas where
 * available (off the main thread's layout at least), else a detached
 * <canvas> + Image — never attached to the DOM.
 */
export async function renderBlotStill(allocation: Allocation): Promise<Blob> {
  const svg = blotStillSvg(allocation);
  const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('blot still: SVG failed to decode'));
      img.src = url;
    });
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(STILL_SIZE, STILL_SIZE);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('blot still: no 2d context');
      ctx.drawImage(img, 0, 0, STILL_SIZE, STILL_SIZE);
      return await canvas.convertToBlob({ type: 'image/png' });
    }
    const canvas = document.createElement('canvas');
    canvas.width = STILL_SIZE;
    canvas.height = STILL_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('blot still: no 2d context');
    ctx.drawImage(img, 0, 0, STILL_SIZE, STILL_SIZE);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('blot still: toBlob failed'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
