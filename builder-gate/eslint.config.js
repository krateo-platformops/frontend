// @ts-check
/*
 * builder-gate's lint, reusing the ui workspace's rules rather than inventing a second standard.
 *
 * WHY THIS FILE DID NOT EXIST. `eslint.yaml` runs with `working-directory: ui`, and this package
 * had no config of its own, so its source was typechecked (`builder-gate.yaml`) and tested and
 * never linted — a gap nobody hit because nothing reported it.
 *
 * REUSED, NOT COPIED. `../ui/eslint/base.js` and `typescript.js` are React-free, so they apply
 * here as-is; `react.js` and `overrides.js` do not and are left out. Duplicating the rule set
 * instead would let the two packages drift, and the rules are the point — several of them caught
 * real defects in this package's own code.
 *
 * The devDependencies this needs are installed in the Dockerfile's `bundle` stage and never reach
 * the shipped image, which copies only dist/*.cjs and the jqcheck binary. So the cost is install
 * time, not image size.
 */
import tsEslint from 'typescript-eslint'

import { baseConfig } from '../ui/eslint/base.js'
import { typescriptConfigs } from '../ui/eslint/typescript.js'

export default tsEslint.config(
  {
    ignores: ['**/node_modules/**/*', 'dist/**/*', 'generated/**/*', 'bin/**/*', 'jqcheck/**/*', 'eslint.config.js'],
    name: 'Ignored files',
  },
  ...baseConfig,
  ...typescriptConfigs,
  {
    // Type-aware rules need THIS package's tsconfig; ui's does not include these files.
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    name: 'builder-gate: type-aware against its own tsconfig',
  },
)
