/*
 * The D4 Lighthouse gate: performance ≥ 90 and accessibility ≥ 90 on the
 * Play page and the Pool page (v3 D4), run against the production build in
 * fixture mode. `npm run build` first; this script starts its own server.
 *
 *   CHROME_PATH=… node scripts/lighthouse-gate.mjs   (defaults to the
 *   environment's Playwright Chromium)
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';

const PORT = 4311;
const BASE = `http://127.0.0.1:${PORT}`;
const POOL = 'F1XTUREPoo1111111111111111111111111111111111';
const THRESHOLD = 90;
const PAGES = [
  { name: 'play', url: `${BASE}/` },
  { name: 'pool', url: `${BASE}/pools/${POOL}` },
];

const chromePath =
  process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`server did not come up on ${BASE}`);
}

// Detached process group so the SIGTERM below reaches the actual server,
// not just the npx wrapper (an orphaned next-server holding the port made
// one Lighthouse run measure a stale build).
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  stdio: 'ignore',
  detached: true,
});

let failed = false;
try {
  await waitForServer();
  const chrome = await launch({
    chromePath,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    for (const page of PAGES) {
      const result = await lighthouse(page.url, {
        port: chrome.port,
        onlyCategories: ['performance', 'accessibility'],
        output: 'json',
      });
      const perf = Math.round((result.lhr.categories.performance.score ?? 0) * 100);
      const a11y = Math.round((result.lhr.categories.accessibility.score ?? 0) * 100);
      const ok = perf >= THRESHOLD && a11y >= THRESHOLD;
      if (!ok) failed = true;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${page.name.padEnd(5)} performance ${perf}  accessibility ${a11y}` +
          `  (threshold ${THRESHOLD})`
      );
      if (!ok) {
        const audits = Object.values(result.lhr.audits)
          .filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode === 'binary')
          .slice(0, 10)
          .map((a) => ` - ${a.id}: ${a.title}`);
        if (audits.length) console.log(audits.join('\n'));
      }
    }
  } finally {
    chrome.kill();
  }
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
}

process.exit(failed ? 1 : 0);
