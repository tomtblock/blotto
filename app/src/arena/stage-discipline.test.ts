/*
 * Arena choreography-discipline source scans — the reveal's
 * stage-discipline.test.ts applied to the arena's animated surfaces
 * (src/reveal/stage-discipline.test.ts is the canon; new arena stages are
 * added to the STAGES list HERE so they inherit the scans by construction).
 *
 * One deliberate divergence from the reveal's scan, documented: the arena
 * MAY name the price-up/price-down tokens — its pips and tally ARE win/loss
 * facts, the exact functional semantics those tokens are reserved FOR
 * (tokens.css reservation rules). Class and gold tokens stay forbidden as
 * literals: class colour has one door (classColorToken), and the arena
 * walks it inside the shared Creature component.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(path.join(__dirname, p), 'utf8');

const STAGES: { name: string; source: string }[] = [
  { name: 'battle-stage', source: read('playback/battle-stage.tsx') },
  { name: 'lobby-stage', source: read('lobby/lobby-stage.tsx') },
  { name: 'creature', source: read('creature/creature.tsx') },
  { name: 'character-sheet', source: read('builder/character-sheet.tsx') },
];

const ANIMATION_PROPS = ['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'whileInView'];

function animationPropBlocks(source: string): { prop: string; body: string }[] {
  const blocks: { prop: string; body: string }[] = [];
  for (const prop of ANIMATION_PROPS) {
    const marker = `${prop}={`;
    let from = 0;
    for (;;) {
      const at = source.indexOf(marker, from);
      if (at === -1) break;
      let depth = 0;
      let end = at + marker.length - 1;
      for (; end < source.length; end++) {
        const ch = source[end];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      blocks.push({ prop, body: source.slice(at + marker.length - 1, end + 1) });
      from = end;
    }
  }
  return blocks;
}

describe('arena stage choreography discipline', () => {
  it('found animation props to scan (the scan is not blind)', () => {
    const total = STAGES.reduce((n, s) => n + animationPropBlocks(s.source).length, 0);
    expect(total).toBeGreaterThan(3);
  });

  it('no numeric literal except 0 and 1 in any animation prop', () => {
    for (const { name, source } of STAGES) {
      for (const { prop, body } of animationPropBlocks(source)) {
        const stripped = body.replace(/"[^"]*"|'[^']*'/g, '');
        const numbers = stripped.match(/(?<![\w.])\d+(?:\.\d+)?/g) ?? [];
        const offenders = numbers.filter((n) => n !== '0' && n !== '1');
        expect(
          offenders,
          `${name}: ${prop}=${body.slice(0, 120)}… carries inline magnitudes: ${offenders.join(', ')}`
        ).toEqual([]);
      }
    }
  });

  it('no randomness or clock in stage source (NG-007)', () => {
    for (const { name, source } of STAGES) {
      expect(/Math\.random|Date\.now|new Date\(/.test(source), name).toBe(false);
    }
  });

  it('the lobby renders the SHARED pass — no second egg implementation', () => {
    const lobby = STAGES.find((s) => s.name === 'lobby-stage')!.source;
    expect(lobby).toContain("from '@/reveal/components/pass-shell'");
    expect(/M100 8 C/.test(lobby)).toBe(false);
  });

  it('no class or gold colour token literal in ANY arena stage source', () => {
    for (const { name, source } of STAGES) {
      expect(/--color-class|--color-rarity|bg-class|text-class|rarity-gold/.test(source), name).toBe(
        false
      );
    }
  });

  it('class colour enters the arena ONLY through the mapping module (via Creature)', () => {
    const creature = STAGES.find((s) => s.name === 'creature')!.source;
    expect(creature).toContain("from '@/reveal/class-colour'");
    expect(creature).toContain('classColorToken(');
  });

  it('the builder dispatches ONLY the battle machine’s existing event alphabet', () => {
    const builderSources = [
      read('builder/arena-builder-flow.tsx'),
      read('builder/character-sheet.tsx'),
      read('builder/team-review.tsx'),
    ].join('\n');
    const dispatched = [...builderSources.matchAll(/type:\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(dispatched.length).toBeGreaterThan(0);
    for (const t of dispatched) {
      expect(['drag', 'even_split', 'tick', 'lock_in', 'confirm']).toContain(t);
    }
    // No second mechanic: the builder must not carry its own allocation math.
    expect(/normalize\(|dragTo\(/.test(builderSources)).toBe(false);
  });
});
