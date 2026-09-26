'use client';

/*
 * <Arena /> — the React shell around the ported mockup renderer, camera
 * and deploy gesture (render.ts, camera.ts, input.ts). It owns one
 * MapRenderer for its lifetime, feeds it the reducer's grid on every
 * change, and turns gestures into reducer events:
 *
 *   hold on a field   → `onDeposit(field, stat, n)` — the deploy curve
 *                       decides WHEN; the reducer decides IF (it clips to
 *                       the field's or the board's headroom)
 *   tap a crowd chip  → `onOpenStepper(field, stat)`
 *   tap a plaque      → frame the field and `onOpenStepper(field, armed)`
 *   tap empty ground  → `onTapEmpty()` (closes the stepper)
 *
 * GRAB MODE (`grab`, the hand key — founder 2026-09-24, second pass): the
 * troop in hand stays selected but the gesture is disarmed, so a drag only
 * pans and a tap on a field opens the stepper for that troop there. It is
 * the way to the ±5/±10/±20 keys without disarming the tray first.
 *
 * Nothing here computes a value the reducer does not check again.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type BoardPlayState, fieldFull, fieldRemaining } from '@/battle/board/machine';
import { COPY } from '@/copy';
import { Camera } from './camera';
import { DEPLOY } from './deploy';
import { attachInput } from './input';
import { type MapLayout, type Point, buildMap } from './map';
import { MapRenderer, type PlaqueLine } from './render';

export interface ArenaProps {
  state: BoardPlayState;
  /** Whether gestures are live. */
  interactive: boolean;
  /** Grab mode: drag pans, a tap on a field opens its stepper; nothing deploys. */
  grab?: boolean;
  /** `n` points of `stat` to `field`; returns how many the reducer will take. */
  onDeposit: (field: number, stat: number, n: number) => number;
  onOpenStepper: (field: number, stat: number | null) => void;
  onTapEmpty: () => void;
  /** The finger is deploying on `field` (null when it lifts). */
  onHold: (field: number | null) => void;
  demo?: boolean;
}

export interface ArenaHandle {
  fitAll: () => void;
  fitField: (field: number) => void;
}

const HUD_TOP_PX = 118;

