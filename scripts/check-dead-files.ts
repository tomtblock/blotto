/**
 * The dead-files gate (founder instruction 2026-09-24: "the cleanliness of
 * this repo is very important").
 *
 * WHY THIS EXISTS. When the battle board replaced the dials on 2026-09-24, the
 * dial run stayed in the tree behind a switch, and with it about 4,000 lines
 * nothing a player could reach still used — plus two components dead since
 * the one-paid-place ruling (D-E2) weeks earlier, and a pair of features (the
 * Blott stills) that had quietly gone dark because their only writer left.
 * None of it failed a build. Every gate here reports on what code SAYS; none
 * reported on whether anything still RAN it. The retirement is recorded in
 * docs/CHANGE-2026-09-24_battle-board.md §8–9; this makes the next one a
 * review comment on the change that orphans a file, not an audit months on.
 *
 * WHAT IT CHECKS. One rule, over the app's source (`app/src`, TypeScript and
 * CSS):
 *
 *   Every non-test source file is reachable, through its imports, from a
 *   route Next serves — a production route, or a development-only
 *   `page.dev.tsx` route (next.config.ts `pageExtensions`) — or it is
 *   declared below with the reason it exists.
 *
 * A file reached ONLY by its own tests is dead: tests prove code works, they
 * are not a reason for it to exist. The declared exceptions are the other
 * half of the rule and cost one line each, at the moment a file is kept on
 * purpose — the same bargain as the superseded values in
 * check-published-numbers.ts.
 *
 * WHAT IT DOES NOT CHECK. Unused EXPORTS inside a live file (a live module
 * may export a type its test uses), unused copy keys, or public assets: an
 * image is often named by a template string (`/blott/${pose}.webp`), which a
 * static reader cannot resolve, and a gate that guesses will be switched off.
 * Those are for the next audit, not a build failure.
 *
 * HOW IT READS. Static `import`/`export … from`, `import()` and `require()`
 * with a literal specifier; CSS `@import`. The `@/` alias maps to `app/src`
 * (tsconfig `paths`). A bare package specifier is not a file in this tree
 * and is skipped. A relative or `@/` specifier that resolves to NOTHING is
 * reported too — it means the reader is blind to a real edge.
 *
 * Run: npx tsx scripts/check-dead-files.ts [--self-test]
 * Exit: 0 clean · 1 the tree has a dead file · 2 this gate is broken.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, extname, join, relative, resolve } from 'path';

/* ---------------------------------------------------------------- policy */

/**
 * Files kept on purpose though no route reaches them. Path is relative to
 * `app/src`. Every entry says why; an entry whose file is gone, or which a
 * route now reaches, fails the gate so the list cannot rot.
 */
const DECLARED: Record<string, string> = {
  'reveal/fixtures.ts':
    'Test support: the fixed reveal outcome reveal/machine.test.ts replays. A fixture is meant to be test-only.',
};

const SOURCE_EXTS = ['.ts', '.tsx', '.css'];
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css'];

/** Next's route-convention file names (app router). */
const ROUTE_NAMES =
  /^(page|layout|route|loading|error|not-found|template|default|global-error|global-not-found|forbidden|unauthorized|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)(\.dev)?\.(tsx?|jsx?)$/;
/** Files at the source root Next loads by convention. */
const ROOT_ENTRIES = /^(proxy|middleware|instrumentation|instrumentation-client)\.(ts|js)$/;

const isTest = (rel: string) => /\.(test|spec)\.(tsx?|jsx?)$/.test(rel);
const isDeclarationFile = (rel: string) => rel.endsWith('.d.ts');

/* ------------------------------------------------------ the pure core */

export interface Tree {
  /** Every file under the source root, relative, with `/` separators. */
  files: readonly string[];
  read(rel: string): string;
}

export interface Verdict {
  dead: string[];
  unresolved: string[];
  staleDeclared: string[];
  reachable: number;
  entries: number;
}

const IMPORT_RE =
  /(?:^|[^\w$.])(?:import|export)\s+(?:type\s+)?(?:[\w$*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]|(?:^|[^\w$.])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[^\w$.])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const CSS_IMPORT_RE = /@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g;

