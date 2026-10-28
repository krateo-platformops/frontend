// @ts-check
import pluginQuery from '@tanstack/eslint-plugin-query'
import tsEslint from 'typescript-eslint'

import { baseConfig } from './eslint/base.js'
import { overrides } from './eslint/overrides.js'
import { reactConfig } from './eslint/react.js'
import { typescriptConfigs } from './eslint/typescript.js'

const ignoredPaths = [
  '.yarn/**/*',
  '**/node_modules/**/*',
  '.pnp.*',
  'www/**/*',
  '**/dist/**/*',
  '**/build/**/*',
  'loader/**/*',
  'public/**/*',
  'website/**/*',
  'playwright-report/**/*',
  '.vscode/**/*',
  '.idea/**/*',
  '.eslint.config.js',
]

// Order matters: each group may relax what an earlier one set, so the narrow per-path
// exemptions in `overrides` come last.
export default tsEslint.config(
  ...pluginQuery.configs['flat/recommended'],
  { ignores: ignoredPaths, name: 'Ignored files' },

  baseConfig,
  ...typescriptConfigs,
  reactConfig,
  ...overrides,
)
