/*
 * Troop art and the SVG helpers — ported from the mockup (src/canvas/figures.ts,
 * src/canvas/svg.ts). The five troops are painted sprites in
 * /public/board-art (generated once in the mockup, copied here; the app never
 * generates art). Each is the same Blotto with different kit: Strength
 * hammer · Speed skateboard · Heart flag · Wit wand · Durability bin lid.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';
type Attrs = Record<string, string | number | boolean | undefined>;

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, children: (Element | string)[] = []): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export function setAttrs(el: Element, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) el.removeAttribute(k);
    else el.setAttribute(k, String(v === true ? '' : v));
  }
}

const ART = '/board-art';
const NAMES = ['strength', 'speed', 'heart', 'wit', 'durability'] as const;

export const SPRITES: readonly string[] = NAMES.map((n) => `${ART}/sprite-${n}.webp`);
export const SPRITE_IDS: readonly string[] = NAMES.map((n) => `bba-sprite-${n}`);
/** Source pixel size of every sprite file. */
export const SPRITE_PX = 224;

/** Accent per stat, in the fixed order: count chips, the armed card's glow, the stepper's trim. */
export const STAT_COLORS: readonly string[] = ['#ff4d4d', '#2bd3ff', '#ff2f8e', '#b026ff', '#27d17f'];

export const MAP_IMAGE = `${ART}/map.webp`;
export const FOREST_TILE = `${ART}/forest-tile.webp`;
export const FOREST_TILE_PX = 320;

/** `<defs>` with one symbol per troop type; `<use>` places it with the origin between the feet. */
export function spriteDefs(): SVGDefsElement {
  const defs = svgEl('defs');
  SPRITES.forEach((href, stat) => {
    const sym = svgEl('symbol', { id: SPRITE_IDS[stat], viewBox: `0 0 ${SPRITE_PX} ${SPRITE_PX}` });
    sym.append(svgEl('image', { href, width: SPRITE_PX, height: SPRITE_PX, x: 0, y: 0 }));
    defs.append(sym);
  });
  return defs;
}
