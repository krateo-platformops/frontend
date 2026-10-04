/**
 * NOTHING THE GATE SENDS CAN STORE AN OBJECT (#442 D1, D10). Two proofs:
 *   1. statically, over the source: the gate's own identity (kube.ts) sends nothing but GET; the
 *      only POSTs are snowplow.ts dryRunCreate — to /call/dry-run ONLY (a route an older snowplow
 *      does not serve, so it 404s and writes nothing), its URL ending in the constant
 *      `dryRun=All&fieldValidation=Strict`, sent only once snowplow ADVERTISED call.dryRun and
 *      call.fieldValidation — and resolveInline, POST /call/read (a read route), under the same
 *      rule; no PUT/PATCH/DELETE exists; nothing ever POSTs to plain /call;
 *   2. at run time: the gate runs the example and a set of mutations against a recording
 *      transport, once on a snowplow that offers the contract and once on today's snowplow, and
 *      every request is checked.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DRY_RUN_PARAMS } from '../src/snowplow'
import { byKind, type Draft, example, fakeSnowplow, liveCtx, recorder, ROOT, run } from './helpers'

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  (entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []))

const code = (file: string): string => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('statically', () => {
  const files = sources(join(ROOT, 'src'))

  it('the dry-run parameters are exactly dryRun=All and fieldValidation=Strict', () => {
    expect(DRY_RUN_PARAMS).toBe('dryRun=All&fieldValidation=Strict')
  })

  it('no PUT, PATCH or DELETE exists anywhere in the gate', () => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(/['"](PUT|PATCH|DELETE)['"]/)
    }
  })

  it('the gate\'s own identity (kube.ts) sends GET and nothing else', () => {
    const kube = code(join(ROOT, 'src', 'kube.ts'))
    expect(kube).not.toMatch(/['"]POST['"]/)
    expect(kube.match(/method: '([A-Z]+)'/g)).toEqual(["method: 'GET'"])
  })

  it('POST is sent only by snowplow.ts, twice: the guarded dry-run and the guarded inline resolve', () => {
    const posting = files.filter((file) => /method: ['"]POST['"]/.test(code(file))).map((file) => file.slice(ROOT.length + 1))
    expect(posting).toEqual(['src/snowplow.ts'])
    const snowplow = code(join(ROOT, 'src', 'snowplow.ts'))
    expect(snowplow.match(/method: 'POST'/g)).toHaveLength(2)
    // Each POST sits behind its capability check, and carries its dry-run parameters.
    const dryRun = snowplow.slice(snowplow.indexOf('async dryRunCreate('), snowplow.indexOf('async resolveInline('))
    const guard = 'requireCapabilities(CAPABILITY_DRY_RUN, CAPABILITY_FIELD_VALIDATION)'
    expect(dryRun.indexOf(guard)).toBeGreaterThan(-1)
    expect(dryRun.indexOf(guard)).toBeLessThan(dryRun.indexOf("method: 'POST'"))
    expect(dryRun).toMatch(/`\$\{base\}\/call\/dry-run\?\$\{query\([^`]*&\$\{DRY_RUN_PARAMS\}`/)
    const resolve = snowplow.slice(snowplow.indexOf('async resolveInline('))
    expect(resolve.indexOf('requireCapabilities(CAPABILITY_RESOLVE)')).toBeGreaterThan(-1)
    expect(resolve.indexOf('requireCapabilities(CAPABILITY_RESOLVE)')).toBeLessThan(resolve.indexOf("method: 'POST'"))
    expect(resolve).toContain('`${base}/call/read?')
    // Plain /call is only ever read (GET); a write there is what an older snowplow would perform.
    expect(snowplow).not.toMatch(/\/call\?[^`]*`,\s*headers: auth, body/)
  })

  it('no module but kube.ts and snowplow.ts builds a request', () => {
    for (const file of files.filter((f) => !/\/(kube|snowplow|http)\.ts$/.test(f))) {
      expect(code(file), file).not.toMatch(/transport\(|nodeTransport\(|https?\.request\(/)
    }
  })
})

describe('at run time', () => {
  const drafts: Draft[] = [example()]
  const mutations: ((d: Draft) => void)[] = [
    (d) => { byKind(d, 'RESTAction').spec.api[0].verb = 'POST' },
    (d) => { byKind(d, 'RESTAction').spec.api[0].userAccessFilter = { verb: 'get', group: '', resource: 'pods' } },
    (d) => { byKind(d, 'Table').spec.apiRef = { name: 'compositions-list', namespace: 'krateo-system' } },
    (d) => { byKind(d, 'Flex').spec.resourcesRefs.items[0].name = 'existing-pie' },
  ]
  for (const mutation of mutations) {
    const draft = example()
    mutation(draft)
    drafts.push(draft)
  }

  it('on a snowplow that offers the contract: every POST is a /call/dry-run into the sandbox with both parameters, or a /call/read inline resolve', async () => {
    const { transport, requests } = recorder(fakeSnowplow())
    for (const draft of drafts) {
      // eslint-disable-next-line no-await-in-loop -- one gate call at a time, one shared recorder
      await run(draft, liveCtx(transport))
    }
    const mutating = requests.filter((r) => r.method !== 'GET')
    expect(mutating.length).toBeGreaterThan(10)
    for (const req of mutating) {
      expect(req.method).toBe('POST')
      expect(req.url).toMatch(/^http:\/\/snowplow\.test\/call\/(dry-run\?apiVersion=[^&]+&resource=[a-z]+&namespace=krateo-preview&name=[a-z0-9.-]+&dryRun=All&fieldValidation=Strict|read\?apiVersion=templates\.krateo\.io%2Fv1&resource=restactions&namespace=krateo-preview&name=[a-z0-9.-]+)$/)
    }
    // Every request is the caller's: the gate's own identity never reaches snowplow.
    expect(requests.every((r) => r.headers?.Authorization === 'Bearer caller-jwt')).toBe(true)
  })

  it('on a snowplow before 1.12.36 (no /capabilities): not one non-GET request is sent', async () => {
    const { transport, requests } = recorder(fakeSnowplow({ capabilities: null }))
    for (const draft of drafts) {
      // eslint-disable-next-line no-await-in-loop -- as above
      await run(draft, liveCtx(transport))
    }
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([])
    expect(requests.every((r) => new URL(r.url).pathname === '/capabilities')).toBe(true)
  })
})