export function Arena({ state, interactive, grab = false, onDeposit, onOpenStepper, onTapEmpty, onHold, demo = false }: ArenaProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<MapLayout | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const pendingSpawn = useRef<Point | null>(null);
  const [pct, setPct] = useState(100);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  // Latest props for the vanilla listeners, which are attached once.
  const stateRef = useRef(state);
  const propsRef = useRef({ interactive, grab, onDeposit, onOpenStepper, onTapEmpty, onHold });
  useEffect(() => {
    stateRef.current = state;
    propsRef.current = { interactive, grab, onDeposit, onOpenStepper, onTapEmpty, onHold };
  });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);

  const insets = useCallback(() => ({ top: HUD_TOP_PX, right: 0, bottom: 12, left: 0 }), []);
  const fitAll = useCallback((duration = 220) => {
    const cam = cameraRef.current;
    const layout = layoutRef.current;
    if (!cam || !layout) return;
    cam.insets = insets();
    void cam.fit(layout.bounds, 0, duration);
  }, [insets]);
  const fitField = useCallback(
    (field: number, duration = 220) => {
      const cam = cameraRef.current;
      const f = layoutRef.current?.fields[field];
      if (!cam || !f) return;
      cam.insets = insets();
      void cam.fit(f.bounds, 10, duration);
    },
    [insets]
  );

  /* Mount: build the world once. */
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const layout = buildMap();
    const camera = new Camera();
    camera.limit = layout.limit;
    const renderer = new MapRenderer(stage, layout, camera, COPY.board.mapLabel);
    layoutRef.current = layout;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    const unsub = camera.subscribe(() => setPct(Math.round(camera.s * 100)));

    // In grab mode the stepper may already be open (interactive is false) and
    // a tap on another field simply moves it there.
    const openFor = (field: number, stat: number | null) => {
      if (!propsRef.current.interactive && !propsRef.current.grab) return;
      propsRef.current.onOpenStepper(field, stat);
    };

    const detach = attachInput(renderer.svg, camera, layout, DEPLOY, {
      armedStat: () => (propsRef.current.interactive && !propsRef.current.grab ? stateRef.current.selected : null),
      canDeposit: (field) => propsRef.current.interactive && !propsRef.current.grab && !stateRef.current.locked[field],
      onHoldStart(field) {
        renderer.setHover(field);
        propsRef.current.onHold(field);
      },
      onHoldDeposit(field, stat, n, at) {
        pendingSpawn.current = at;
        const placed = propsRef.current.onDeposit(field, stat, n);
        if (placed === 0 && fieldRemaining(stateRef.current, field) === 0) showToast(COPY.board.toastFull(field + 1));
        return placed;
      },
      onHoldMove(field) {
        renderer.setHover(field);
        propsRef.current.onHold(field);
      },
      onHoldEnd() {
        renderer.setHover(null);
        propsRef.current.onHold(null);
      },
      onTapField(field, stat, at) {
        pendingSpawn.current = at;
        const placed = propsRef.current.onDeposit(field, stat, 1);
        if (placed === 0) showToast(COPY.board.toastFull(field + 1));
      },
      onTapFieldUnarmed(field) {
        if (propsRef.current.grab) openFor(field, stateRef.current.selected);
        else if (propsRef.current.interactive) showToast(COPY.board.toastPick);
      },
      onTapCrowd(field, stat) {
        openFor(field, stat);
      },
      onTapPlaque(field) {
        if (!propsRef.current.interactive && !propsRef.current.grab) return;
        fitField(field);
        openFor(field, stateRef.current.selected);
      },
      onTapEmpty: () => propsRef.current.onTapEmpty(),
      isFitAll() {
        camera.insets = insets();
        return Math.abs(camera.s - camera.viewFor(layout.bounds, 0).s) / camera.s < 0.08;
      },
      onFitAll: () => fitAll(),
    });

    const resize = () => {
      // Layout pixels, which are the SVG's units — not the client rect, which
      // an ancestor zoom (globals.css, wide screens) scales by 0.9.
      const w = stage.clientWidth;
      const hgt = stage.clientHeight;
      if (w < 1 || hgt < 1) return;
      camera.setViewport(w, hgt);
      camera.insets = insets();
      // Never zoom out past 60% of the whole-arena view (the mockup's rule).
      camera.minScale = camera.viewFor(layout.bounds, 0).s * 0.6;
      if (!camera.touched) fitAll(0);
      else camera.clampScale();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    resize();

    return () => {
      ro.disconnect();
      detach();
      unsub();
      renderer.destroy();
      rendererRef.current = null;
      cameraRef.current = null;
      layoutRef.current = null;
    };
  }, [fitAll, fitField, insets, showToast]);

  /* Every state change redraws crowds and plaques. */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.spawnFrom = pendingSpawn.current;
    pendingSpawn.current = null;
    renderer.setArmed(interactive && !grab && state.selected !== null);
    renderer.update(state.grid, state.locked, state.mode, (field) => plaqueLine(state, field));
    renderer.spawnFrom = null;
  }, [state, interactive, grab]);

  const zoom = (factor: number) => {
    const cam = cameraRef.current;
    if (cam) cam.zoomAt({ x: cam.vw / 2, y: cam.vh / 2 }, factor);
  };

  return (
    <div className={'bba' + (demo ? ' bba--demo' : '') + (grab ? ' bba--grab' : '')} data-testid="arena" data-grab={grab ? '1' : undefined}>
      <div ref={stageRef} className="bba-stage" />
      <div className="bba-zoom" role="group" aria-label={COPY.board.zoomLabel}>
        <button type="button" className="bba-zbtn" aria-label={COPY.board.zoomOut} onClick={() => zoom(1 / 1.25)}>
          −
        </button>
        <button type="button" className="bba-zbtn bba-zpct" aria-label={COPY.board.zoomReset} onClick={() => zoom(1 / (pct / 100))}>
          {pct}%
        </button>
        <button type="button" className="bba-zbtn" aria-label={COPY.board.zoomIn} onClick={() => zoom(1.25)}>
          +
        </button>
        <button type="button" className="bba-zbtn" onClick={() => fitAll()}>
          {COPY.board.fit}
        </button>
      </div>
      <div className={'bba-toast' + (toast ? ' bba-show' : '')} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}

/** What a field's plaque says under its name (founder 5.3: what is LEFT). */
export function plaqueLine(s: Pick<BoardPlayState, 'grid' | 'mode' | 'locked'>, field: number): PlaqueLine {
  const placed = (s.grid[field] ?? []).reduce((a, b) => a + b, 0);
  if (s.locked[field]) return { score: COPY.board.plaqueLocked, sub: COPY.board.plaquePlaced(placed), full: false, locked: true };
  if (s.mode === 'easy') {
    if (fieldFull(s, field)) return { score: COPY.board.plaqueFull, sub: '100 / 100', full: true, locked: false };
    return { score: `${placed} / 100`, sub: COPY.board.plaqueLeft(fieldRemaining(s, field)), full: false, locked: false };
  }
  return { score: COPY.board.plaquePlaced(placed), sub: '', full: false, locked: false };
}
