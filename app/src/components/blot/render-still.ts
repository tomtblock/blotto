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
import { REST_EXPRESSION, brows, cheeks, visorPath } from './expression';

export const STILL_SIZE = 1024;

/** The standalone SVG document for one locked allocation. */
export function blotStillSvg(allocation: Allocation, size: number = STILL_SIZE): string {
  const s = blotScene(allocation);
  // The still wears the REST face (expression.ts): same allocation, same face.
  const face = REST_EXPRESSION;
  // The same enlarged visor box BlotMorph draws (the reference toy's wide,
  // deep band); brows and cheeks follow it.
  const visor = { ...s.visor, width: s.visor.width * 1.22, height: s.visor.height * 1.32, rx: s.visor.rx * 1.3 };
  const visorD = visorPath(visor, face);
  const browPair = brows(visor, face);
  const cheekPair = cheeks(visor, face);
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
    `<linearGradient id="sh" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="${palette.brandCream}" stop-opacity="0.28"/>` +
    `<stop offset="38%" stop-color="${palette.brandCream}" stop-opacity="0.06"/>` +
    `<stop offset="60%" stop-color="${palette.brandCream}" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="${palette.blotAmbient}" stop-opacity="0.12"/>` +
    `</linearGradient>` +
    `<filter id="sb" filterUnits="userSpaceOnUse" x="-200" y="${UNIT - 300}" width="${UNIT + 400}" height="500">` +
    `<feGaussianBlur stdDeviation="22"/></filter>` +
    `<filter id="hb" filterUnits="userSpaceOnUse" x="200" y="200" width="600" height="600">` +
    `<feGaussianBlur stdDeviation="18"/></filter>` +
    `<filter id="pb" filterUnits="userSpaceOnUse" x="-400" y="-400" width="${UNIT + 800}" height="${UNIT + 800}">` +
    `<feGaussianBlur stdDeviation="14"/></filter>` +
    // The vinyl material — identical to BlotMorph's: blurred alpha as a height
    // map, one point light, diffuse roundness plus a tight specular.
    `<filter id="pf" filterUnits="userSpaceOnUse" x="-300" y="-300" width="${UNIT + 600}" height="${UNIT + 600}" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="34" result="bump"/>` +
    `<feDiffuseLighting in="bump" surfaceScale="16" diffuseConstant="1.05" lighting-color="#ffffff" result="diff"><fePointLight x="300" y="120" z="720"/></feDiffuseLighting>` +
    `<feComposite in="diff" in2="SourceAlpha" operator="in" result="diffIn"/>` +
    `<feComposite in="SourceGraphic" in2="diffIn" operator="arithmetic" k1="0.58" k2="0.42" k3="0" k4="0" result="shaded"/>` +
    `<feSpecularLighting in="bump" surfaceScale="18" specularConstant="0.9" specularExponent="26" lighting-color="${palette.brandCream}" result="spec"><fePointLight x="280" y="100" z="560"/></feSpecularLighting>` +
    `<feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn"/>` +
    `<feComposite in="specIn" in2="shaded" operator="arithmetic" k1="0" k2="0.85" k3="1" k4="0"/>` +
    `</filter>` +
    `<linearGradient id="gl" x1="0%" y1="0%" x2="0%" y2="100%">` +
    `<stop offset="0%" stop-color="${palette.blotShade}" stop-opacity="0.55"/>` +
    `<stop offset="18%" stop-color="${palette.blotVisor}"/>` +
    `<stop offset="100%" stop-color="${palette.blotVisor}"/>` +
    `</linearGradient>` +
    `<linearGradient id="gs" x1="0%" y1="0%" x2="0%" y2="100%">` +
    `<stop offset="0%" stop-color="${palette.brandCream}" stop-opacity="0.55"/>` +
    `<stop offset="45%" stop-color="${palette.brandCream}" stop-opacity="0.08"/>` +
    `<stop offset="100%" stop-color="${palette.brandCream}" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<radialGradient id="bl" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="${palette.blotHeart}" stop-opacity="0.9"/>` +
    `<stop offset="35%" stop-color="${palette.blotHeart}" stop-opacity="0.5"/>` +
    `<stop offset="100%" stop-color="${palette.blotHeart}" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<clipPath id="bc"><path d="${s.bodyPath}"/></clipPath>` +
    `</defs>` +
    `<rect width="${UNIT}" height="${UNIT}" fill="${palette.brandCream}"/>` +
    (s.fit < 1 ? `<g transform="translate(500 480) scale(${s.fit.toFixed(4)}) translate(-500 -480)">` : '<g>') +
    `<ellipse cx="${f(s.shadow.cx)}" cy="${f(s.shadow.cy)}" rx="${f(s.shadow.rx)}" ry="${f(s.shadow.ry)}" fill="${palette.blotShadow}" opacity="0.35" filter="url(#sb)"/>` +
    `<g filter="url(#pf)">` +
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
    `<path d="${s.bodyPath}" fill="url(#sh)"/>` +
    `</g>` +
    // Quilted panels: each corner's panel pillows toward the light.
    `<g clip-path="url(#bc)" opacity="0.55">` +
    s.corners.map((c) => `<ellipse cx="${f(500 + (c.x - 500) * 0.58 - 30)}" cy="${f(480 + (c.y - 480) * 0.58 - 30)}" rx="95" ry="70" fill="${palette.brandCream}" opacity="0.28" filter="url(#pb)"/>`).join('') +
    `</g>` +
    // Seams as a groove: shadow edge, lit edge, thread, stitches.
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${s.seamPath}" stroke="${palette.blotAmbient}" stroke-width="7" opacity="0.28" transform="translate(2 3)"/>` +
    `<path d="${s.seamPath}" stroke="${palette.brandCream}" stroke-width="3" opacity="0.35" transform="translate(-2 -2)"/>` +
    `<path d="${s.seamPath}" stroke="${palette.blotSeam}" stroke-width="3.5" opacity="0.9"/>` +
    `<path d="${s.seamPath}" stroke="${palette.brandCream}" stroke-width="1.6" stroke-dasharray="9 11" opacity="0.75"/>` +
    `</g>` +
    // The heart's bloom across the lower face, clipped to the body.
    `<g clip-path="url(#bc)">` +
    `<ellipse cx="${f(s.heart.cx)}" cy="${f(s.heart.cy + s.heart.r * 0.2)}" rx="${f(s.heart.r * 3.4)}" ry="${f(s.heart.r * 2.6)}" fill="url(#bl)" opacity="0.8"/>` +
    `<circle cx="${f(s.heart.cx)}" cy="${f(s.heart.cy)}" r="${f(s.heart.r * 1.15)}" fill="${palette.blotHeart}" opacity="0.55" filter="url(#hb)"/>` +
    `</g>` +
    `<ellipse cx="${f(cheekPair.left.cx)}" cy="${f(cheekPair.left.cy)}" rx="${f(cheekPair.left.rx)}" ry="${f(cheekPair.left.ry)}" fill="${palette.blotHeart}" opacity="${cheekPair.left.opacity.toFixed(2)}" filter="url(#hb)"/>` +
    `<ellipse cx="${f(cheekPair.right.cx)}" cy="${f(cheekPair.right.cy)}" rx="${f(cheekPair.right.rx)}" ry="${f(cheekPair.right.ry)}" fill="${palette.blotHeart}" opacity="${cheekPair.right.opacity.toFixed(2)}" filter="url(#hb)"/>` +
    `<path d="${visorD}" fill="${palette.blotAmbient}" opacity="0.35" transform="translate(0 5)"/>` +
    `<path d="${visorD}" fill="url(#gl)"/>` +
    `<path d="${visorD}" fill="url(#gs)" transform="translate(${f(visor.cx)} ${f(visor.cy)}) scale(0.92 0.55) translate(${f(-visor.cx)} ${f(-visor.cy - visor.height * 0.3)})"/>` +
    `<ellipse cx="${f(visor.cx - visor.width * 0.3)}" cy="${f(visor.cy - visor.height * 0.12)}" rx="${f(Math.max(9, visor.height * 0.15))}" ry="${f(Math.max(6, visor.height * 0.1))}" fill="${palette.brandCream}" opacity="0.9"/>` +
    [browPair.left, browPair.right].map((b) => `<rect x="${f(b.x - b.length / 2)}" y="${f(b.y - b.thickness / 2)}" width="${f(b.length)}" height="${f(b.thickness)}" rx="${f(b.thickness / 2)}" fill="${palette.blotVisor}" opacity="0.92" transform="rotate(${b.angle.toFixed(2)} ${f(b.x)} ${f(b.y)})"/>`).join('') +
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
