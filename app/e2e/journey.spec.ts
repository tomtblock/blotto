/*
 * The full journey against the FIXTURE backend (v3 D4): every moment a
 * player can reach without credentials, at 375px and 1280px, with the
 * screenshots the step report commits (docs/testing/screenshots/).
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
/** The open HARD pool in the fixture catalogue (scenarios.ts, `hard-open`). */
const HARD_POOL = 'F1XTUREhard111111111111111111111111111111111';
const SHOTS = '../docs/testing/screenshots/journey';

const shot = (page: Page, name: string, project: string) =>
  page.screenshot({ path: `${SHOTS}/${name}-${project}.png`, fullPage: true });

test('landing: montage hero, the choose-your-pool control, the 18+ line above the fold', async ({ page }, info) => {
  await page.goto('/');
  // V3 (founder 2026-09-27): the founder's three lines.
  await expect(page.getByTestId('hero-lines')).toHaveText(
    'Sixty Four Seats. Seven Battlefields.Everyone Battles Everyone.The winner takes the prize pool.'
  );
  // Founder 2026-09-09: the hero is the full-bleed montage. V2 (founder
  // 2026-09-27): with two boards the hero's control cannot name a pool, so
  // it takes the player to the picker. V3: How it works between the two.
  await expect(page.locator('video[poster*="hero_montage"]')).toHaveCount(1);
  await expect(page.getByTestId('hero-choose')).toBeVisible();
  await expect(page.getByTestId('hero-how')).toHaveAttribute('href', '#how');
  // v3 D2: 18+/territory visible WITHOUT SCROLLING at this viewport.
  // The hero's own line is the first of several on the page.
  const note = page.getByText('18+ only · not available in some territories').first();
  await expect(note).toBeInViewport();
  await shot(page, 'landing', info.project.name);
});

test('landing: one picker, Easy / Hard toggle, each side down its own pool (V2)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('blotto.preloader.seen', 'v2'));
  await page.goto('/');
  // The fixture catalogue holds one open easy pool and one open hard pool in
  // tier 0: one card, Easy chosen first, the whole card switching on the
  // toggle.
  const picker = page.getByTestId('pool-picker');
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute('data-mode', 'easy');
  await expect(picker.getByTestId('pool-picker-state')).toContainText('Open now');
  await expect(picker.getByText('Closes in')).toBeVisible();
  await expect(picker.getByTestId('pool-picker-enter')).toHaveAttribute('href', new RegExp(`/pools/${POOL}$`));
  // V3: Enter for real beside the demo goes to the same easy pool.
  await expect(page.getByTestId('demo-enter')).toHaveAttribute('href', new RegExp(`/pools/${POOL}$`));
  // Hard: the card changes colour and its control lands on THAT pool.
  await picker.getByTestId('pool-picker-mode-hard').click();
  await expect(picker).toHaveAttribute('data-mode', 'hard');
  await expect(picker.getByTestId('pool-picker-state')).toContainText('Open now');
  await picker.getByTestId('pool-picker-enter').click();
  await expect(page).toHaveURL(new RegExp(`/pools/${HARD_POOL}$`));
  await expect(page.getByTestId('pool-mode')).toHaveText('Hard · 700 anywhere');
  await expect(page.getByText('Seven battles and 700 points. Place them anywhere', { exact: false })).toBeVisible();
  // And the easy one lands on the easy pool.
  await page.goto('/');
  await page.getByTestId('pool-picker-enter').click();
  await expect(page).toHaveURL(new RegExp(`/pools/${POOL}$`));
  await expect(page.getByTestId('pool-mode')).toHaveText('Easy · 100 per battle');
});

test('landing: the board demo pours points and locks a field (founder 2026-09-24)', async ({ page }) => {
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
  // Grab mode (ruling 13): with Wit still in hand, the hand key makes a TAP
  // on Field 2 open its stepper instead of sending a point; +10 lands there.
  const grab = demo.getByTestId('board-grab');
  await grab.click();
  await expect(grab).toHaveAttribute('aria-pressed', 'true');
  // The plaque tap framed Field 1; bring the whole board back so Field 2's
  // box centre is on Field 2's grass (the fit animates for 220 ms).
  await demo.getByRole('button', { name: 'Fit' }).click();
  await page.waitForTimeout(400);
  const grass2 = demo.locator('.bba-field-hit[data-field="1"]');
  const box2 = await grass2.boundingBox();
  if (!box2) throw new Error('Field 2 has no box');
  await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await demo.getByRole('button', { name: 'Add 10 Wit to Field 2' }).click();
  await expect(demo.getByText('90 left on this field')).toBeVisible();
  await demo.getByRole('button', { name: 'Close' }).click();
  // Picking a troop card ends grab mode.
  await demo.getByTestId('troop-0').click();
  await expect(grab).toHaveAttribute('aria-pressed', 'false');
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
  // V2 (founder 2026-09-27): the rule of who is paid sits on the "Pays" side
  // of the one "How this pool…" box; "Plays" (the mode's rule) shows first.
  const rules = page.getByTestId('pool-rules');
  await expect(rules.getByTestId('pool-rules-plays')).toBeVisible();
  await rules.getByTestId('pool-rules-toggle-pays').click();
  await expect(
    page.getByText('The player ranked first takes the whole prize pool. A tie for first splits it equally.')
  ).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  const finalText = page.getByText(/Decisions are final/);
  await expect(finalText).toBeVisible();
  const enter = page.getByRole('link', { name: 'Enter this pool' });
  await expect(enter).toBeVisible();
  // §8.6: the statement renders ABOVE the enter control in the document.
  const above = await page.evaluate(() => {
    const statement = [...document.querySelectorAll('p')].find((p) =>
      p.textContent?.includes('Decisions are final')
    );
    const control = [...document.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Enter this pool')
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

  // V3: every rules section is a tile; a hash opens that section's card,
  // the close key returns to the tiles, a tile opens its own.
  await page.goto('/rules#scoring');
  await expect(page.getByRole('heading', { name: 'Rules', exact: true })).toBeVisible();
  const modal = page.getByTestId('section-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByText('three or more of its five stats')).toBeVisible();
  await modal.getByTestId('modal-close').click();
  await expect(modal).toBeHidden();
  await expect(page).toHaveURL(/\/rules$/);
  await shot(page, 'rules', info.project.name);
  await page.getByTestId('tile-ties').click();
  await expect(modal).toBeVisible();
  await expect(modal.getByText('Entry order plays no part in ranking')).toBeVisible();
  await expect(page).toHaveURL(/#ties$/);

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
