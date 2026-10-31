// Bundle the gate into two self-contained CommonJS files (dist/server.cjs, dist/cli.cjs).
// `@frontend/*` resolves to this repository's ui/src — the portal's own lint, imported, never
// copied — and `ajv` to the gate's own copy, pinned to the version ui/package-lock.json resolves
// (versions.test.ts holds the two equal).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
execFileSync(process.execPath, [join(here, 'scripts', 'gen-schemas.mjs')], { stdio: 'inherit' })

const snowplowRef = readFileSync(join(here, 'SNOWPLOW_REF'), 'utf8').trim()
const version = process.env.GATE_VERSION || 'dev'

for (const entry of ['server', 'cli']) {
  await build({
    alias: {
      '@frontend': join(here, '..', 'ui', 'src'),
      ajv: join(here, 'node_modules', 'ajv'),
    },
    bundle: true,
    define: {
      __GATE_VERSION__: JSON.stringify(version),
      __SNOWPLOW_REF__: JSON.stringify(snowplowRef),
    },
    entryPoints: [join(here, 'src', `${entry}.ts`)],
    format: 'cjs',
    logLevel: 'warning',
    outfile: join(here, 'dist', `${entry}.cjs`),
    platform: 'node',
    sourcemap: false,
    target: 'node22',
  })
}
console.log(`built dist/server.cjs and dist/cli.cjs (gate ${version}, snowplow jq ${snowplowRef})`)
