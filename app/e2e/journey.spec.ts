/*
 * The full journey against the FIXTURE backend (v3 D4): every moment a
 * player can reach without credentials, at 375px and 1280px, with the
 * screenshots the step report commits (docs/phase-reports/screenshots/).
 *
 * What is asserted here is the D2 contract, not pixels: the 18+/territory
 * line is visible on the landing viewport without scrolling; §8.6 renders
 * ABOVE the enter control; the production build 404s /dev/components; the
 * signed-out entry path shows the designed panel, never a bare sentence.
 * The credentialed seven-battle run stays in the devnet rehearsal suite
 * (tests/rehearsal/playwright/) — a fixture backend cannot sign or pay.
 */
import { test, expect, type Page } from '@playwright/test';

const POOL = 'F1XTUREPoo1111111111111111111111111111111111';
const SHOTS = '../docs/phase-reports/screenshots/step-ui-arena';

const shot = (page: Page, name: string, project: string) =>
  page.screenshot({ path: `${SHOTS}/${name}-${project}.png`, fullPage: true });

test('landing: montage hero, the enter control, the 18+ line above the fold', async ({ page }, info) => {
  await page.goto('/');
  await expect(
    page.getByText('Sixty-four seats. Seven battles. The winner takes the prize pool.')
  ).toBeVisible();
  // Founder 2026-09-09: the hero is the full-bleed montage (the seat ring
  // left the hero with the "Pools are now open" card); the open fixture
  // pool is entered from the hero's control.
  await expect(page.locator('video[poster*="hero_montage"]')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Enter this tournament' }).first()).toBeVisible();
  // v3 D2: 18+/territory visible WITHOUT SCROLLING at this viewport.
  // The hero's own line is the first of several on the page.
  const note = page.getByText('18+ only · not available in some territories').first();
  await expect(note).toBeInViewport();
  await shot(page, 'landing', info.project.name);
});

test('landing: the board demo pours points and locks a field (founder 2026-09-24)', async ({ page }) => {
  // Only when the app was BUILT with the board switch on; otherwise the
  // practice machine below is what renders, and that test covers it.
  test.skip(process.env.NEXT_PUBLIC_BATTLE_BOARD !== '1', 'board switch off');
  await page.addInitScript(() => localStorage.setItem('blotto.preloader.seen', 'v2'));
  await page.goto('/');
  const demo = page.getByTestId('board-demo');
  // Centre the board: flush to the top it sits under the sticky header,
  // exactly as any anchor target would (the #demo section has scroll-mt for
  // the real link; a test's scrollIntoView does not use it).
  await demo.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await demo.getByTestId('board-begin').click();
  // Pick Wit, then press and hold on Field 1's grass: the deploy curve sends
  // points one after another (the arena reads real pointer coordinates).
  await demo.getByTestId('troop-3').click();
  const grass = demo.locator('.bba-field-hit[data-field="0"]');
  const box = await grass.boundingBox();
  if (!box) throw new Error('Field 1 has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await expect(demo.locator('.bba-crowd-chip[data-field="0"][data-stat="3"]')).toBeVisible();
  // The plaque opens the stepper; +5 lands; Fill makes it Full; Lock in works only then.
  await demo.locator('.bba-plaque[data-field="0"]').click();
  await demo.getByRole('button', { name: 'Add 5 Wit to Field 1' }).click();
  await demo.getByRole('button', { name: 'Fill with Wit' }).click();
  await demo.getByRole('button', { name: 'Lock in Field 1' }).click();
  await expect(demo.getByRole('button', { name: 'Unlock Field 1' })).toBeVisible();
  await demo.getByRole('button', { name: 'Close' }).click();
  await expect(demo.getByText('1 / 7 battles full · 1 locked in')).toBeVisible();
});

test('landing: the practice machine can hold a stat (founder 2026-09-16)', async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_BATTLE_BOARD === '1', 'board switch on');
  // The first-visit curtain is a root-route overlay; mark it seen so the
  // dials are reachable (preloader-model.ts holds the key and value).
  await page.addInitScript(() => localStorage.setItem('blotto.preloader.seen', 'v2'));
  await page.goto('/');
  const lock = page.getByTestId('lock-0');
  await lock.scrollIntoViewIfNeeded();
  await expect(lock).toBeVisible();
  const strength = page.getByRole('slider', { name: 'Strength' });
  await expect(strength).toBeEnabled();
  // A locked stat holds its value: the dial is disabled and says so.
  await lock.click();
  await expect(strength).toBeDisabled();
  await expect(strength).toHaveAttribute('aria-valuetext', 'Strength is locked');
  // Even split clears the locks with the shape (CHANGE-2026-09-13 §4, rule 4).
  await page.getByRole('button', { name: 'Even split' }).click();
  await expect(strength).toBeEnabled();
});

