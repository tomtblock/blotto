/*
 * A continuous pan/zoom camera over one world — ported from the mockup
 * (timdontplay/blotto-game, src/canvas/camera.ts). Screen = (world − centre)
 * × scale + viewport/2. Insets describe HUD overlays so "fit" keeps the
 * target clear of them. No React; the Arena component owns one instance.
 */

import type { BBox, Point } from './map';

export interface CameraView {
  cx: number;
  cy: number;
  s: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export class Camera {
  cx = 0;
  cy = 0;
  s = 1;
  vw = 1;
  vh = 1;
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  minScale = 0.05;
  maxScale = 12;
  limit: BBox | null = null;
  /** True once the player has panned or zoomed. */
  touched = false;
  private listeners = new Set<() => void>();
  private animFrame: number | null = null;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  setViewport(w: number, h: number): void {
    this.vw = Math.max(1, w);
    this.vh = Math.max(1, h);
    this.emit();
  }

  toScreen(p: Point): Point {
    return { x: (p.x - this.cx) * this.s + this.vw / 2, y: (p.y - this.cy) * this.s + this.vh / 2 };
  }
  toWorld(p: Point): Point {
    return { x: (p.x - this.vw / 2) / this.s + this.cx, y: (p.y - this.vh / 2) / this.s + this.cy };
  }
  transformAttr(): string {
    return `translate(${this.vw / 2 - this.cx * this.s} ${this.vh / 2 - this.cy * this.s}) scale(${this.s})`;
  }

  stopAnimation(): void {
    if (this.animFrame !== null) cancelAnimationFrame(this.animFrame);
    this.animFrame = null;
  }

  private clampCentre(): void {
    const l = this.limit;
    if (!l) return;
    this.cx = Math.min(l.maxX, Math.max(l.minX, this.cx));
    this.cy = Math.min(l.maxY, Math.max(l.minY, this.cy));
  }

  panBy(dx: number, dy: number): void {
    this.touched = true;
    this.stopAnimation();
    this.cx -= dx / this.s;
    this.cy -= dy / this.s;
    this.clampCentre();
    this.emit();
  }

  /** Zoom by `factor` keeping the world point under `screen` fixed. */
  zoomAt(screen: Point, factor: number): void {
    this.touched = true;
    this.stopAnimation();
    const w = this.toWorld(screen);
    const s2 = Math.min(this.maxScale, Math.max(this.minScale, this.s * factor));
    this.cx = w.x - (screen.x - this.vw / 2) / s2;
    this.cy = w.y - (screen.y - this.vh / 2) / s2;
    this.s = s2;
    this.clampCentre();
    this.emit();
  }

  clampScale(): void {
    if (this.s >= this.minScale && this.s <= this.maxScale) return;
    const was = this.touched;
    this.zoomAt({ x: this.vw / 2, y: this.vh / 2 }, Math.min(this.maxScale, Math.max(this.minScale, this.s)) / this.s);
    this.touched = was;
  }

  pinch(prevA: Point, prevB: Point, curA: Point, curB: Point): void {
    const prevMid = { x: (prevA.x + prevB.x) / 2, y: (prevA.y + prevB.y) / 2 };
    const curMid = { x: (curA.x + curB.x) / 2, y: (curA.y + curB.y) / 2 };
    const prevD = Math.hypot(prevA.x - prevB.x, prevA.y - prevB.y) || 1;
    const curD = Math.hypot(curA.x - curB.x, curA.y - curB.y) || 1;
    this.zoomAt(prevMid, curD / prevD);
    this.panBy(curMid.x - prevMid.x, curMid.y - prevMid.y);
  }

  viewFor(bbox: BBox, padPx = 16): CameraView {
    const { top, right, bottom, left } = this.insets;
    const availW = Math.max(40, this.vw - left - right - 2 * padPx);
    const availH = Math.max(40, this.vh - top - bottom - 2 * padPx);
    const w = Math.max(1, bbox.maxX - bbox.minX);
    const h = Math.max(1, bbox.maxY - bbox.minY);
    const s = Math.min(this.maxScale, Math.max(this.minScale, Math.min(availW / w, availH / h)));
    const visX = left + (this.vw - left - right) / 2;
    const visY = top + (this.vh - top - bottom) / 2;
    const bx = (bbox.minX + bbox.maxX) / 2;
    const by = (bbox.minY + bbox.maxY) / 2;
    return { cx: bx - (visX - this.vw / 2) / s, cy: by - (visY - this.vh / 2) / s, s };
  }

  set(view: CameraView): void {
    this.cx = view.cx;
    this.cy = view.cy;
    this.s = view.s;
    this.emit();
  }

  animateTo(target: CameraView, duration = 220): Promise<void> {
    this.stopAnimation();
    if (duration <= 0) {
      this.set(target);
      return Promise.resolve();
    }
    const from = { cx: this.cx, cy: this.cy, ls: Math.log(this.s) };
    const to = { cx: target.cx, cy: target.cy, ls: Math.log(target.s) };
    const start = performance.now();
    return new Promise((resolve) => {
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / duration);
        const e = easeOutCubic(t);
        this.cx = from.cx + (to.cx - from.cx) * e;
        this.cy = from.cy + (to.cy - from.cy) * e;
        this.s = Math.exp(from.ls + (to.ls - from.ls) * e);
        this.emit();
        if (t < 1) this.animFrame = requestAnimationFrame(step);
        else {
          this.animFrame = null;
          resolve();
        }
      };
      this.animFrame = requestAnimationFrame(step);
    });
  }

  fit(bbox: BBox, padPx = 16, duration = 220): Promise<void> {
    return this.animateTo(this.viewFor(bbox, padPx), duration);
  }
}
