import { join } from 'node:path'

import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@frontend': join(__dirname, '..', 'ui', 'src'),
      ajv: join(__dirname, 'node_modules', 'ajv'),
    },
  },
  test: {
    environment: 'node',
    // Network-dependent; vitest.drift.config.ts runs them (`npm run test:drift`).
    exclude: [...configDefaults.exclude, 'test/drift/**'],
    globalSetup: ['test/globalSetup.ts'],
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
