import { defineConfig } from 'vitest/config'

import base from './vitest.config'

// The network-dependent checks (test/drift/): snowplow's source and installer's pins, read from
// GitHub. Kept out of vitest.config.ts so an offline `npm test` does not red; CI runs this as its
// own step. Same aliases as the suite (src/snowplow.ts reaches the catalog, which reads ui/ and the
// generated widget schemas); its setup runs build.mjs only, since nothing here needs jqcheck. A run
// that finds no test file fails (vitest's default), so a moved file cannot pass silently.
export default defineConfig({
  resolve: base.resolve,
  test: {
    environment: 'node',
    globalSetup: ['test/drift/setup.ts'],
    include: ['test/drift/**/*.test.ts'],
    testTimeout: 120_000,
  },
})
