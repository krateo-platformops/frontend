/**
 * The provenance PATH CHOICE on the real write paths (runRest via dispatchAction, the `ops` form
 * action, runRestSet), with the REAL /capabilities reader behind `supportsCallProvenance`:
 *
 *   - snowplow lists `call.provenance` → every gated /call carries ONE X-Krateo-Provenance header
 *     and NO AuditRecord is POSTed;
 *   - it does not, or /capabilities fails → no header, and the AuditRecord POST is kept (today's
 *     behaviour, unchanged);
 *   - PROVENANCE_ENABLED "false" → neither, and /capabilities is not even read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourcesRefs, WidgetAction } from '../types/Widget'

import { PROVENANCE_HEADER, type CallProvenance } from './callProvenance'
import { runRestSet, type RunRestSetContext, type WriteOp } from './runRestSet'
import { resetSnowplowCapabilitiesCache, snowplowReadsCallProvenance } from './snowplowCapabilities'
import { dispatchAction, type ActionContext } from './useHandleActions'

type FetchCall = [string, RequestInit]
type Snowplow = 'provenance' | 'older' | '404' | 'down'

const reply = (status: number, body: string): Response =>
  ({ json: () => Promise.resolve(JSON.parse(body) as unknown), ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) } as unknown as Response)

/** A fetch that routes like snowplow: /capabilities by `kind`, the audit sink, and the writes. */
const snowplowFetch = (kind: Snowplow) => vi.fn((url: string) => {
  if (url.endsWith('/capabilities')) {
    if (kind === 'down') { return Promise.reject(new TypeError('Failed to fetch')) }
    if (kind === '404') { return Promise.resolve(reply(404, '{"message":"not found"}')) }
    return Promise.resolve(reply(200, JSON.stringify({ capabilities: kind === 'provenance' ? ['call.dryRun', 'call.provenance'] : ['call.dryRun'] })))
  }
  if (url.includes('resource=auditrecords')) { return Promise.resolve(reply(201, '{}')) }
  return Promise.resolve(reply(200, '{"metadata":{"name":"my-app","namespace":"demo"}}'))
})

const callsOf = (fetchMock: ReturnType<typeof snowplowFetch>): FetchCall[] => fetchMock.mock.calls as unknown as FetchCall[]
const writesOf = (fetchMock: ReturnType<typeof snowplowFetch>): FetchCall[] =>
  callsOf(fetchMock).filter(([url, init]) => !url.endsWith('/capabilities') && !url.includes('resource=auditrecords') && init.method !== 'GET')
const auditsOf = (fetchMock: ReturnType<typeof snowplowFetch>): FetchCall[] => callsOf(fetchMock).filter(([url]) => url.includes('resource=auditrecords'))

/** Every spelling of the provenance header on one request (must be at most ONE). */
const provenanceKeys = (init: RequestInit): string[] =>
  Object.keys(init.headers as Record<string, string>).filter((key) => key.toLowerCase() === PROVENANCE_HEADER.toLowerCase())

const decodeHeader = (init: RequestInit): CallProvenance => {
  const [key] = provenanceKeys(init)
  const value = (init.headers as Record<string, string>)[key]
  const b64 = value.slice(3).replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (char) => char.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as CallProvenance
}

const supports = () => snowplowReadsCallProvenance('http://sp', () => 'tok')

const makeCtx = (over: Partial<ActionContext> = {}): ActionContext => ({
  apiBaseUrl: 'http://sp',
  closeDrawer: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(true)),
  eventsBaseUrl: 'http://ev',
  getAccessToken: vi.fn(() => 'tok'),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  message: { destroy: vi.fn(), loading: vi.fn() } as unknown as ActionContext['message'],
  navigate: vi.fn(),
  notification: { error: vi.fn(), success: vi.fn() } as unknown as ActionContext['notification'],
  openDrawer: vi.fn(),
  openModal: vi.fn(),
  provenanceEnabled: true,
  registerCleanup: vi.fn(),
  reloadRoutes: vi.fn(),
  resolveJq: vi.fn((expr: string) => Promise.resolve(`jq:${expr}`)),
  setLoading: vi.fn(),
  supportsCallProvenance: supports,
  ...over,
})

