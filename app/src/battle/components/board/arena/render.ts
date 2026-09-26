/*
 * THE ARENA RENDERER — ported from the mockup (src/canvas/render.ts), build
 * phase only (the replay layer waits for the results page). Draws the world:
 * endless forest (a mirrored tile), the painted map feathered into it,
 * invisible field wedges that glow while a troop card is armed, a
 * Clash-style plaque per field, and every troop as a `<g>` at its ground
 * slot wrapping a `<use>` of its sprite symbol. The inner `<use>` wanders on
 * a CSS loop keyed by troop index; the outer `<g>` hops in from the finger.
 *
 * What this port ADDS to the mockup, for the founder's rulings of 2026-09-24:
 * a LOCKED look for a field (dark plaque, dimmed crowds, no glow), the
 * plaque's second line saying what is LEFT (easy) or placed (hard), and a
 * `Locked` state. Vanilla DOM: the Arena component owns one instance and
 * feeds it the reducer's grid on every change.
 */

import type { BoardMode } from '@/battle/board/mode';
import type { Camera } from './camera';
import { FOREST_TILE, FOREST_TILE_PX, MAP_IMAGE, SPRITE_IDS, STAT_COLORS, spriteDefs, svgEl } from './figures';
import { GEOMETRY, type Field, type MapLayout, type Point, blobRadius, troopSlot } from './map';

interface GroupNodes {
  hit: SVGEllipseElement;
  chip: SVGGElement;
  chipText: SVGTextElement;
  troops: SVGGElement[];
}
interface FieldNodes {
  hitPolygon: SVGPolygonElement;
  fieldGroup: SVGGElement;
  sprites: SVGGElement;
  groups: GroupNodes[];
  plaque: SVGGElement;
  score: SVGTextElement;
  sub: SVGTextElement;
}

export interface PlaqueLine {
  /** The big line under the field's name. */
  score: string;
  /** The small line under that (what is left, or blank). */
  sub: string;
  full: boolean;
  locked: boolean;
}

const HOP_MS = 220;
const WANDER_SECONDS = [5.2, 6.1, 7.3, 8.4];

export class MapRenderer {
  readonly svg: SVGSVGElement;
  readonly world: SVGGElement;
  private fields = new Map<number, FieldNodes>();
  /** World point new troops hop in from (the finger); null = appear in place. */
  spawnFrom: Point | null = null;

  constructor(
    container: HTMLElement,
    readonly layout: MapLayout,
    readonly camera: Camera,
    label: string
  ) {
    this.svg = svgEl('svg', { class: 'bba-map', width: '100%', height: '100%', role: 'img', 'aria-label': label });
    this.svg.append(spriteDefs(), this.defs());
    this.world = svgEl('g', { class: 'bba-world' });
    this.svg.append(this.world);
    container.append(this.svg);
    this.build();
    camera.subscribe(() => this.applyCamera());
    this.applyCamera();
  }

  destroy(): void {
    this.svg.remove();
  }

  applyCamera(): void {
    this.world.setAttribute('transform', this.camera.transformAttr());
  }

