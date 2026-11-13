import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end checks against the BUILT app (`vite build --outDir dist-e2e`, served by `vite preview`),
 * for behaviour that only a real browser on a real hard load can show — the router, storage, the
 * request headers that actually leave. No screenshots, so unlike visual/ it runs on any platform.
 *
 * Every backend the app talks to is mocked with `page.route`; nothing leaves the machine.
 */
const PORT = 4174

export default defineConfig({
  forbidOnly: !!process.env.CI,
  outputDir: '../test-results/e2e',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]] : 'list',
  testDir: '.',
  testMatch: '*.spec.ts',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    cwd: '..',
    reuseExistingServer: false,
    url: `http://localhost:${PORT}/`,
  },
})
