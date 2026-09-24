/*
 * THE DEPLOY GESTURE — ported from the mockup (src/canvas/input.ts).
 *
 * With a troop card armed, pressing on a field starts an arm timer
 * (`armMs`). Moving past the tap slop before it fires means the player is
 * panning; when it fires the hold begins: each frame the deploy curve says
 * how many troops the hold has released and the delta is deposited on the
 * field under the finger. Time only advances while the finger is over a
 * field, so sliding off pauses the stream and sliding back resumes it.
 * Lifting the finger ends the hold. A quick tap sends a single troop.
 *
 * Without a card, or with two fingers, the board pans and pinches. The
 * wheel zooms around the cursor (trackpad pinch = ctrl+wheel), shift+wheel
 * pans sideways, double-click zooms in. Returns a disposer.
 */

import type { Camera } from './camera';
import { type DeployConfig, deployCountAt } from './deploy';
import { type MapLayout, type Point, fieldAt } from './map';

export interface InputHandlers {
  armedStat(): number | null;
  /** May the field take points right now (not locked, run live)? */
  canDeposit(field: number): boolean;
  onHoldStart(field: number, stat: number): void;
  /** The hold wants `n` more troops on `field`; returns how many the field took. */
  onHoldDeposit(field: number, stat: number, n: number, at: Point): number;
  onHoldMove(field: number | null): void;
  onHoldEnd(deployed: number): void;
  onTapField(field: number, stat: number, at: Point): void;
  onTapFieldUnarmed(field: number): void;
  onTapCrowd(field: number, stat: number): void;
  onTapPlaque(field: number): void;
  onTapEmpty(): void;
  isFitAll(): boolean;
  onFitAll(): void;
}

const TAP_SLOP_PX = 8;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 30;

