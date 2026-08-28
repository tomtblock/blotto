/*
 * D4 journey config: the production build served in FIXTURE mode (no
 * indexer URL, no credentials — src/data/fixture.ts is the backend), at the
 * two mandated widths. Run `npm run build` first; `npm run journey` starts
 * the server itself.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4310;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    {
      // v3 D4: mobile-first — 375px wide. Chromium with mobile emulation
      // (only Chromium is installed in this environment; a WebKit device
      // descriptor would fail to launch).
      name: 'mobile-375',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