/** Strip comments so a path named in prose is never read as an edge. */
function stripComments(src: string, css: boolean): string {
  const block = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return css ? block : block.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Resolve `.` and `..`; null when the path climbs out of the source root. */
function normalise(p: string): string | null {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

/**
 * A specifier's file, relative to the source root; `'package'` for a bare
 * package name; `'outside'` for a path that leaves the source root (a test
 * reading next.config.ts or a backend package) — neither is an edge here;
 * null when it names a file in this tree that does not exist.
 */
export function resolveSpecifier(
  fromRel: string,
  spec: string,
  has: (rel: string) => boolean
): string | null | 'package' | 'outside' {
  let base: string | null;
  if (spec.startsWith('@/')) base = normalise(spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = normalise(`${dirname(fromRel)}/${spec}`);
  else return 'package';
  if (base === null) return 'outside';
  const candidates = [base, ...RESOLVE_EXTS.map((x) => base + x), ...RESOLVE_EXTS.map((x) => `${base}/index${x}`)];
  for (const c of candidates) if (has(c)) return c;
  return null;
}

export function judge(tree: Tree, declared: Record<string, string>): Verdict {
  const sources = tree.files.filter((f) => SOURCE_EXTS.includes(extname(f)) && !isDeclarationFile(f));
  const all = new Set(tree.files);
  const has = (rel: string) => all.has(rel);

  const edges = new Map<string, string[]>();
  const unresolved: string[] = [];
  for (const f of sources) {
    const css = f.endsWith('.css');
    const text = stripComments(tree.read(f), css);
    const out: string[] = [];
    for (const m of text.matchAll(css ? CSS_IMPORT_RE : IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec) continue;
      const r = resolveSpecifier(f, spec, has);
      if (r === 'package' || r === 'outside') continue;
      if (r === null) unresolved.push(`${f} -> ${spec}`);
      else out.push(r);
    }
    edges.set(f, out);
  }

  const entries = sources.filter((f) => {
    if (isTest(f)) return false;
    const name = f.split('/').pop() as string;
    if (!f.includes('/') && ROOT_ENTRIES.test(name)) return true;
    return f.startsWith('app/') && ROUTE_NAMES.test(name);
  });

  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const d of edges.get(f) ?? []) stack.push(d);
  }

  const dead = sources.filter((f) => !isTest(f) && !seen.has(f) && !(f in declared)).sort();
  const staleDeclared = Object.keys(declared)
    .filter((f) => !all.has(f) || seen.has(f))
    .map((f) => (all.has(f) ? `${f} (a route reaches it now; drop the declaration)` : `${f} (no such file)`))
    .sort();
  return { dead, unresolved: unresolved.sort(), staleDeclared, reachable: seen.size, entries: entries.length };
}

/* ---------------------------------------------------------- self-test */

function selfTest(): boolean {
  const files: Record<string, string> = {
    'proxy.ts': `import { gate } from '@/gate/gate';`,
    'gate/gate.ts': `export const gate = 1;`,
    'app/layout.tsx': `import './globals.css';\nimport { Shell } from '@/components/shell';`,
    'app/globals.css': `@import "../styles/tokens.css";`,
    'styles/tokens.css': `:root{}`,
    'components/shell/index.tsx': `export { Shell } from './shell';`,
    'components/shell/shell.tsx': `export function Shell() { return null; }`,
    'app/play/page.tsx': `const Lazy = () => import('../../battle/lazy');\nexport default function P(){}`,
    'battle/lazy.ts': `export const lazy = 1;`,
    'app/dev/gallery/page.dev.tsx': `import { Demo } from '@/components/demo';`,
    'components/demo.tsx': `export function Demo(){}`,
    // Dead: nothing imports it.
    'components/orphan.tsx': `export function Orphan(){}`,
    // Dead: only its own test reaches it.
    'battle/old-machine.ts': `export const m = 1;`,
    'battle/old-machine.test.ts': `import { m } from './old-machine';`,
    // Named only in a comment — must NOT count as an edge.
    'app/about/page.tsx': `// import { Ghost } from '@/components/ghost';\n/* see ../../components/ghost */\nexport default function A(){}`,
    'components/ghost.tsx': `export function Ghost(){}`,
    // Declared on purpose, reached only by a test.
    'reveal/fixtures.ts': `export const f = 1;`,
    'reveal/machine.test.ts': `import { f } from './fixtures';`,
    // A package import is not an edge and not unresolved.
    'components/uses-pkg.tsx': `import { x } from '@blotto/scoring';`,
    // An import that resolves to nothing.
    'app/broken/page.tsx': `import { y } from '@/components/missing';\nimport './uses-pkg-live';`,
    'app/broken/uses-pkg-live.tsx': `import '@/components/uses-pkg';`,
    // A declaration file is never a finding.
    'types/env.d.ts': `declare const X: string;`,
    // A test reaching outside the tree (next.config.ts, a backend package) is neither.
    'chain/headers.test.ts': `import config from '../../next.config';`,
  };
  const tree: Tree = { files: Object.keys(files), read: (rel) => files[rel] as string };
  const v = judge(tree, {
    'reveal/fixtures.ts': 'test support',
    'components/demo.tsx': 'stale on purpose: a dev route reaches it',
    'components/gone.tsx': 'stale on purpose: no such file',
  });
  const expectEq = (label: string, got: unknown, want: unknown) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) console.error(`  self-test FAILED: ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
    return ok;
  };
  const r = [
    expectEq('dead files', v.dead, ['battle/old-machine.ts', 'components/ghost.tsx', 'components/orphan.tsx']),
    expectEq('unresolved', v.unresolved, ['app/broken/page.tsx -> @/components/missing']),
    expectEq('stale declarations', v.staleDeclared, [
      'components/demo.tsx (a route reaches it now; drop the declaration)',
      'components/gone.tsx (no such file)',
    ]),
    expectEq(
      'resolution: alias, index, relative, extension',
      [
        resolveSpecifier('app/layout.tsx', '@/components/shell', (p) => p in files),
        resolveSpecifier('app/play/page.tsx', '../../battle/lazy', (p) => p in files),
        resolveSpecifier('app/layout.tsx', './globals.css', (p) => p in files),
        resolveSpecifier('app/layout.tsx', 'react', (p) => p in files),
        resolveSpecifier('chain/headers.test.ts', '../../next.config', (p) => p in files),
      ],
      ['components/shell/index.tsx', 'battle/lazy.ts', 'app/globals.css', 'package', 'outside']
    ),
  ];
  return r.every(Boolean);
}

/* --------------------------------------------------------------- live */

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(root, p, out);
    else out.push(relative(root, p).split('\\').join('/'));
  }
  return out;
}

function main(): number {
  if (!selfTest()) {
    console.error('dead-files gate: BROKEN — the self-test failed, so no verdict is reported.');
    return 2;
  }
  if (process.argv.includes('--self-test')) {
    console.log('dead-files gate: self-test passed');
    return 0;
  }
  const root = resolve(__dirname, '..', 'app', 'src');
  if (!existsSync(root)) {
    console.error(`dead-files gate: BROKEN — ${root} does not exist.`);
    return 2;
  }
  const tree: Tree = { files: walk(root), read: (rel) => readFileSync(join(root, rel), 'utf8') };
  const v = judge(tree, DECLARED);
  if (v.entries === 0 || v.reachable === 0) {
    console.error('dead-files gate: BROKEN — found no routes under app/src/app; the entry rule no longer matches this tree.');
    return 2;
  }
  const problems = v.dead.length + v.unresolved.length + v.staleDeclared.length;
  if (problems === 0) {
    console.log(`dead-files gate: clean — ${v.reachable} files reached from ${v.entries} routes, ${Object.keys(DECLARED).length} declared (self-test passed)`);
    return 0;
  }
  console.error('dead-files gate: FAILED.\n');
  if (v.dead.length) {
    console.error('Not reachable from any route (production or dev) and not declared:');
    for (const f of v.dead) console.error(`  app/src/${f}`);
    console.error('\nDelete the file, or wire it to what should use it, or — if it is kept on');
    console.error('purpose — add it to DECLARED in scripts/check-dead-files.ts with the reason.\n');
  }
  if (v.unresolved.length) {
    console.error('Imports that resolve to no file (the gate cannot see past them):');
    for (const u of v.unresolved) console.error(`  app/src/${u}`);
    console.error('');
  }
  if (v.staleDeclared.length) {
    console.error('Declarations that no longer apply:');
    for (const s of v.staleDeclared) console.error(`  ${s}`);
    console.error('');
  }
  return 1;
}

process.exit(main());