const makeSetCtx = (over: Partial<RunRestSetContext> = {}): RunRestSetContext => ({
  apiBaseUrl: 'http://sp',
  confirm: vi.fn(() => Promise.resolve(true)),
  getAccessToken: vi.fn(() => 'tok'),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  message: { destroy: vi.fn() } as unknown as RunRestSetContext['message'],
  notification: { error: vi.fn(), success: vi.fn() } as unknown as RunRestSetContext['notification'],
  provenanceEnabled: true,
  registerCleanup: vi.fn(),
  setLoading: vi.fn(),
  supportsCallProvenance: supports,
  ...over,
})

const refs = (items: ResourcesRefs['items']): ResourcesRefs => ({ items })
const patchRef = { allowed: true, id: 'ref', path: '/apis/composition.krateo.io/v1alpha1/namespaces/demo/fireworksapps/my-app', payload: {}, verb: 'PATCH' as const }
// A widget that declares its own provenance header: it must never reach the wire beside the portal's.
const restAction = { headers: ['x-krateo-provenance: v1.forged'], id: 'a', resourceRefId: 'ref', type: 'rest' } as WidgetAction

const OPS: WriteOp[] = [
  { path: '/apis/composition.krateo.io/v1-2-0/namespaces/example-ns/examplecatalogs', payload: { metadata: { name: 'example-a' } }, verb: 'POST' },
  { path: '/api/v1/namespaces/example-ns/configmaps/example-b', verb: 'DELETE' },
  { path: '/apis/apps/v1/namespaces/example-ns/deployments', payload: { spec: {} }, verb: 'POST' },
]
// Contract section 7, golden vector v1 — the same three ops.
const GOLDEN_V1_SHA = '0a08bb91090b111f15a045b6061bccc4d0b8488d85f99ba57d8632e17061c277'

const FORBIDDEN = ['actor', 'agent', 'agentId', 'action', 'outcome', 'resolvedAt', 'prompt', 'user', 'verb', 'namespace']

