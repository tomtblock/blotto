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
    const results = scoring.scorePool(pool.players.map((p: any) => p.battles));
    const pot = scoring.potLamports(BigInt(vectors.entry_lamports));
    const byRank = [...results].sort((a: any, b: any) => a.rank - b.rank);
    const unhex = (s: string) =>
      new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
    const leaves = byRank.map((r: any) =>
      scoring.leafBytes({
        player: unhex(pool.players_pubkeys[r.index]),
        rank: r.rank,
        amountLamports: scoring.amountForRank(pot, r.rank),
      })
    );
    const root = Array.from(scoring.merkleRoot(leaves) as Uint8Array)
      .map((b: number) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(root).to.equal(pool.root);
  });
});
