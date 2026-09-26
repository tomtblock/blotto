/*
 * The shareable pass, composed on-device (2026-09-13; the character came
 * off it 2026-09-15).
 *
 * WHAT IT MAY CONTAIN — and what it must not. Everything drawn here comes
 * from `RevealOutcome` (reveal/types.ts), which by construction carries no
 * allocation: the seat and the pool. That is the whole point of composing
 * THIS rather than the seven-Blott montage that used to be offered on the
 * review screen: a Blott's silhouette is a deterministic, per-stat-monotone
 * function of its five stats (components/blot/blotGeometry.ts), so a picture of
 * seven of them was the sealed line-up, published while the pool was open.
 *
 * THE DRAWN CLASS IS NOT ON THE CARD. Until 2026-09-15 the pass named the
 * class, its rarity, and washed the card in the class hue. The founder's
 * instruction of 2026-09-14 — the rarity assignment is not broadcast to
 * players — took all three off; the one surface that shows rarity is the
 * profile. What is left is the mascot, the pool, the seat, the wordmark
 * and the footer: nothing drawn, nothing sealed.
 *
 * Colour comes from `design/tokens.ts` — a canvas renders outside the CSS
 * pipeline, so the palette is imported rather than referenced by name, and
 * no hex literal lives here.
 *
 * Output: 1080×1350 PNG (the 4:5 social portrait). Client-only: it needs a
 * canvas and the page's fonts, and it must never run on the server.
 */
import { palette } from '@/design/tokens';

const W = 1080;
const H = 1350;

export interface PassCardInput {
  seatLine: string;
  poolLine: string;
  headline: string;
  wordmark: string;
  footer: string;
  /** Pose image URL (a public/blott/*.webp render). */
  spriteUrl: string;
}

/** The page's font families, read from the next/font variables so the
 * canvas draws the same faces the page does (falling back to the same
 * stacks the layout declares). */
function fonts(): { display: string; body: string; mono: string } {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => {
    const raw = cs.getPropertyValue(name).trim();
    return raw ? `${raw}, ${fallback}` : fallback;
  };
  return {
    display: v('--font-big-shoulders', '"Arial Narrow", Arial, sans-serif'),
    body: v('--font-space-grotesk', 'system-ui, sans-serif'),
    mono: v('--font-jetbrains-mono', 'ui-monospace, monospace'),
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`pass: could not load ${url}`));
    img.src = url;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function composePassCard(input: PassCardInput): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('pass: client only');
  await document.fonts.ready;
  const f = fonts();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('pass: no 2d context');

  // Field: the brand pink page.
  ctx.fillStyle = palette.brandPink;
  ctx.fillRect(0, 0, W, H);

  // The pass: a cream card with a berry rim, lifted by a magenta shadow.
  const cx = 72;
  const cy = 96;
  const cw = W - cx * 2;
  const ch = H - cy - 160;
  ctx.save();
  ctx.shadowColor = palette.brandDeepMagenta;
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 18;
  roundRect(ctx, cx, cy, cw, ch, 56);
  ctx.fillStyle = palette.brandCream;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, cx, cy, cw, ch, 56);
  ctx.lineWidth = 8;
  ctx.strokeStyle = palette.brandBerry;
  ctx.stroke();

  // A soft brand-pink halo behind the mascot — the same on every pass,
  // because the pass no longer carries anything that varies by draw.
  const haloX = W / 2;
  const haloY = cy + 430;
  const halo = ctx.createRadialGradient(haloX, haloY, 40, haloX, haloY, 320);
  halo.addColorStop(0, palette.brandPink);
  halo.addColorStop(1, 'rgba(255, 246, 236, 0)');
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = halo;
  ctx.fillRect(cx + 4, cy + 4, cw - 8, ch - 8);
  ctx.restore();

  // Wordmark and pool.
  ctx.fillStyle = palette.brandBerry;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 30px ${f.mono}`;
  ctx.fillText(`${input.wordmark.toUpperCase()}  ·  ${input.poolLine.toUpperCase()}`, W / 2, cy + 92);

  // The mascot.
  const sprite = await loadImage(input.spriteUrl);
  const sw = 560;
  const sh = (sprite.naturalHeight / sprite.naturalWidth) * sw;
  ctx.drawImage(sprite, W / 2 - sw / 2, haloY - sh / 2 + 10, sw, sh);

  // Headline and seat.
  let y = cy + 790;
  ctx.font = `800 118px ${f.display}`;
  ctx.fillText(input.headline, W / 2, y);
  y += 88;
  ctx.font = `600 40px ${f.body}`;
  ctx.fillText(input.seatLine, W / 2, y);

  // Footer, on the pink field below the card.
  ctx.font = `600 24px ${f.mono}`;
  ctx.fillStyle = palette.brandBerry;
  ctx.fillText(input.footer, W / 2, H - 64);

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('pass: toBlob failed'))), 'image/png');
  });
}