beforeEach(() => {
  resetSnowplowCapabilitiesCache()
  vi.spyOn(console, 'debug').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('runRest (a Form submit, a Button / row action, an Agentiko runAction) — the path choice', () => {
  it('call.provenance listed: ONE header on the write, NO AuditRecord POST', async () => {
    const fetchMock = snowplowFetch('provenance')
    vi.stubGlobal('fetch', fetchMock)

    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, makeCtx())

    const [[url, init]] = writesOf(fetchMock)
    expect(url).toBe(`http://sp${patchRef.path}`)
    expect(provenanceKeys(init)).toEqual([PROVENANCE_HEADER])
    expect((init.headers as Record<string, string>)[PROVENANCE_HEADER]).toMatch(/^v1\.[A-Za-z0-9_-]+$/)
    const header = decodeHeader(init)
    expect(header.source).toBe('portal')
    expect(header.op).toBe(0)
    expect(header.confirmedSet).toMatchObject({ count: 1, irreversible: false })
    // A human write carries no session.
    expect(header.agentSessionId).toBeUndefined()
    for (const key of FORBIDDEN) { expect(header).not.toHaveProperty(key) }
    expect(auditsOf(fetchMock)).toHaveLength(0)
  })

  it.each<[string, Snowplow]>([
    ['an older snowplow (lists other tokens)', 'older'],
    ['a snowplow without /capabilities (404)', '404'],
    ['/capabilities unreachable', 'down'],
  ])('%s: NO header, and the AuditRecord POST is kept', async (_label, kind) => {
    const fetchMock = snowplowFetch(kind)
    vi.stubGlobal('fetch', fetchMock)

    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, makeCtx())

    const [[, init]] = writesOf(fetchMock)
    expect(provenanceKeys(init)).toEqual([])
    expect(auditsOf(fetchMock)).toHaveLength(1)
  })

  it('an agent-origin write carries its session id (and nothing else of the origin)', async () => {
    const fetchMock = snowplowFetch('provenance')
    vi.stubGlobal('fetch', fetchMock)

    await dispatchAction(restAction, { origin: { actor: 'agent', agentSessionId: 's_6f1d2c3b-4a5e-4f60-8b7a-9c0d1e2f3a4b', prompt: 'bump the size' }, resourcesRefs: refs([patchRef]) }, makeCtx())

    const header = decodeHeader(writesOf(fetchMock)[0][1])
    expect(header.agentSessionId).toBe('s_6f1d2c3b-4a5e-4f60-8b7a-9c0d1e2f3a4b')
    expect(JSON.stringify(header)).not.toContain('bump the size')
  })

  it('requestedAt is the browser clock at the confirmation, in the contract\'s form', async () => {
    const fetchMock = snowplowFetch('provenance')
    vi.stubGlobal('fetch', fetchMock)
    const before = Date.now()

    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, makeCtx())

    const { requestedAt } = decodeHeader(writesOf(fetchMock)[0][1])
    expect(requestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(Date.parse(requestedAt ?? '')).toBeGreaterThanOrEqual(before)
  })

  it('two presses of the gate → two confirmationIds', async () => {
    const fetchMock = snowplowFetch('provenance')
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx()

    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, ctx)
    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, ctx)

    const [first, second] = writesOf(fetchMock).map(([, init]) => decodeHeader(init))
    expect(first.confirmationId).toBeDefined()
    expect(first.confirmationId).not.toBe(second.confirmationId)
    // /capabilities was read ONCE for both writes.
    expect(callsOf(fetchMock).filter(([url]) => url.endsWith('/capabilities'))).toHaveLength(1)
  })

  it('a DECLINED confirm sends nothing — no write, no capability read, no record', async () => {
    const fetchMock = snowplowFetch('provenance')
    vi.stubGlobal('fetch', fetchMock)

    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, makeCtx({ confirm: vi.fn(() => Promise.resolve(false)) }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('PROVENANCE_ENABLED "false": no header, no record, and /capabilities is not read', async () => {
    const fetchMock = snowplowFetch('provenance')
    vi.stubGlobal('fetch', fetchMock)

    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, makeCtx({ provenanceEnabled: false }))

    expect(callsOf(fetchMock)).toHaveLength(1)
    expect(provenanceKeys(writesOf(fetchMock)[0][1])).toEqual([])
  })

  it('without the capability the widget\'s own header is still never forwarded (the portal asserts provenance)', async () => {
    const fetchMock = snowplowFetch('older')
    vi.stubGlobal('fetch', fetchMock)

    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, makeCtx())
    expect(provenanceKeys(writesOf(fetchMock)[0][1])).toEqual([])
  })
})