export function attachInput(svg: SVGSVGElement, camera: Camera, layout: MapLayout, cfg: DeployConfig, h: InputHandlers): () => void {
  const pointers = new Map<number, Point>();
  let downTarget: Element | null = null;
  let downPos: Point | null = null;
  let moved = false;
  let lastTap: { at: number; pos: Point } | null = null;

  let armTimer: number | null = null;
  let holding = false;
  let holdStat: number | null = null;
  let holdField: number | null = null;
  let holdPointer: number | null = null;
  let fingerWorld: Point = { x: 0, y: 0 };
  let heldMs = 0;
  let lastFrame = 0;
  let deployed = 0;
  let frame: number | null = null;

  /* Client pixels → the SVG's own units. The two differ whenever an ancestor
   * is zoomed or transformed — the app renders at `zoom: 0.9` on a wide
   * screen (globals.css) — and the camera works in SVG units, so a plain
   * `clientX − rect.left` lands the tap 10% off and on the neighbouring
   * field near a road. The screen CTM carries zoom and transforms alike. */
  const toLocal = (clientX: number, clientY: number): Point => {
    const m = svg.getScreenCTM();
    if (!m) {
      const r = svg.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    }
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const pos = (e: PointerEvent): Point => toLocal(e.clientX, e.clientY);
  const fieldUnder = (screen: Point): number | null => fieldAt(layout, camera.toWorld(screen));

  const clearArm = (): void => {
    if (armTimer !== null) window.clearTimeout(armTimer);
    armTimer = null;
  };

  const tick = (now: number): void => {
    if (!holding || holdStat === null) return;
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    if (holdField !== null && h.canDeposit(holdField)) {
      heldMs += dt;
      const target = deployCountAt(heldMs, cfg);
      const delta = target - deployed;
      if (delta > 0) {
        h.onHoldDeposit(holdField, holdStat, delta, fingerWorld);
        deployed = target;
      }
    }
    frame = requestAnimationFrame(tick);
  };

  const startHold = (screen: Point): void => {
    const stat = h.armedStat();
    const field = fieldUnder(screen);
    if (stat === null || field === null || !h.canDeposit(field)) return;
    holding = true;
    holdStat = stat;
    holdField = field;
    fingerWorld = camera.toWorld(screen);
    heldMs = 0;
    deployed = 0;
    lastFrame = performance.now();
    svg.classList.add('bba-holding');
    h.onHoldStart(field, stat);
    h.onHoldMove(field);
    frame = requestAnimationFrame(tick);
  };

  const endHold = (): void => {
    if (!holding) return;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    holding = false;
    svg.classList.remove('bba-holding');
    h.onHoldMove(null);
    h.onHoldEnd(deployed);
    holdStat = null;
    holdField = null;
    holdPointer = null;
  };

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    svg.setPointerCapture(e.pointerId);
    const p = pos(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      downTarget = e.target as Element;
      downPos = p;
      moved = false;
      camera.stopAnimation();
      const onField = downTarget.closest('.bba-field-hit') !== null || (h.armedStat() !== null && fieldUnder(p) !== null);
      const onChrome = downTarget.closest('.bba-plaque, .bba-crowd-chip') !== null;
      if (h.armedStat() !== null && onField && !onChrome) {
        holdPointer = e.pointerId;
        clearArm();
        armTimer = window.setTimeout(() => {
          armTimer = null;
          if (!moved && pointers.size === 1) startHold(p);
        }, cfg.armMs);
      }
    } else {
      clearArm();
      endHold();
      moved = true;
    }
  };

  const onMove = (e: PointerEvent): void => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = pos(e);
    if (holding && e.pointerId === holdPointer) {
      fingerWorld = camera.toWorld(cur);
      const field = fieldUnder(cur);
      if (field !== holdField) {
        holdField = field;
        h.onHoldMove(field);
      }
      pointers.set(e.pointerId, cur);
      return;
    }
    if (pointers.size === 1) {
      if (!moved && downPos && Math.hypot(cur.x - downPos.x, cur.y - downPos.y) > TAP_SLOP_PX) {
        moved = true;
        clearArm();
      }
      if (moved) camera.panBy(cur.x - prev.x, cur.y - prev.y);
      pointers.set(e.pointerId, cur);
    } else if (pointers.size === 2) {
      const [idA, idB] = [...pointers.keys()] as [number, number];
      const prevA = pointers.get(idA) as Point;
      const prevB = pointers.get(idB) as Point;
      const curA = e.pointerId === idA ? cur : prevA;
      const curB = e.pointerId === idB ? cur : prevB;
      camera.pinch(prevA, prevB, curA, curB);
      pointers.set(e.pointerId, cur);
    } else {
      pointers.set(e.pointerId, cur);
    }
  };

  const toggleZoom = (at: Point): void => {
    if (h.isFitAll()) camera.zoomAt(at, 2.2);
    else h.onFitAll();
  };

  const end = (e: PointerEvent, cancelled: boolean): void => {
    if (!pointers.has(e.pointerId)) return;
    const wasHolding = holding && e.pointerId === holdPointer;
    const armPending = armTimer !== null;
    clearArm();
    pointers.delete(e.pointerId);
    if (wasHolding) endHold();
    if (pointers.size === 0) {
      if (!wasHolding && !moved && !cancelled && downTarget && downPos) {
        const stat = h.armedStat();
        const crowd = downTarget.closest(stat === null ? '.bba-crowd-hit, .bba-crowd-chip' : '.bba-crowd-chip');
        const plaque = downTarget.closest('.bba-plaque');
        const field = fieldUnder(downPos);
        const now = performance.now();
        const isDouble = lastTap !== null && now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(downPos.x - lastTap.pos.x, downPos.y - lastTap.pos.y) < DOUBLE_TAP_PX;
        lastTap = { at: now, pos: downPos };
        if (crowd) h.onTapCrowd(Number(crowd.getAttribute('data-field')), Number(crowd.getAttribute('data-stat')));
        else if (plaque) h.onTapPlaque(Number(plaque.getAttribute('data-field')));
        else if (field !== null && stat !== null && armPending) h.onTapField(field, stat, camera.toWorld(downPos));
        else if (isDouble && stat === null) {
          lastTap = null;
          toggleZoom(downPos);
        } else if (field !== null && stat === null) h.onTapFieldUnarmed(field);
        else h.onTapEmpty();
      }
      downTarget = null;
      downPos = null;
      moved = false;
      holdPointer = null;
    }
  };
  const onUp = (e: PointerEvent) => end(e, false);
  const onCancel = (e: PointerEvent) => end(e, true);

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const at = toLocal(e.clientX, e.clientY);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? svg.clientHeight : 1;
    if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      camera.panBy(-dx * unit, 0);
    } else if (e.ctrlKey || e.metaKey) {
      camera.zoomAt(at, Math.exp(-e.deltaY * unit * 0.01));
    } else {
      camera.zoomAt(at, Math.exp(-e.deltaY * unit * 0.0022));
    }
  };
  const onDbl = (e: MouseEvent): void => {
    if ((e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents) return;
    toggleZoom(toLocal(e.clientX, e.clientY));
  };
  const noCtx = (e: Event) => e.preventDefault();
  const noTouch = (e: Event) => e.preventDefault();

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onCancel);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('dblclick', onDbl);
  svg.addEventListener('contextmenu', noCtx);
  svg.addEventListener('touchstart', noTouch, { passive: false });
  svg.addEventListener('touchmove', noTouch, { passive: false });

  return () => {
    clearArm();
    endHold();
    svg.removeEventListener('pointerdown', onDown);
    svg.removeEventListener('pointermove', onMove);
    svg.removeEventListener('pointerup', onUp);
    svg.removeEventListener('pointercancel', onCancel);
    svg.removeEventListener('wheel', onWheel);
    svg.removeEventListener('dblclick', onDbl);
    svg.removeEventListener('contextmenu', noCtx);
    svg.removeEventListener('touchstart', noTouch);
    svg.removeEventListener('touchmove', noTouch);
  };
}
