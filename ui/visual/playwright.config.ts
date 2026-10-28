import { defineConfig, devices } from '@playwright/test'

/**
 * Visual regression for the widget set: one screenshot per widget example, light and dark,
 * compared against the baselines in __screenshots__/.
 *
 * LINUX ONLY, ON PURPOSE. Font rasterisation differs between macOS and Linux, so a baseline taken
 * on a laptop would fail CI on every glyph. The baselines are taken, and checked, inside the same
 * Playwright container CI uses: `visual/docker.sh` locally, `container:` in the workflow. The
 * version in that image tag and in package.json's @playwright/test must move together.
 */
if (process.platform !== 'linux') {
  throw new Error('Visual tests run in the Playwright container only: use `npm run visual` (or `npm run visual:update`).')
}

const PORT = 4173

export default defineConfig({
  expect: {
    // Same browser, same fonts, same container: anything that moves is a real change.
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 },
  },
  forbidOnly: !!process.env.CI,
  outputDir: '../test-results/visual',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1, viewport: { height: 900, width: 900 } } }],
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]] : 'list',
  // {arg} is the name given in the spec; no platform suffix, because there is only one platform.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  testDir: '.',
  testMatch: '*.spec.ts',
  // CI never writes a baseline: a missing one is a failure, not a picture to adopt silently.
  updateSnapshots: process.env.CI ? 'none' : 'missing',
  // Dates and numbers in the examples are formatted by the browser: pin what they depend on.
  use: { baseURL: `http://localhost:${PORT}`, locale: 'en-US', timezoneId: 'UTC' },
  webServer: {
    command: `npx vite preview --config visual/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '..',
    reuseExistingServer: false,
    url: `http://localhost:${PORT}/visual/index.html`,
  },
})
