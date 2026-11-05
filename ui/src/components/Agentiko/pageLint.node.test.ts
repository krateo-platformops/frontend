// @vitest-environment node
/**
 * pageLint is NODE-SAFE: the builder gate (#442) imports it in a Node service, with no browser,
 * no Vite and no token. Three proofs, from weakest to strongest:
 *   1. its source reaches for nothing browser-only and imports nothing but ajv;
 *   2. it runs here, in vitest's node environment, with no `window` or `document`;
 *   3. it runs in a plain Node process (tsx, which strips types and nothing else — no Vite
 *      transform, so an `import.meta.glob` would throw there).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const MODULE = join(__dirname, 'pageLint.ts')

describe('pageLint in Node', () => {
  it('its source uses nothing browser-only and imports only ajv', () => {
    const source = readFileSync(MODULE, 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/import\.meta/)
    expect(code).not.toMatch(/\bfetch\s*\(/)
    expect(code).not.toMatch(/\bwindow\b|\bdocument\b|localStorage|sessionStorage/)
    expect(code).not.toMatch(/getAccessToken|Authorization/)
    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1])
    expect(imports).toEqual(['ajv'])
  })

  it('runs in vitest\'s node environment', async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined')
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined')
    const { lintPageDrafts, pageRootProblem } = await import('./pageLint')
    const problems = await lintPageDrafts([{ kind: 'Gadget', metadata: { name: 'g' }, spec: {} }], {
      pluralOf: () => null,
      schemaFor: () => null,
    })
    expect(problems).toEqual(['widgets[0] (Gadget/g): unknown kind — not a registered widget kind or RESTAction'])
    expect(pageRootProblem([{ kind: 'Flex', metadata: { name: 'page-x' } }])).toBeNull()
  })

  it('runs in a plain Node process, with no Vite in the way', () => {
    const tsxCli = createRequire(import.meta.url).resolve('tsx/cli')
    // An async IIFE: tsx's --eval compiles to CommonJS, where top-level await is not allowed.
    const script = `(async () => {
      const { lintPageDrafts, pageRootProblem } = await import(${JSON.stringify(MODULE)})
      const schema = { type: 'object', properties: { spec: { type: 'object', additionalProperties: false, properties: { widgetData: {} } } } }
      const problems = await lintPageDrafts(
        [{ kind: 'Flex', metadata: { name: 'page-x' }, spec: { allowedResources: [] } }],
        { pluralOf: () => 'flexes', schemaFor: () => schema },
      )
      console.log(JSON.stringify({ problems, root: pageRootProblem([]), window: typeof window }))
    })()`
    const run = spawnSync(process.execPath, [tsxCli, '--eval', script], { encoding: 'utf8', timeout: 20000 })
    // stderr is the message, not the assertion: a Node version may print an unrelated warning there.
    expect(run.status, run.stderr).toBe(0)
    const out = JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}') as { problems: string[]; root: string | null; window: string }
    expect(out.window).toBe('undefined')
    expect(out.problems).toEqual(['widgets[0] (Flex/page-x): /spec must NOT have additional properties'])
    expect(out.root).toContain('no page-<slug> root Flex')
  })
})
