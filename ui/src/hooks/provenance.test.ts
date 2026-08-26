/**
 * provenance — W0-3 audit-trail coverage. Pure-logic (no RTL/jsdom), matching the repo's
 * other hook tests. Proves the provenance contract:
 *   - buildAuditRecord shapes the CR body for BOTH actors: human (no agent/prompt keys)
 *     and agent (id + sessionId + prompt), generateName 'ar-', namespace = the write's
 *     target namespace, the confirmed radius compacted to {count, irreversible, summary};
 *   - emitAuditRecord is STRICTLY BEST-EFFORT: a 404 (CRD absent), a network rejection,
 *     even a throwing token getter are swallowed with a console.debug — never a throw;
 *   - runRest emits ONE record after the write resolves — success AND failure — through
 *     the same fetch shape (base URL + Bearer auth); a DECLINED confirm emits NOTHING;
 *   - runRestSet emits ONE record per SET (count = ops.length, summary lists the ops);
 *   - the PROVENANCE_ENABLED flag gates everything: OFF (opt-out; default is ON) → zero emission.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResourcesRefs, WidgetAction } from '../types/Widget'

import type { BlastRadius } from './blastRadius.types'
import type { AuditRecordBody, ProvenanceContext } from './provenance'
import { actionTargetOf, buildAuditRecord, emitAuditRecord, recordProvenance } from './provenance'
import { runRestSet, type RunRestSetContext, type WriteOp } from './runRestSet'
import { dispatchAction, type ActionContext } from './useHandleActions'

const TIMES = { requestedAt: '2026-07-13T10:00:00.000Z', resolvedAt: '2026-07-13T10:00:01.000Z' }

// A confirmed scalar radius (the exact shape runRest gates on) for the pure builders.
const deleteRadius: BlastRadius = {
  cluster: 'local',
  count: 1,
  diff: { before: { metadata: { name: 'doomed' } }, kind: 'delete' },
  gvr: { group: 'composition.krateo.io', resource: 'fireworksapps', version: 'v1alpha1' },
  name: 'doomed',
  namespace: 'demo',
  verb: 'DELETE',
}

describe('buildAuditRecord — actor shapes', () => {
  it('human origin: actor human, NO agent/prompt keys, generateName ar-, ns = the write target', () => {
    const record = buildAuditRecord({ actor: 'human' }, actionTargetOf(deleteRadius), deleteRadius, { message: 'gone', ok: true, status: 200 }, TIMES)

    expect(record.apiVersion).toBe('audit.krateo.io/v1alpha1')
    expect(record.kind).toBe('AuditRecord')
    expect(record.metadata).toEqual({ generateName: 'ar-', namespace: 'demo' })
    expect(record.spec.actor).toBe('human')
    expect(record.spec.agent).toBeUndefined()
    expect(record.spec.prompt).toBeUndefined()
    expect(record.spec.action).toEqual({
      group: 'composition.krateo.io',
      name: 'doomed',
      namespace: 'demo',
      resource: 'fireworksapps',
      verb: 'DELETE',
      version: 'v1alpha1',
    })
    // The DELETE radius compacts to an irreversible one-object summary.
    expect(record.spec.blastRadius).toEqual({
      count: 1,
      irreversible: true,
      summary: 'DELETE fireworksapps.composition.krateo.io/doomed in demo',
    })
    expect(record.spec.outcome).toEqual({ message: 'gone', ok: true, status: 200 })
    expect(record.spec.requestedAt).toBe(TIMES.requestedAt)
    expect(record.spec.resolvedAt).toBe(TIMES.resolvedAt)
  })

  it('agent origin: actor agent + the session/prompt context the provider held at dispatch', () => {
    const record = buildAuditRecord(
      { actor: 'agent', agentSessionId: 's_abc123', prompt: 'delete the doomed app' },
      actionTargetOf(deleteRadius),
      deleteRadius,
      { message: 'gone', ok: true, status: 200 },
      TIMES
    )

    expect(record.spec.actor).toBe('agent')
    expect(record.spec.agent).toEqual({ id: 'autopilot', sessionId: 's_abc123' })
    expect(record.spec.prompt).toBe('delete the doomed app')
  })
})

// The emit slice of ActionContext (base URL + Bearer token, same shape runRest uses).
const emitCtx = (over: Partial<ProvenanceContext> = {}): ProvenanceContext => ({
  apiBaseUrl: 'http://sp',
  getAccessToken: vi.fn(() => 'tok'),
  provenanceEnabled: true,
  ...over,
})

const record = (namespace = 'demo'): AuditRecordBody =>
  buildAuditRecord({ actor: 'human' }, { ...actionTargetOf(deleteRadius), namespace }, deleteRadius, { message: '', ok: true, status: 200 }, TIMES)

const fakeResponse = (ok: boolean, status: number, body = ''): Response =>
  ({ ok, status, text: () => Promise.resolve(body) } as unknown as Response)

describe('emitAuditRecord — strictly best-effort (any failure is swallowed)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('a 404 (CRD absent) resolves silently with a single console.debug — never a throw', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(false, 404))))

    await expect(emitAuditRecord(record(), emitCtx())).resolves.toBeUndefined()
    expect(debug).toHaveBeenCalledTimes(1)
  })

  it('a network rejection is swallowed with a single console.debug', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net down'))))

    await expect(emitAuditRecord(record(), emitCtx())).resolves.toBeUndefined()
    expect(debug).toHaveBeenCalledTimes(1)
  })

  it('even a throwing token getter is swallowed (the primary write can never be harmed)', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 201)))
    vi.stubGlobal('fetch', fetchMock)

    await expect(emitAuditRecord(record(), emitCtx({ getAccessToken: () => { throw new Error('no token') } }))).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips (debug, no request) when the write had no resolvable target namespace', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 201)))
    vi.stubGlobal('fetch', fetchMock)

    await emitAuditRecord(record(''), emitCtx())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(debug).toHaveBeenCalledTimes(1)
  })

  it('recordProvenance no-ops when the PROVENANCE_ENABLED flag is off', () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 201)))
    vi.stubGlobal('fetch', fetchMock)

    recordProvenance(emitCtx({ provenanceEnabled: false }), undefined, deleteRadius, { message: '', ok: true, status: 200 }, TIMES.requestedAt)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// --- runRest integration (through dispatchAction, like useHandleActions.test.ts) ---

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
  ...over,
})

const refs = (items: ResourcesRefs['items']): ResourcesRefs => ({ items })
// A realistic namespaced apiserver target, so the gate (and the audit record) resolve GVR/ns/name.
const patchRef = {
  allowed: true,
  id: 'ref',
  path: '/apis/composition.krateo.io/v1alpha1/namespaces/demo/fireworksapps/my-app',
  payload: {},
  verb: 'PATCH' as const,
}
const restAction = { headers: [], id: 'a', resourceRefId: 'ref', type: 'rest' } as WidgetAction

// The collection POST rides snowplow's /call query shape (snowplow has NO raw /apis
// route): apiVersion=group%2Fversion, the plural, the required-but-ignored `name`
// placeholder (the record uses metadata.generateName), and the write's target namespace.
const AUDIT_URL = 'http://sp/call?apiVersion=audit.krateo.io%2Fv1alpha1&resource=auditrecords&name=-&namespace=demo'
type FetchCall = [string, RequestInit]
const auditCalls = (fetchMock: ReturnType<typeof vi.fn>): FetchCall[] =>
  (fetchMock.mock.calls as FetchCall[]).filter(([url]) => String(url).includes('resource=auditrecords'))
const parseRecord = (call: FetchCall): AuditRecordBody => JSON.parse(call[1].body as string) as AuditRecordBody

describe('runRest — ONE audit record per resolved gated write', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('success: emits ONE record through the same fetch shape (URL + Bearer), ok outcome, human default', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse(true, 200, '{"metadata":{"name":"my-app","namespace":"demo"},"message":"patched"}'))
      .mockResolvedValueOnce(fakeResponse(true, 201))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx()

    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, ctx)

    const calls = auditCalls(fetchMock)
    expect(calls).toHaveLength(1)
    const [[url, init]] = calls
    expect(url).toBe(AUDIT_URL)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')

    const audit = parseRecord(calls[0])
    expect(audit.metadata).toEqual({ generateName: 'ar-', namespace: 'demo' })
    // No origin threaded (a hand-clicked control) → the human default.
    expect(audit.spec.actor).toBe('human')
    expect(audit.spec.action).toEqual({
      group: 'composition.krateo.io',
      name: 'my-app',
      namespace: 'demo',
      resource: 'fireworksapps',
      verb: 'PATCH',
      version: 'v1alpha1',
    })
    expect(audit.spec.outcome).toEqual({ message: 'patched', ok: true, status: 200 })
    expect(Date.parse(audit.spec.requestedAt)).not.toBeNaN()
    expect(Date.parse(audit.spec.resolvedAt)).not.toBeNaN()
  })

  it('failure (non-ok response): still emits ONE record, with the failure outcome', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse(false, 409, '{"status":409,"reason":"Conflict","message":"conflict"}'))
      .mockResolvedValueOnce(fakeResponse(true, 201))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx()

    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, ctx)

    const calls = auditCalls(fetchMock)
    expect(calls).toHaveLength(1)
    expect(parseRecord(calls[0]).spec.outcome).toEqual({ message: 'conflict', ok: false, status: 409 })
    // The failure toast still fired — the audit record never swallows the primary UX.
    expect(ctx.notification.error).toHaveBeenCalledTimes(1)
  })

  it('a network-thrown write is recorded as {ok:false, status:0} (the request itself failed)', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('net down'))
      .mockResolvedValueOnce(fakeResponse(true, 201))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx()

    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, ctx)

    const calls = auditCalls(fetchMock)
    expect(calls).toHaveLength(1)
    expect(parseRecord(calls[0]).spec.outcome).toEqual({ message: 'net down', ok: false, status: 0 })
    expect(ctx.notification.error).toHaveBeenCalledTimes(1)
  })

  it('an agent origin threaded through the runtime lands on the record (actor + session + prompt)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse(true, 200, '{"metadata":{"name":"my-app","namespace":"demo"}}'))
      .mockResolvedValueOnce(fakeResponse(true, 201))
    vi.stubGlobal('fetch', fetchMock)

    await dispatchAction(
      restAction,
      { origin: { actor: 'agent', agentSessionId: 's_xyz', prompt: 'bump the size' }, resourcesRefs: refs([patchRef]) },
      makeCtx()
    )

    const audit = parseRecord(auditCalls(fetchMock)[0])
    expect(audit.spec.actor).toBe('agent')
    expect(audit.spec.agent).toEqual({ id: 'autopilot', sessionId: 's_xyz' })
    expect(audit.spec.prompt).toBe('bump the size')
  })

  it('a DECLINED confirm emits NOTHING (nothing dispatched → nothing to audit)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 200)))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx({ confirm: vi.fn(() => Promise.resolve(false)) })

    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, ctx)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('flag OFF (the default): the write fires, zero audit traffic', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 200, '{"metadata":{"name":"my-app","namespace":"demo"}}')))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx({ provenanceEnabled: false })

    await dispatchAction(restAction, { resourcesRefs: refs([patchRef]) }, ctx)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(auditCalls(fetchMock)).toHaveLength(0)
    expect(ctx.notification.success).toHaveBeenCalledTimes(1)
  })
})

// --- runRestSet integration: ONE record per SET, never per op ---

const OPS: WriteOp[] = [
  {
    path: '/apis/core.krateo.io/v1alpha1/namespaces/demo/compositiondefinitions',
    payload: { metadata: { name: 'my-def', namespace: 'demo' } },
    verb: 'POST',
  },
  { path: '/api/v1/namespaces/demo/configmaps/my-config', payload: { data: {} }, verb: 'PATCH' },
  { path: '/apis/fireworksapp.composition.krateo.io/v1alpha1/namespaces/demo/fireworksapps/doomed', verb: 'DELETE' },
]

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
  ...over,
})

describe('runRestSet — ONE audit record per SET', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('full success: 3 op writes + exactly ONE set record (count = ops.length, summary lists the ops)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 200, '{"message":"done"}')))
    vi.stubGlobal('fetch', fetchMock)

    await runRestSet(OPS, makeSetCtx(), { actor: 'agent', agentSessionId: 's_set', prompt: 'apply the set' })

    const calls = auditCalls(fetchMock)
    expect(calls).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(OPS.length + 1)
    // The record lands in the FIRST op's namespace (the set's representative target).
    expect(calls[0][0]).toBe(AUDIT_URL)

    const audit = parseRecord(calls[0])
    expect(audit.spec.actor).toBe('agent')
    expect(audit.spec.agent).toEqual({ id: 'autopilot', sessionId: 's_set' })
    expect(audit.spec.blastRadius.count).toBe(3)
    // A DELETE inside the set marks the WHOLE set irreversible.
    expect(audit.spec.blastRadius.irreversible).toBe(true)
    // The summary lists every op, in dispatch order.
    expect(audit.spec.blastRadius.summary).toContain('1. POST compositiondefinitions.core.krateo.io/my-def in demo')
    expect(audit.spec.blastRadius.summary).toContain('2. PATCH configmaps/my-config in demo')
    expect(audit.spec.blastRadius.summary).toContain('3. DELETE fireworksapps.fireworksapp.composition.krateo.io/doomed in demo')
    expect(audit.spec.outcome).toEqual({ message: 'all 3 writes applied in order', ok: true, status: 200 })
  })

  it('stop-on-first-error: the ONE set record carries the failure outcome (which op, why)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse(true, 201))
      .mockResolvedValueOnce(fakeResponse(false, 403, '{"message":"forbidden"}'))
      .mockResolvedValueOnce(fakeResponse(true, 201))
    vi.stubGlobal('fetch', fetchMock)

    await runRestSet(OPS, makeSetCtx())

    const calls = auditCalls(fetchMock)
    expect(calls).toHaveLength(1)
    const audit = parseRecord(calls[0])
    // No origin passed → the human default applies to sets too.
    expect(audit.spec.actor).toBe('human')
    expect(audit.spec.outcome.ok).toBe(false)
    expect(audit.spec.outcome.status).toBe(403)
    expect(audit.spec.outcome.message).toContain('op 2 of 3')
    expect(audit.spec.outcome.message).toContain('forbidden')
  })

  it('a declined set confirm emits NOTHING', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 200)))
    vi.stubGlobal('fetch', fetchMock)

    await runRestSet(OPS, makeSetCtx({ confirm: vi.fn(() => Promise.resolve(false)) }))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