describe('runRestSet (applyResourceSet, draft records, preview) — one confirmation, N calls', () => {
  it('call.provenance listed: every op carries the SAME confirmationId and set, op = its index; no AuditRecord', async () => {
    const fetchMock = snowplowFetch('provenance')
    vi.stubGlobal('fetch', fetchMock)

    await runRestSet(OPS, makeSetCtx(), { actor: 'agent', agentSessionId: 's_set', prompt: 'apply the set' })

    const writes = writesOf(fetchMock)
    expect(writes).toHaveLength(3)
    const headers = writes.map(([, init]) => {
      expect(provenanceKeys(init)).toHaveLength(1)
      return decodeHeader(init)
    })
    expect(headers.map((header) => header.op)).toEqual([0, 1, 2])
    expect(new Set(headers.map((header) => header.confirmationId)).size).toBe(1)
    expect(new Set(headers.map((header) => header.requestedAt)).size).toBe(1)
    for (const header of headers) {
      expect(header.confirmedSet).toEqual({ count: 3, irreversible: true, sha256: GOLDEN_V1_SHA })
      expect(header.agentSessionId).toBe('s_set')
      for (const key of FORBIDDEN) { expect(header).not.toHaveProperty(key) }
    }
    expect(auditsOf(fetchMock)).toHaveLength(0)
  })

  it('stop-on-first-error: the ops that ran carry their own indices', async () => {
    const fetchMock = snowplowFetch('provenance')
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/capabilities')) { return Promise.resolve(reply(200, '{"capabilities":["call.provenance"]}')) }
      return Promise.resolve(url.includes('configmaps') ? reply(403, '{"message":"forbidden"}') : reply(200, '{}'))
    })
    vi.stubGlobal('fetch', fetchMock)

    await runRestSet(OPS, makeSetCtx())

    expect(writesOf(fetchMock).map(([, init]) => decodeHeader(init).op)).toEqual([0, 1])
  })

  it('two confirmations of the same set → two confirmationIds, one hash', async () => {
    const fetchMock = snowplowFetch('provenance')
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeSetCtx()

    await runRestSet(OPS, ctx)
    await runRestSet(OPS, ctx)

    const headers = writesOf(fetchMock).map(([, init]) => decodeHeader(init))
    expect(headers).toHaveLength(6)
    expect(headers[0].confirmationId).not.toBe(headers[3].confirmationId)
    expect(headers[0].confirmedSet).toEqual(headers[3].confirmedSet)
  })

  it.each<[string, Snowplow]>([
    ['an older snowplow', 'older'],
    ['/capabilities unreachable', 'down'],
  ])('%s: no header on any op, ONE AuditRecord for the set (unchanged)', async (_label, kind) => {
    const fetchMock = snowplowFetch(kind)
    vi.stubGlobal('fetch', fetchMock)

    await runRestSet(OPS, makeSetCtx(), { actor: 'agent', agentSessionId: 's_set', prompt: 'apply the set' })

    for (const [, init] of writesOf(fetchMock)) { expect(provenanceKeys(init)).toEqual([]) }
    expect(auditsOf(fetchMock)).toHaveLength(1)
  })

  it('a sandbox-confined set (no confirm shown) asserts no confirmation', async () => {
    const fetchMock = snowplowFetch('provenance')
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.fn(() => Promise.resolve(true))
    const sandboxOps: WriteOp[] = [{ path: '/api/v1/namespaces/sandbox/configmaps', payload: { metadata: { name: 'draft' } }, verb: 'POST' }]

    await runRestSet(sandboxOps, makeSetCtx({ confirm }), { actor: 'agent', agentSessionId: 's_prev' }, { skipConfirmForSandbox: 'sandbox' })

    expect(confirm).not.toHaveBeenCalled()
    const header = decodeHeader(writesOf(fetchMock)[0][1])
    expect(header).not.toHaveProperty('confirmationId')
    expect(header).not.toHaveProperty('confirmedSet')
    expect(header).not.toHaveProperty('op')
    expect(header).toMatchObject({ agentSessionId: 's_prev', source: 'portal' })
  })
})

describe('the `ops` form action (W3-2) — through dispatchAction into the set fabric', () => {
  it('both ops carry one confirmation, indices 0 and 1', async () => {
    const fetchMock = snowplowFetch('provenance')
    vi.stubGlobal('fetch', fetchMock)
    const roleRef = { allowed: true, id: 'role', path: '/call?apiVersion=rbac.authorization.k8s.io%2Fv1&resource=roles&namespace=demo', payload: {}, verb: 'POST' as const }
    const bindingRef = { allowed: true, id: 'binding', path: '/call?apiVersion=rbac.authorization.k8s.io%2Fv1&resource=rolebindings&namespace=demo', payload: {}, verb: 'POST' as const }
    const action = {
      headers: [],
      id: 'grant',
      ops: [
        { payload: { metadata: { name: 'r', namespace: 'demo' } }, resourceRefId: 'role' },
        { payload: { metadata: { name: 'b', namespace: 'demo' } }, resourceRefId: 'binding' },
      ],
      resourceRefId: 'role',
      type: 'rest',
    } as WidgetAction

    await dispatchAction(action, { resourcesRefs: refs([roleRef, bindingRef]) }, makeCtx())

    const headers = writesOf(fetchMock).map(([, init]) => decodeHeader(init))
    expect(headers.map((header) => header.op)).toEqual([0, 1])
    expect(headers[0].confirmationId).toBe(headers[1].confirmationId)
    expect(headers[0].confirmedSet?.count).toBe(2)
    expect(auditsOf(fetchMock)).toHaveLength(0)
  })
})
