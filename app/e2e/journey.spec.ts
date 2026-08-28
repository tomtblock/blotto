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

test('landing: hero fixture card with the 18+ line above the fold', async ({ page }, info) => {
  await page.goto('/');
  // The hero line is set on three lines (founder direction 2026-08-28);
  // "Seven battles" was replaced because it read as seven opponents.
  for (const line of ['Sixty-four players.', 'Choose Your Fighters.', 'Top sixteen paid.']) {
    await expect(page.getByRole('heading', { level: 1 }).getByText(line)).toBeVisible();
  }
  // The live fixture card and its seat ring.
  await expect(page.getByRole('img', { name: /of 64 seats filled/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Enter this tournament' })).toBeVisible();
  // v3 D2: 18+/territory visible WITHOUT SCROLLING at this viewport.
  const note = page.getByText('18+ only · not available in some territories');
  await expect(note).toBeInViewport();
  await shot(page, 'landing', info.project.name);
});

test('pool page: prize table from the fixed pot, §8.6 above the enter control', async ({
  page,
}, info) => {
  await page.goto(`/pools/${POOL}`);
  // The fixed 5.12 SOL pot pays 1st exactly 270/1024.
  await expect(page.getByRole('table')).toContainText('1st');
  await expect(page.getByRole('table')).toContainText('1.35');
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
  // Fixture builds have no entry API, so the gate cannot ASK — that is
  // 'unavailable', not a territory block (the panel must never tell a
  // player their region is blocked when the service simply could not be
  // reached).
  await expect(
    page.getByRole('heading', { name: 'Entry is not available right now' })
  ).toBeVisible();
  await shot(page, 'play-fail-closed', info.project.name);
});

test('pools, results (uncommitted), rules, custody, verify all render', async ({ page }, info) => {
  await page.goto('/pools');
  await expect(page.getByRole('heading', { name: 'Pools' })).toBeVisible();

  await page.goto(`/pools/${POOL}/results`);
  await expect(page.getByText('Results are not committed yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Verify a pool' })).toBeVisible();

  await page.goto('/rules');
  // 6.9 naming: the fair-play page — the Adjudicator explains, it does
  // not disclaim. (Renamed from "Rules" with the UI constitution rebuild.)
  await expect(
    page.getByRole('heading', { name: 'Fair play & availability', exact: true })
  ).toBeVisible();
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
