/**
 * The real-frontend entry flow (roadmap 5.1: "through the real frontend
 * flow via Playwright, not through the API").
 *
 * Runs against a DEPLOYED app + devnet stack: set APP_URL (and have the
 * entry service + indexer configured in that deployment). Without APP_URL
 * the suite skips — it is part of the credentialed devnet rehearsal, not CI.
 *
 * Run: APP_URL=https://... npx playwright test playwright/entry-flow.spec.ts
 * (Playwright is preinstalled in the dev environment; in a fresh checkout,
 * `npm i -D @playwright/test` first.)
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL;

test.skip(!APP_URL, 'APP_URL not set — devnet rehearsal only');

test('a player completes the seven-battle flow and submits', async ({ page }) => {
  await page.goto(`${APP_URL}/`);
  // Pick the open pool.
  await page.getByRole('link', { name: /enter/i }).first().click();
  await page.getByRole('link', { name: /enter/i }).click();
  // Age attestation gate (3.1).
  await page.getByRole('button', { name: /confirm/i }).click();
  // Seven battles: drag one vertex a little, lock in.
  for (let k = 0; k < 7; k++) {
    const pentagon = page.getByRole('group', { name: 'battle allocation pentagon' });
    const box = (await pentagon.boundingBox())!;
    // Drag the top (Strength) vertex outward.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.1, { steps: 5 });
    await page.mouse.up();
    // The integers under the pentagon always sum to 100.
    const values = await page.locator('dd').allInnerTexts();
    const sum = values.slice(0, 5).reduce((a, v) => a + Number(v), 0);
    expect(sum).toBe(100);
    await page.getByRole('button', { name: /lock in/i }).click();
  }
  // Review → confirm ("decisions are final" is on-screen).
  await expect(page.getByText(/decisions are final/i)).toBeVisible();
  await page.getByRole('button', { name: /submit entry/i }).click();
  await expect(page.getByText(/entry submitted|sealing confirmed/i)).toBeVisible({
    timeout: 60_000,
  });
});