  private defs(): SVGDefsElement {
    const defs = svgEl('defs');
    const px = this.layout.image.size / 1024;
    const tile = FOREST_TILE_PX * px;
    const pattern = svgEl('pattern', { id: 'bba-forest', patternUnits: 'userSpaceOnUse', width: tile, height: tile, x: 0, y: 0 });
    pattern.append(svgEl('image', { href: FOREST_TILE, x: 0, y: 0, width: tile, height: tile, preserveAspectRatio: 'none' }));
    const grad = svgEl('radialGradient', { id: 'bba-map-fade', gradientUnits: 'userSpaceOnUse', cx: 0, cy: 0, r: GEOMETRY.worldHalf });
    grad.append(svgEl('stop', { offset: '0.9', 'stop-color': '#fff' }), svgEl('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }));
    const mask = svgEl('mask', { id: 'bba-map-mask', maskUnits: 'userSpaceOnUse', x: -4096, y: -4096, width: 8192, height: 8192 });
    mask.append(svgEl('circle', { cx: 0, cy: 0, r: GEOMETRY.worldHalf, fill: 'url(#bba-map-fade)' }));
    defs.append(pattern, grad, mask);
    return defs;
  }

  private build(): void {
    const L = this.layout;
    const H = GEOMETRY.worldHalf * 6;
    const forest = svgEl('rect', { x: -H, y: -H, width: 2 * H, height: 2 * H, fill: 'url(#bba-forest)', class: 'bba-forest' });
    const ground = svgEl('image', {
      href: MAP_IMAGE,
      x: L.image.x,
      y: L.image.y,
      width: L.image.size,
      height: L.image.size,
      class: 'bba-ground',
      preserveAspectRatio: 'none',
      mask: 'url(#bba-map-mask)',
    });
    const fieldsLayer = svgEl('g', { class: 'bba-layer-fields' });
    const crowdLayer = svgEl('g', { class: 'bba-layer-crowds' });
    const plaqueLayer = svgEl('g', { class: 'bba-layer-plaques' });

    for (const field of L.fields) {
      const hitPolygon = svgEl('polygon', {
        points: field.polygon.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
        class: 'bba-field-hit',
        'data-field': field.index,
        'stroke-linejoin': 'round',
      });
      fieldsLayer.append(hitPolygon);
      const fieldGroup = svgEl('g', { class: 'bba-crowd-field', 'data-field': field.index });
      const sprites = svgEl('g', { class: 'bba-crowd-sprites' });
      fieldGroup.append(sprites);
      const groups = [0, 1, 2, 3, 4].map((stat) => this.buildGroup(field, stat, fieldGroup));
      crowdLayer.append(fieldGroup);
      const { plaque, score, sub } = this.buildPlaque(field, plaqueLayer);
      this.fields.set(field.index, { hitPolygon, fieldGroup, sprites, groups, plaque, score, sub });
    }

    this.world.append(forest, ground, fieldsLayer, crowdLayer, plaqueLayer);
  }

  private buildGroup(field: Field, stat: number, layer: SVGGElement): GroupNodes {
    const hit = svgEl('ellipse', { class: 'bba-crowd-hit', 'data-field': field.index, 'data-stat': stat, visibility: 'hidden' });
    const chip = svgEl('g', { class: 'bba-crowd-chip', 'data-field': field.index, 'data-stat': stat, visibility: 'hidden', role: 'button' });
    const chipText = svgEl('text', { class: 'bba-crowd-count', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, ['0']);
    chip.append(
      svgEl('rect', { x: -30, y: -19, width: 60, height: 38, rx: 12, class: 'bba-crowd-chip-shadow' }),
      svgEl('rect', { x: -30, y: -22, width: 60, height: 38, rx: 12, class: 'bba-crowd-chip-bg', fill: STAT_COLORS[stat] }),
      chipText
    );
    chipText.setAttribute('y', '-3');
    layer.append(hit, chip);
    return { hit, chip, chipText, troops: [] };
  }

  private buildPlaque(field: Field, layer: SVGGElement): { plaque: SVGGElement; score: SVGTextElement; sub: SVGTextElement } {
    const { x, y } = field.plaque;
    const plaque = svgEl('g', { class: 'bba-plaque', 'data-field': field.index, role: 'button', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` });
    const score = svgEl('text', { x: 0, y: 16, class: 'bba-plaque-score', 'text-anchor': 'middle' }, ['0 / 100']);
    const sub = svgEl('text', { x: 0, y: 40, class: 'bba-plaque-sub', 'text-anchor': 'middle' }, ['']);
    plaque.append(
      svgEl('rect', { x: -122, y: -66, width: 244, height: 132, rx: 30, class: 'bba-plaque-hit' }),
      svgEl('rect', { x: -108, y: -52, width: 216, height: 104, rx: 22, class: 'bba-plaque-bg' }),
      svgEl('text', { x: 0, y: -18, class: 'bba-plaque-name', 'text-anchor': 'middle' }, [field.name]),
      score,
      sub
    );
    layer.append(plaque);
    return { plaque, score, sub };
  }

  /** A troop card is armed: fields glow so the player sees where to press. */
  setArmed(armed: boolean): void {
    this.svg.classList.toggle('bba-armed', armed);
  }

  /** The finger is over a field while deploying (null clears). */
  setHover(field: number | null): void {
    for (const [i, n] of this.fields) n.hitPolygon.classList.toggle('bba-hover', i === field);
  }

  /** World point above a crowd, for anchoring a popover. Null if empty. */
  groupCentre(grid: readonly (readonly number[])[], field: number, stat: number): Point | null {
    const f = this.layout.fields[field];
    if (!f || (grid[field]?.[stat] ?? 0) === 0) return null;
    const c = f.rallyPoints[stat] as Point;
    return { x: c.x, y: c.y - GEOMETRY.spriteSize * 0.6 };
  }

  /** Redraw crowds, chips and plaques from the reducer's grid. */
  update(grid: readonly (readonly number[])[], locked: readonly boolean[], mode: BoardMode, plaqueFor: (field: number) => PlaqueLine): void {
    const size = GEOMETRY.spriteSize;
    const from = this.spawnFrom;
    const cap = mode === 'easy' ? 100 : 700;
    for (const field of this.layout.fields) {
      const n = this.fields.get(field.index);
      if (!n) continue;
      const counts = grid[field.index] ?? [0, 0, 0, 0, 0];
      let changed = false;
      for (let stat = 0; stat < 5; stat++) {
        const c = Math.min(cap, counts[stat] ?? 0);
        const g = n.groups[stat] as GroupNodes;
        while (g.troops.length < c) {
          const t = this.makeTroop(stat, g.troops.length);
          if (from) {
            t.style.transform = `translate(${from.x.toFixed(1)}px, ${from.y.toFixed(1)}px)`;
            t.classList.add('bba-hop');
            window.setTimeout(() => t.classList.remove('bba-hop'), HOP_MS + 40);
          }
          n.sprites.append(t);
          g.troops.push(t);
          changed = true;
        }
        while (g.troops.length > c) {
          g.troops.pop()?.remove();
          changed = true;
        }
        g.hit.setAttribute('visibility', c > 0 ? 'visible' : 'hidden');
        g.chip.setAttribute('visibility', c > 0 ? 'visible' : 'hidden');
        if (c === 0) continue;
        for (let i = 0; i < c; i++) {
          const p = troopSlot(field, stat, i);
          const t = g.troops[i] as SVGGElement;
          const tr = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
          if (t.classList.contains('bba-hop')) requestAnimationFrame(() => (t.style.transform = tr));
          else t.style.transform = tr;
          t.dataset.y = p.y.toFixed(1);
        }
        const centre = field.rallyPoints[stat] as Point;
        const r = blobRadius(c);
        g.hit.setAttribute('cx', String(centre.x));
        g.hit.setAttribute('cy', String(centre.y - size * 0.45));
        g.hit.setAttribute('rx', String(r + size * 0.45));
        g.hit.setAttribute('ry', String(r * GEOMETRY.groundSquash + size * 0.55));
        g.chip.setAttribute('transform', `translate(${centre.x.toFixed(1)} ${(centre.y - r * GEOMETRY.groundSquash - size * 1.05).toFixed(1)})`);
        g.chipText.textContent = String(counts[stat] ?? 0);
      }
      if (changed) this.sortSprites(n.sprites);
      const line = plaqueFor(field.index);
      n.score.textContent = line.score;
      n.sub.textContent = line.sub;
      n.plaque.classList.toggle('bba-complete', line.full);
      n.plaque.classList.toggle('bba-locked', line.locked);
      n.fieldGroup.classList.toggle('bba-locked', locked[field.index] === true);
      n.hitPolygon.classList.toggle('bba-locked', locked[field.index] === true);
    }
  }

  private makeTroop(stat: number, i: number, size: number = GEOMETRY.spriteSize): SVGGElement {
    const t = svgEl('g', { class: 'bba-troop' });
    const body = svgEl('use', { href: `#${SPRITE_IDS[stat]}`, width: size, height: size, x: -size / 2, y: -size * 0.94, class: 'bba-troop-body' });
    body.style.setProperty('--wander-s', `${WANDER_SECONDS[i % WANDER_SECONDS.length]}s`);
    body.style.setProperty('--wander-delay', `${(-(i * 0.61) % 9).toFixed(2)}s`);
    t.append(body);
    return t;
  }

  /** Painter's order: farther (smaller ground y) first. */
  private sortSprites(layer: SVGGElement): void {
    const kids = Array.from(layer.children) as SVGGElement[];
    kids.sort((a, b) => Number(a.dataset.y ?? 0) - Number(b.dataset.y ?? 0));
    let inOrder = true;
    for (let i = 0; i < kids.length; i++) {
      if (layer.children[i] !== kids[i]) {
        inOrder = false;
        break;
      }
    }
    if (!inOrder) layer.append(...kids);
  }
}
