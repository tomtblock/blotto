/*
 * Capture every screen, in every state, as a PNG set for design work.
 *
 * The route list is READ OFF /dev/preview at runtime (every link there carries
 * a `data-capture` name) rather than kept here. A second copy of the list
 * would drift the first time a scenario was added, and a screenshot set that
 * silently misses a screen is worse than none — you cannot see what is absent.
 *
 * Two viewports per screen: mobile first, because the product is a
 * ninety-second phone session, and desktop for the admin surfaces.
 *
 * The signed-in screens (/play, /profile, and the share control on results)
 * need a wallet. This injects the automation signer (B-e) at
 * window.__BLOTTO_TEST_SIGNER__ with the fixture player's address — the wallet
 * that holds seat 3 in the paid and escrow scenarios, so "you won" and the
 * escrow copy actually render. It never signs anything; nothing here submits.
 *
 * Usage (from app/):
 *   NEXT_PUBLIC_ALLOW_TEST_SIGNER=1 npm run dev     # in one shell
 *   npm run capture                                  # in another
 */

import { chromium } from '@playwright/test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.CAPTURE_BASE_URL ?? 'http://localhost:3000';
const OUT = process.env.CAPTURE_OUT ?? path.join(process.cwd(), 'screens');

/** The fixture viewer — seat 3 in the paid/escrow scenarios (see scenarios.ts). */
const FIXTURE_PLAYER = `F1XTUREP1ayer`.padEnd(44, '1');

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2 },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
];

async function main() {
  await rm(OUT, { recursive: true, force: true });
  const browser = await chromium.launch();
  const captured = [];
  const failed = [];

  try {
    // 1. Read the route list off the preview index.
    const probe = await browser.newContext({ viewport: VIEWPORTS[0] });
    const page = await probe.newPage();
    const res = await page.goto(`${BASE}/dev/preview`, { waitUntil: 'domcontentloaded' });
    if (!res || !res.ok()) {
      throw new Error(
        `${BASE}/dev/preview returned ${res ? res.status() : 'no response'}. ` +
          `Start the dev server first (npm run dev) — and note this route is ` +
          `development only, so a production build will 404 by design.`
      );
    }
    const routes = await page.$$eval('a[data-capture]', (els) =>
      els.map((e) => ({ name: e.getAttribute('data-capture'), href: e.getAttribute('href') }))
    );
    await probe.close();

    // /dev/preview itself is worth having in the set.
    routes.unshift({ name: 'dev-preview', href: '/dev/preview' });
    const unique = [...new Map(routes.map((r) => [r.name, r])).values()];
    if (unique.length === 0) throw new Error('no data-capture links found on /dev/preview');
    console.log(`capturing ${unique.length} screens x ${VIEWPORTS.length} viewports`);

    // 2. Shoot each route at each viewport.
    for (const vp of VIEWPORTS) {
      const dir = path.join(OUT, vp.name);
      await mkdir(dir, { recursive: true });
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.deviceScaleFactor,
        colorScheme: 'dark',
      });
      // The automation signer, injected before any app code runs.
      await ctx.addInitScript((address) => {
        window.__BLOTTO_TEST_SIGNER__ = {
          address,
          signTransaction: async () => {
            throw new Error('capture run: signing is not part of taking screenshots');
          },
        };
      }, FIXTURE_PLAYER);

      for (const r of unique) {
        const p = await ctx.newPage();
        try {
          const resp = await p.goto(`${BASE}${r.href}`, {
            waitUntil: 'networkidle',
            timeout: 60_000,
          });
          const status = resp ? resp.status() : 0;
          if (status !== 200) {
            failed.push(`${vp.name}/${r.name} — HTTP ${status} at ${r.href}`);
            continue;
          }
          // Two artefacts that would otherwise be baked into every asset:
          //
          //  - Next's dev overlay badge sits over the tab bar. It lives in a
          //    <nextjs-portal> custom element, so hiding that one tag removes
          //    it without touching app config or the page's own styles.
          //  - `position: fixed` chrome (the tab bar) renders once, at its
          //    VIEWPORT position, so in a full-page shot it lands stranded in
          //    the middle of the image, over the content. `absolute` does not
          //    fix it — with no positioned ancestor it anchors to the
          //    viewport-sized containing block, not the document. `static`
          //    does: the bar is the last element in the layout, so it simply
          //    flows to the foot of the page, which is where a reader of the
          //    screenshot expects it.
          //
          // Both are capture-time only. The app is not modified to be
          // photogenic — that would be changing the thing to suit the picture.
          await p.addStyleTag({
            content:
              'nextjs-portal{display:none!important}' +
              '.fixed{position:static!important}',
          });
          // Let countdowns and the reveal animation settle to a stable frame.
          await p.waitForTimeout(900);
          const file = path.join(dir, `${r.name}.png`);
          await p.screenshot({ path: file, fullPage: true });
          captured.push(`${vp.name}/${r.name}.png`);
        } catch (e) {
          failed.push(`${vp.name}/${r.name} — ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          await p.close();
        }
      }
      await ctx.close();
    }

    // 3. A contact sheet, so the set can be reviewed without opening 60 files.
    await writeFile(path.join(OUT, 'index.html'), contactSheet(unique), 'utf8');
    await writeFile(
      path.join(OUT, 'manifest.json'),
      JSON.stringify({ base: BASE, captured, failed, routes: unique }, null, 2),
      'utf8'
    );
  } finally {
    await browser.close();
  }

  console.log(`\ncaptured ${captured.length} files into ${OUT}`);
  if (failed.length > 0) {
    // Loudly, and non-zero: a capture set that quietly skipped screens would
    // be read as "these are all the screens".
    console.error(`\n${failed.length} FAILED:`);
    for (const f of failed) console.error(`  ${f}`);
    process.exitCode = 1;
  }
}

function contactSheet(routes) {
  const cell = (vp, r) => `
    <figure>
      <img src="${vp}/${r.name}.png" alt="${r.name}" loading="lazy" />
      <figcaption>${r.name}<span>${r.href}</span></figcaption>
    </figure>`;
  return `<!doctype html>
<meta charset="utf-8" />
<title>Blotto Cup — screens</title>
<style>
  body { margin: 0; padding: 24px; background: #0b1020; color: #edf2fb;
         font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.note { color: #7e8aa3; margin: 0 0 24px; }
  h2 { font-size: 16px; margin: 32px 0 12px; color: #3d8bff; }
  .grid { display: grid; gap: 20px;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  figure { margin: 0; }
  img { width: 100%; border: 1px solid #1d2942; border-radius: 8px;
        background: #0b1020; display: block; }
  figcaption { margin-top: 6px; font-size: 12px; }
  figcaption span { display: block; color: #7e8aa3; font-family: ui-monospace, monospace; }
</style>
<h1>Blotto Cup — every screen, every state</h1>
<p class="note">Rendered from fixtures. Mobile is 390&times;844 at 2&times;; desktop 1440&times;900.</p>
${VIEWPORTS.map(
  (vp) => `<h2>${vp.name} — ${vp.width}&times;${vp.height}</h2>
<div class="grid">${routes.map((r) => cell(vp.name, r)).join('')}</div>`
).join('\n')}
`;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
