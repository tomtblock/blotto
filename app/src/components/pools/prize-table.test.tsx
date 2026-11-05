/*
 * The prize table and its words (D-E19, the Ladder; founder brief
 * 2026-11-05): rows per band — 1st, 2nd, 3rd, 4th, 5th–8th, 9th–16th — only
 * the bands a size pays, amounts in SOL from the pool's own table, never a
 * multiple of the entry or a percentage. Rendered with react-dom/server, no
 * DOM (vitest.config.mts).
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { LADDER_TABLES, TIER_ENTRY_LAMPORTS, amountForRank, type PoolCapacity } from '@blotto/scoring';
import { COPY } from '@/copy';
import { prizeBands, prizeRuns } from '@/data/prizes';
import { PrizeTable, prizeSentence, prizeSummary } from './prize-table';

const ENTRY = TIER_ENTRY_LAMPORTS[0]!;
/** A size's launch amounts at 0.1 SOL, from the engine — never typed. */
const amounts = (capacity: PoolCapacity) =>
  LADDER_TABLES[capacity].map((_, i) => amountForRank(LADDER_TABLES[capacity], ENTRY, i + 1));
const text = (html: string) => html.replaceAll('<!-- -->', '');

describe('prizeBands', () => {
  it('cuts the fixed bands to the places a size pays', () => {
    const shape = (c: PoolCapacity) => prizeBands(amounts(c)).map((b) => [b.from, b.to]);
    expect(shape(8)).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(shape(16)).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    expect(shape(32)).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 8],
    ]);
    expect(shape(64)).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 8],
      [9, 16],
    ]);
  });

  it('splits a band whose places differ rather than printing an "each" that would be false', () => {
    // A well-formed on-chain table the launch tables never use: 5th–8th unequal.
    const table = [8n, 4n, 2n, 2n, 2n, 2n, 1n, 1n];
    expect(prizeBands(table).map((b) => [b.from, b.to, b.each])).toEqual([
      [1, 1, 8n],
      [2, 2, 4n],
      [3, 3, 2n],
      [4, 4, 2n],
      [5, 5, 2n],
      [6, 6, 2n],
      [7, 7, 1n],
      [8, 8, 1n],
    ]);
  });

  it('a one-place pool (before the Ladder) is one row', () => {
    expect(prizeBands([4_000_000_000n])).toEqual([{ from: 1, to: 1, each: 4_000_000_000n }]);
  });
});

describe('the prize sentence', () => {
  it('reads as the founder wrote it, from the table', () => {
    expect(prizeRuns(amounts(32)).map((r) => [r.from, r.to])).toEqual([
      [1, 1],
      [2, 2],
      [3, 4],
      [5, 8],
    ]);
    expect(prizeSentence(amounts(32))).toBe(
      'The prizes are fixed and funded before entries open. 1st 0.8 SOL, 2nd 0.4 SOL, 3rd and 4th 0.2 SOL each, 5th to 8th 0.1 SOL each.'
    );
    expect(prizeSentence(amounts(8))).toBe('The prizes are fixed and funded before entries open. 1st 0.3 SOL, 2nd 0.2 SOL.');
    expect(prizeSentence(amounts(64))).toContain('9th to 16th 0.1 SOL each.');
  });

  it('describes a pool by players and prizes, never a multiple or a percentage', () => {
    expect(prizeSummary(16, amounts(16))).toBe('16 players · 4 prizes · 1st 0.5 SOL');
    expect(prizeSummary(8, amounts(8))).toBe('8 players · 2 prizes · 1st 0.3 SOL');
    expect(prizeSummary(64, [4_000_000_000n])).toBe('64 players · 1 prize · 1st 4 SOL');
    expect(prizeSummary(32, [])).toBe('32 players');
    for (const c of [8, 16, 32, 64] as const) {
      const words = `${prizeSummary(c, amounts(c))} ${prizeSentence(amounts(c))}`;
      expect(words).not.toMatch(/\d+\s*[×x]\b|%|\bpot\b|\bseat|winner takes|\bc[a]sh|\bchance/i);
    }
  });
});

describe('PrizeTable', () => {
  it('renders a real table on the pool page: a row per band, the amounts in SOL', () => {
    const html = text(renderToString(<PrizeTable amounts={amounts(64)} capacity={64} />));
    expect(html).toContain('<table');
    expect(html).toContain(COPY.prizes.tableLabel(64));
    expect(html.match(/data-testid="prize-band"/g)?.length).toBe(6);
    expect(html).toContain('>1st<');
    expect(html).toContain('1.2 SOL');
    expect(html).toContain('5th–8th');
    expect(html).toContain('0.2 SOL each');
    expect(html).toContain('9th–16th');
    expect(html).toContain('0.1 SOL each');
  });

  it('renders the landing card’s compact strip with only the bands the size pays', () => {
    const html = text(renderToString(<PrizeTable amounts={amounts(16)} capacity={16} variant="compact" tone="dark" />));
    expect(html).not.toContain('<table');
    expect(html).toContain(`aria-label="${COPY.prizes.tableLabel(16)}"`);
    expect(html.match(/data-testid="prize-band"/g)?.length).toBe(4);
    expect(html).toContain('0.5 SOL');
    expect(html).toContain('4th');
    expect(html).not.toContain('5th');
  });
});
