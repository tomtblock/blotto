/**
 * The two-runtimes gate (roadmap 2.1): the engine must produce identical
 * output from a BROWSER bundle. esbuild bundles src/ with platform:
 * 'browser' — any accidental Node builtin fails resolution right here — and
 * the bundle is executed in a scope with no `require`, then checked against
 * a full-pool vector's Python-computed root.
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';

// mocha runs from the package root; this spec avoids __dirname because the
// esbuild import makes the loader treat it as an ES module.
const ROOT = process.cwd();
import { buildSync } from 'esbuild';

const vectors = JSON.parse(
  readFileSync(join(ROOT, 'fixtures', 'vectors.json'), 'utf8')
);

describe('browser bundle', () => {
  it('bundles for the browser and reproduces a full-pool root', function () {
    this.timeout(30000);
    const out = buildSync({
      entryPoints: [join(ROOT, 'src', 'index.ts')],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'BlottoScoring',
    });
    const code = out.outputFiles[0].text;
    // No `require`, no `process`, no Buffer in scope — a browser page.
    const factory = new Function(
      'require',
      'process',
      'Buffer',
      `${code}; return BlottoScoring;`
    );
    const scoring = factory(undefined, undefined, undefined);

    const pool = vectors.pools.find((p: any) => p.name === 'full_0');
    const pot = scoring.potForEntry(BigInt(pool.entry_lamports));
    const results = scoring.assignPrizes(
      scoring.scorePool(pool.players.map((p: any) => p.battles)),
      pot
    );
    // Leaf order under D3-B: rank asc, entry index asc (ranks repeat).
    const byRank = [...results].sort((a: any, b: any) => a.rank - b.rank || a.index - b.index);
    const unhex = (s: string) =>
      new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
    const leaves = byRank.map((r: any) =>
      scoring.leafBytes({
        player: unhex(pool.players_pubkeys[r.index]),
        rank: r.rank,
        amountLamports: r.amountLamports,
      })
    );
    const root = Array.from(scoring.merkleRoot(leaves) as Uint8Array)
      .map((b: number) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(root).to.equal(pool.root);
  });

  it('the browser copy scores a pool with lost ciphertexts identically', function () {
    this.timeout(30000);
    // scoreWithMissing is what the verify page actually calls (app/src/verify/
    // logic.ts) — a settled pool with a lost entry is recomputed in the
    // browser through this path, not through scorePool. Before 2026-09-21 it
    // lived in @blotto/reveal and was never bundled here, so the one function
    // the page depends on was the one the two-runtimes gate did not cover.
    const out = buildSync({
      entryPoints: [join(ROOT, 'src', 'index.ts')],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'BlottoScoring',
    });
    const scoring = new Function(
      'require',
      'process',
      'Buffer',
      `${out.outputFiles[0].text}; return BlottoScoring;`
    )(undefined, undefined, undefined);

    const pool = vectors.missing_pools.find((p: any) => p.name === 'full_64_five_missing');
    expect(pool, 'the full_64_five_missing vector').to.not.equal(undefined);
    const results = scoring.scoreWithMissing(
      pool.players.map((p: any, i: number) => ({ index: i, battles: p === null ? null : p.battles }))
    );
    for (const expected of pool.results) {
      const got = results[expected.index];
      expect(got.scoreHalf, `score of seat ${expected.index}`).to.equal(expected.score_half);
      expect(got.zones, `zones of seat ${expected.index}`).to.equal(expected.zones);
      expect(got.rank, `rank of seat ${expected.index}`).to.equal(expected.rank);
    }
  });
});