test('pool page: the fixed pot as one Stat, §8.6 above the enter control', async ({
  page,
}, info) => {
  await page.goto(`/pools/${POOL}`);
  // D-E2: ONE paid place. The pool page shows the pot the pool OPENED with
  // as a single Stat (the tier-0 fixture's fixed 4 SOL, D-E1) with the rule
  // beside it. The per-position table is gone — assert it stays gone.
  await expect(page.getByText('Prize pool', { exact: true })).toBeVisible();
  await expect(page.locator('.text-prize').first()).toHaveText('4SOL');
  await expect(
    page.getByText('The player ranked first takes the whole prize pool. A tie for first splits it equally.')
  ).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  const finalText = page.getByText(/Decisions are final/);
  await expect(finalText).toBeVisible();
  const enter = page.getByRole('link', { name: 'Enter this tournament' });
  await expect(enter).toBeVisible();
  // §8.6: the statement renders ABOVE the enter control in the document.
  const above = await page.evaluate(() => {
    const statement = [...document.querySelectorAll('p')].find((p) =>
      p.textContent?.includes('Decisions are final')
    );
    const control = [...document.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Enter this tournament')
    );
    if (!statement || !control) return false;
    return Boolean(statement.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(above).toBe(true);
  await shot(page, 'pool', info.project.name);
});

test('entry path fail-closed: the designed territory panel, never a bare sentence', async ({
  page,
}, info) => {
  // Fixture mode has no entry service, and the D-B3 gate fails CLOSED —
  // the first designed panel on the path is the territory refusal. (The
  // sign-in and clickwrap moments need the credentialed rehearsal stack.)
  await page.goto(`/play?pool=${POOL}`);
  await expect(page.getByRole('heading', { name: 'Not available here' })).toBeVisible();
  await shot(page, 'play-fail-closed', info.project.name);
});

test('pools, results (uncommitted), rules, custody, verify all render', async ({ page }, info) => {
  await page.goto('/pools');
  await expect(page.getByRole('heading', { name: 'Pools' })).toBeVisible();

  await page.goto(`/pools/${POOL}/results`);
  await expect(page.getByText('Results are not committed yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Verify a pool' })).toBeVisible();

  await page.goto('/rules');
  await expect(page.getByRole('heading', { name: 'Rules', exact: true })).toBeVisible();
  await expect(page.getByText('three or more of its five stats')).toBeVisible();
  await shot(page, 'rules', info.project.name);

  await page.goto('/custody');
  await expect(page.getByRole('heading', { name: 'Who holds which keys' })).toBeVisible();

  await page.goto('/verify');
  await expect(page.getByRole('heading', { name: 'Verify a pool' })).toBeVisible();
  await shot(page, 'verify', info.project.name);
});

test('profile signed-out shows the career empty state', async ({ page }, info) => {
  await page.goto('/profile');
  await expect(page.getByText('Sign in to see your record.')).toBeVisible();
  await shot(page, 'profile-signed-out', info.project.name);
});

test('the dev component gallery is a hard 404 in the production build', async ({ page }) => {
  const res = await page.goto('/dev/components');
  expect(res?.status()).toBe(404);
});

test('no horizontal scroll at this viewport', async ({ page }) => {
  for (const path of ['/', `/pools/${POOL}`, '/rules', '/verify']) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
