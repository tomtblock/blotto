import { describe, expect, it } from 'vitest';
import { GEOMETRY, blobRadius, buildMap, fieldAt, troopSlot } from './map';

describe('arena layout (mockup geometry, unchanged)', () => {
  const layout = buildMap();

  it('has seven fields, numbered clockwise from just right of 12 o\'clock', () => {
    expect(layout.fields).toHaveLength(7);
    expect(layout.fields[0]?.name).toBe('Field 1');
    for (const f of layout.fields) expect(f.a1).toBeGreaterThan(f.a0);
  });

  it('every point of grass belongs to exactly one field; the keep and the forest to none', () => {
    expect(fieldAt(layout, { x: 0, y: 0 })).toBeNull();
    expect(fieldAt(layout, { x: 2000, y: 0 })).toBeNull();
    for (const f of layout.fields) {
      const r = (GEOMETRY.fieldInner + GEOMETRY.fieldOuter) / 2;
      expect(fieldAt(layout, { x: r * Math.cos(f.mid), y: r * Math.sin(f.mid) })).toBe(f.index);
    }
  });

  it('rally points sit inside their field', () => {
    for (const f of layout.fields) for (const p of f.rallyPoints) expect(fieldAt(layout, p)).toBe(f.index);
  });

  it('troop slots depend only on (field, stat, i) and spread out', () => {
    const f = layout.fields[3]!;
    expect(troopSlot(f, 2, 7)).toEqual(troopSlot(f, 2, 7));
    const a = troopSlot(f, 2, 0);
    const b = troopSlot(f, 2, 40);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(50);
    expect(blobRadius(1)).toBe(0);
    expect(blobRadius(100)).toBeGreaterThan(blobRadius(10));
  });
});
