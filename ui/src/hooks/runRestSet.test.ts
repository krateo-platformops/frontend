/**
 * runRestSet — the P1 applySet fabric (W0-4). Pure-logic coverage (no RTL/jsdom),
 * matching the repo's other hook/Autopilot tests. Proves the fabric's contract:
 *   - ONE aggregated set-level confirm for the WHOLE set; DECLINE = NOTHING dispatched
 *     (fetch never called, null returned, no toasts);
 *   - the radius passed to confirm carries the ordered per-op targets, payload previews,
 *     and the `irreversible` flag on DELETE ops;
 *   - sequential dispatch in index order through the same fetch shape runRest uses
 *     (base URL + Bearer auth), STOP ON FIRST ERROR (later ops never fire);
 *   - per-item results [{index, ok, status, message}] for exactly the ops that ran;
 *   - honest partial-state reporting: the failure toast names WHICH op failed and that
 *     the remaining ops were NOT executed; full success reports the count.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BlastRadiusSet } from './blastRadius.types'
import { runRestSet, type RunRestSetContext, type WriteOp } from './runRestSet'

const OPS: WriteOp[] = [
  {
    path: '/apis/core.krateo.io/v1alpha1/namespaces/demo/compositiondefinitions',
    payload: { metadata: { name: 'my-def', namespace: 'demo' }, spec: { chart: { version: '1.0.0' } } },
    verb: 'POST',
  },
  {
    path: '/api/v1/namespaces/demo/configmaps/my-config',
    payload: { data: { key: 'value' } },
    verb: 'PATCH',
  },
  {
    path: '/apis/fireworksapp.composition.krateo.io/v1alpha1/namespaces/demo/fireworksapps/doomed',
    verb: 'DELETE',
  },
]

const makeCtx = (over: Partial<RunRestSetContext> = {}): RunRestSetContext => ({
  apiBaseUrl: 'http://sp',
  confirm: vi.fn(() => Promise.resolve(true)),
  getAccessToken: vi.fn(() => 'tok'),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  message: { destroy: vi.fn() } as unknown as RunRestSetContext['message'],
  notification: { error: vi.fn(), success: vi.fn() } as unknown as RunRestSetContext['notification'],
  provenanceEnabled: false,
  registerCleanup: vi.fn(),
  setLoading: vi.fn(),
  ...over,
})

const fakeResponse = (ok: boolean, status: number, body = ''): Response =>
  ({ ok, status, text: () => Promise.resolve(body) } as unknown as Response)

afterEach(() => { vi.unstubAllGlobals() })

describe('runRestSet — the ONE set-level gate (decline = nothing dispatched)', () => {
  it('declined confirm: fetch is NEVER called, null is returned, no toasts fire', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 200)))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx({ confirm: vi.fn(() => Promise.resolve(false)) })

    const results = await runRestSet(OPS, ctx)

    expect(results).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.notification.success).not.toHaveBeenCalled()
    expect(ctx.notification.error).not.toHaveBeenCalled()
    expect(ctx.invalidateQueries).not.toHaveBeenCalled()
  })

  it('confirm is called ONCE with the aggregated set radius: count + ordered ops + irreversible DELETE + previews', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, 200))))
    const ctx = makeCtx()

    await runRestSet(OPS, ctx)

    expect(ctx.confirm).toHaveBeenCalledTimes(1)
    const [radius] = (ctx.confirm as ReturnType<typeof vi.fn>).mock.calls[0] as [BlastRadiusSet]
    expect(radius.kind).toBe('set')
    expect(radius.count).toBe(3)
    expect(radius.ops).toHaveLength(3)

    // Op order = dispatch order; targets parsed per op; the POST names the object from its payload.
    expect(radius.ops[0]).toMatchObject({
      gvr: { group: 'core.krateo.io', resource: 'compositiondefinitions', version: 'v1alpha1' },
      irreversible: false,
      name: 'my-def',
      namespace: 'demo',
      verb: 'POST',
    })
    expect(radius.ops[0].payloadPreview).toEqual(OPS[0].payload)
    expect(radius.ops[1]).toMatchObject({
      gvr: { group: '', resource: 'configmaps', version: 'v1' },
      irreversible: false,
      name: 'my-config',
      verb: 'PATCH',
    })
    // The DELETE op is flagged irreversible and carries no payload preview.
    expect(radius.ops[2]).toMatchObject({ irreversible: true, name: 'doomed', verb: 'DELETE' })
    expect(radius.ops[2].payloadPreview).toBeUndefined()
  })

  it('an empty set is a no-op: no confirm, no dispatch, null', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 200)))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx()

    expect(await runRestSet([], ctx)).toBeNull()
    expect(ctx.confirm).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('runRestSet — ordered dispatch through the same write path', () => {
  it('dispatches sequentially in index order with the base URL + Bearer auth; full success → results + count toast', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 200, '{"message":"created"}')))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx()

    const results = await runRestSet(OPS, ctx)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    // index order = dispatch order, each to apiBaseUrl + op.path with the op's verb.
    expect(fetchMock.mock.calls.map((call) => (call as unknown[])[0])).toEqual(OPS.map((op) => `http://sp${op.path}`))
    const inits = fetchMock.mock.calls.map((call) => (call as unknown[])[1] as RequestInit)
    expect(inits.map((init) => init.method)).toEqual(['POST', 'PATCH', 'DELETE'])
    for (const init of inits) {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    }
    // PATCH goes out as a merge-patch (apiserver semantics); DELETE carries no body.
    expect((inits[1].headers as Record<string, string>)['Content-Type']).toBe('application/merge-patch+json')
    expect(inits[2].body).toBeUndefined()

    expect(results).toEqual([
      { index: 0, message: 'created', ok: true, status: 200 },
      { index: 1, message: 'created', ok: true, status: 200 },
      { index: 2, message: 'created', ok: true, status: 200 },
    ])
    expect(ctx.notification.success).toHaveBeenCalledTimes(1)
    const [successArgs] = (ctx.notification.success as ReturnType<typeof vi.fn>).mock.calls[0] as [{ description: string }]
    expect(successArgs.description).toContain('3')
    expect(ctx.invalidateQueries).toHaveBeenCalledTimes(1)
  })

  it('STOPS ON FIRST ERROR: the op after a failure is never dispatched; per-item results cover only the ops that ran', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse(true, 201, '{"message":"created"}'))
      .mockResolvedValueOnce(fakeResponse(false, 409, '{"message":"conflict"}'))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx()

    const results = await runRestSet(OPS, ctx)

    // op 3 (the DELETE) must never fire.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(results).toEqual([
      { index: 0, message: 'created', ok: true, status: 201 },
      { index: 1, message: 'conflict', ok: false, status: 409 },
    ])
    expect(ctx.notification.success).not.toHaveBeenCalled()
  })

  it('a network error (fetch rejects) is a per-item {ok:false, status:0} result and stops the set', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse(true, 200))
      .mockRejectedValueOnce(new Error('boom'))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx()

    const results = await runRestSet(OPS, ctx)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(results?.[1]).toEqual({ index: 1, message: 'boom', ok: false, status: 0 })
  })
})

describe('runRestSet — honest partial-state reporting', () => {
  it('the failure toast names EXACTLY which op failed and that the remaining ops were NOT executed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse(true, 201))
      .mockResolvedValueOnce(fakeResponse(false, 403, '{"message":"forbidden"}'))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx()

    await runRestSet(OPS, ctx)

    expect(ctx.notification.error).toHaveBeenCalledTimes(1)
    const [errorArgs] = (ctx.notification.error as ReturnType<typeof vi.fn>).mock.calls[0] as [{ description: string; message: string }]
    // WHICH op: position + identity (verb + resource/name) + the server's message.
    expect(errorArgs.description).toContain('Op 2 of 3')
    expect(errorArgs.description).toContain('PATCH configmaps/my-config')
    expect(errorArgs.description).toContain('forbidden')
    // Applied ops are NOT rolled back; subsequent ops were NOT executed.
    expect(errorArgs.description).toContain('already applied')
    expect(errorArgs.description).toContain('NOT executed')
    expect(errorArgs.message).toBe('Write set partially applied')
    // The successful first op still converges the UI.
    expect(ctx.invalidateQueries).toHaveBeenCalledTimes(1)
  })

  it('a first-op failure reports that NO ops were applied (and does not invalidate)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(false, 500, '{"message":"kaput"}'))))
    const ctx = makeCtx()

    await runRestSet(OPS, ctx)

    const [errorArgs] = (ctx.notification.error as ReturnType<typeof vi.fn>).mock.calls[0] as [{ description: string; message: string }]
    expect(errorArgs.description).toContain('Op 1 of 3')
    expect(errorArgs.description).toContain('No ops were applied')
    expect(errorArgs.message).toBe('Write set not applied')
    expect(ctx.invalidateQueries).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// SetDispatchOptions — the previewPage-v2 SANDBOX relaxation (A.2.3)
// ────────────────────────────────────────────────────────────────────────────

/** /call-shaped sandbox write ops (the shape the preview flow compiles). */
const SANDBOX_OPS: WriteOp[] = [
  {
    path: '/call?apiVersion=widgets.templates.krateo.io%2Fv1beta1&resource=flexes&name=-&namespace=krateo-preview',
    payload: { kind: 'Flex', metadata: { name: 'preview-draft-root', namespace: 'krateo-preview' } },
    verb: 'POST',
  },
  {
    path: '/call?apiVersion=templates.krateo.io%2Fv1&resource=restactions&name=preview-projects&namespace=krateo-preview',
    verb: 'DELETE',
  },
]

