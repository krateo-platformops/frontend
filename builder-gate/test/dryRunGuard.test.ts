/**
 * THE GATE'S OWN IDENTITY NEVER WRITES (#442 D1). Two proofs:
 *   1. statically, over the source: the gate itself names no verb but GET and POST; the only POST
 *      its ServiceAccount sends is kube.ts dryRunCreate, whose URL ends in the constant
 *      `?dryRun=All&fieldValidation=Strict`; the only other POST is snowplow /jq;
 *   2. at run time: the gate runs the example and a set of mutations against a recording
 *      transport, and every request made AS THE GATE is a GET or a sandbox dry-run carrying both
 *      parameters. Any other verb is a draft RESTAction's own stage, replayed as the caller (Diego,
 *      2026-10-03), and only the one the draft names.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DRY_RUN_QUERY } from '../src/kube'
import { byKind, type Draft, example, fakeSnowplowJq, json, liveCtx, recorder, ROOT, run } from './helpers'

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  (entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []))

const code = (file: string): string => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('statically', () => {
  const files = sources(join(ROOT, 'src'))

  it('the dry-run query is exactly dryRun=All and fieldValidation=Strict', () => {
    expect(DRY_RUN_QUERY).toBe('?dryRun=All&fieldValidation=Strict')
  })

  it('the gate itself names no PUT, PATCH or DELETE (only a draft can)', () => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(/['"](PUT|PATCH|DELETE)['"]/)
    }
  })

  it('POST appears only in the dry-run and in snowplow /jq', () => {
    const posting = files.filter((file) => /['"]POST['"]/.test(code(file))).map((file) => file.slice(ROOT.length + 1)).sort()
    // server.ts is the MCP endpoint's own INBOUND method.
    expect(posting).toEqual(['src/caller.ts', 'src/kube.ts', 'src/server.ts'])
    expect(code(join(ROOT, 'src', 'server.ts'))).not.toMatch(/transport\(|https?\.request\(|method: 'POST'/)
    const kube = code(join(ROOT, 'src', 'kube.ts'))
    expect(kube.match(/['"]POST['"]/g)).toHaveLength(2) // the send() signature and dryRunCreate's call
    // The one POST call site is inside dryRunCreate, and its path ends in the constant query.
    expect(kube.match(/this\.send\('POST'/g)).toHaveLength(1)
    const dryRun = kube.slice(kube.indexOf('dryRunCreate('))
    const body = dryRun.slice(0, dryRun.indexOf('\n  }\n'))
    expect(body).toMatch(/\$\{DRY_RUN_QUERY\}`\n\s*return this\.send\('POST', path,/)
    expect(code(join(ROOT, 'src', 'caller.ts'))).toMatch(/method: 'POST',\s*url: `\$\{config\.snowplowUrl\.replace\(\/\\\/\$\/, ''\)\}\/jq`/)
  })

  it('only kube.ts builds an API-server request, and only through send()', () => {
    for (const file of files.filter((f) => !f.endsWith('kube.ts') && !f.endsWith('http.ts') && !f.endsWith('caller.ts'))) {
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
    (d) => { byKind(d, 'RESTAction').spec.api.push({ name: 'replayed', path: '/api/v1/namespaces/krateo-system/configmaps', verb: 'POST', payload: '{}' }) },
  ]
  for (const mutation of mutations) {
    const draft = example()
    mutation(draft)
    drafts.push(draft)
  }

  it('as the gate: only GETs and sandbox dry-runs; any other verb is the draft\'s own stage, as the caller', async () => {
    const { transport, requests } = recorder((req) => {
      if (req.url.startsWith('http://snowplow.test')) {
        return fakeSnowplowJq(req)
      }
      if (req.url.startsWith('https://hop.test')) {
        return json(200, { items: [] })
      }
      return req.method === 'POST' ? json(201, {}) : json(200, {})
    })
    for (const draft of drafts) {
      // eslint-disable-next-line no-await-in-loop -- one gate call at a time, one shared recorder
      await run(draft, liveCtx(transport))
    }
    expect(requests.length).toBeGreaterThan(20)
    const asGate = requests.filter((r) => r.headers?.Authorization === 'Bearer sa-token')
    // The gate's identity goes to the API server only, and the API server sees no other identity.
    expect(asGate.length).toBeGreaterThan(0)
    expect(requests.filter((r) => r.url.startsWith('https://apiserver.test'))).toEqual(asGate)
    for (const req of asGate) {
      if (req.method !== 'GET') {
        expect(req.method).toBe('POST')
        expect(req.url).toMatch(/^https:\/\/apiserver\.test\/apis\/[^?]+\/namespaces\/krateo-preview\/[a-z]+\?dryRun=All&fieldValidation=Strict$/)
      }
    }
    for (const req of requests.filter((r) => r.url.startsWith('http://snowplow.test'))) {
      expect(req).toMatchObject({ method: 'POST', url: 'http://snowplow.test/jq' })
    }
    // The caller's identity sends a non-GET only where a draft stage defines one: the two
    // mutations above that set verb POST.
    expect(requests.filter((r) => r.url.startsWith('https://hop.test') && r.method !== 'GET').map((r) => `${r.method} ${r.url}`))
      .toEqual(['POST https://hop.test/api/v1/namespaces/krateo-system/pods', 'POST https://hop.test/api/v1/namespaces/krateo-system/configmaps'])
  })
})
