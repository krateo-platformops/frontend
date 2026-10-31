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
import globals from 'globals'
import tsEslint from 'typescript-eslint'

import { baseConfig } from '../ui/eslint/base.js'
import { typescriptConfigs } from '../ui/eslint/typescript.js'

export default tsEslint.config(
  {
    ignores: ['**/node_modules/**/*', 'dist/**/*', 'generated/**/*', 'bin/**/*', 'jqcheck/**/*', 'eslint.config.js'],
    name: 'Ignored files',
  },
  // `baseConfig` is a single config object and `typescriptConfigs` is an array — ui's
  // eslint.config.js spreads only the latter, and spreading both is what broke this file.
  baseConfig,
  ...typescriptConfigs,
  {
    // builder-gate is a Node service, not a browser bundle, so `process` and `console` are
    // globals here. ui's base config declares browser globals, which is right for ui and leaves
    // every `process.env` read in this package reported as undefined.
    languageOptions: { globals: { ...globals.node } },
    name: 'builder-gate: Node globals',
  },
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
  {
    // MUST COME LAST. tsconfig includes only `src` and `test`, so the build scripts and
    // vitest.config.ts have no program and the type-aware parser rejects them outright —
    // vitest.config.ts with "parserOptions.project has been provided", build.mjs by falling back
    // to a parser whose default ecmaVersion predates top-level await. Both files are valid ESM;
    // the parser lacks a program for them, which is not the same as the files being wrong.
    //
    // Flat config is order-sensitive and the block above sets `project` for EVERY file, so an
    // exemption placed before it is silently overridden. That is exactly what happened on my
    // first attempt: the exemption looked right and changed nothing.
    ...tsEslint.configs.disableTypeChecked,
    // `disableTypeChecked` is typescript-eslint's own mechanism for this: it turns off every rule
    // that needs a program. Dropping `project` alone is not enough — the parser then succeeds and
    // the type-aware RULES still load, and `await-thenable` throws while linting instead.
    files: ['*.mjs', '*.ts', 'scripts/**/*.mjs'],
    ignores: ['src/**/*', 'test/**/*'],
    languageOptions: {
      ecmaVersion: 2023,
      parserOptions: { ecmaVersion: 2023, project: null, projectService: false, sourceType: 'module' },
      sourceType: 'module',
    },
    name: 'builder-gate: build scripts parse without a type-aware program',
  },
)