describe('runRestSet — SetDispatchOptions (previewPage v2 sandbox relaxation)', () => {
  it('skipConfirmForSandbox + ALL ops confined to it: confirm is SKIPPED, dispatch + invalidation run', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 201, '{"message":"created"}')))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx()

    const results = await runRestSet(SANDBOX_OPS, ctx, undefined, { skipConfirmForSandbox: 'krateo-preview' })

    expect(ctx.confirm).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(2)
    expect(ctx.invalidateQueries).toHaveBeenCalledTimes(1)
  })

  it('skipRevalidate (a draft record\'s autosave): the write lands, nothing on screen is refetched', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 201, '{"message":"created"}')))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx()

    const results = await runRestSet(SANDBOX_OPS, ctx, undefined, { skipConfirmForSandbox: 'krateo-preview', skipRevalidate: true })

    expect(results?.every((result) => result.ok)).toBe(true)
    expect(ctx.invalidateQueries).not.toHaveBeenCalled()
    expect(ctx.registerCleanup).not.toHaveBeenCalled()
  })

  it('ANY op outside the named namespace falls back to the FULL gate (confirm runs; decline = nothing)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 200)))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx({ confirm: vi.fn(() => Promise.resolve(false)) })

    const mixed = [...SANDBOX_OPS, {
      path: '/call?apiVersion=widgets.templates.krateo.io%2Fv1beta1&resource=paragraphs&name=x&namespace=krateo-system',
      verb: 'DELETE' as const,
    }]
    const results = await runRestSet(mixed, ctx, undefined, { skipConfirmForSandbox: 'krateo-preview' })

    expect(ctx.confirm).toHaveBeenCalledTimes(1)
    expect(results).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the confinement check reads each op\'s OWN path — an unparseable path can never skip the gate', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, 200))))
    const ctx = makeCtx()

    await runRestSet([{ path: '/not-a-call-path', verb: 'POST' }], ctx, undefined, { skipConfirmForSandbox: 'krateo-preview' })

    expect(ctx.confirm).toHaveBeenCalledTimes(1)
  })

  it('silent: NO toasts on success or failure; results, invalidation and stop-on-error are intact', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse(true, 201, '{"message":"created"}'))
      .mockResolvedValueOnce(fakeResponse(false, 409, '{"message":"conflict"}'))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx()

    const results = await runRestSet(SANDBOX_OPS, ctx, undefined, { silent: true, skipConfirmForSandbox: 'krateo-preview' })

    expect(ctx.notification.success).not.toHaveBeenCalled()
    expect(ctx.notification.error).not.toHaveBeenCalled()
    expect(results).toEqual([
      { index: 0, message: 'created', ok: true, status: 201 },
      { index: 1, message: 'conflict', ok: false, status: 409 },
    ])
    expect(ctx.invalidateQueries).toHaveBeenCalledTimes(1)
  })

  it('provenance is STILL emitted on a confirm-skipped sandbox set (audited, friction-light)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, 201, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx({ provenanceEnabled: true })

    await runRestSet(SANDBOX_OPS, ctx, { actor: 'agent', agentSessionId: 's_1' }, { silent: true, skipConfirmForSandbox: 'krateo-preview' })

    // 2 sandbox writes + the fire-and-forget AuditRecord POST (audit.krateo.io).
    const audit = fetchMock.mock.calls.map((call) => String((call as unknown[])[0])).filter((url) => url.includes('auditrecords'))
    expect(audit).toHaveLength(1)
    expect(ctx.confirm).not.toHaveBeenCalled()
  })
})
