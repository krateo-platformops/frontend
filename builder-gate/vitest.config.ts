import { join } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@frontend': join(__dirname, '..', 'ui', 'src'),
      ajv: join(__dirname, 'node_modules', 'ajv'),
    },
  },
  test: {
    environment: 'node',
    globalSetup: ['test/globalSetup.ts'],
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
