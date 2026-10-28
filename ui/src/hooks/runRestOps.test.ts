/**
 * runRestOps — the W3-2 multi-op rest action (`ops[]`): ONE submit applies N writes of
 * DIFFERENT shapes as ONE gated set. Exercised through dispatchAction (the real branch
 * point in runRest) with a fully-mocked ActionContext, mirroring the W3-1 fanOutPath
 * coverage in useHandleActions.test.ts — in its own file only for the max-lines budget
 * (the runRestSet.test.ts precedent). Proves the contract:
 *   - each op resolves its OWN resource ref (path/verb) and builds its OWN
 *     payload/payloadToOverride against the SAME submitted values (Role + RoleBinding);
 *   - ONE aggregated confirm; DECLINE = nothing dispatched;
 *   - ordered dispatch, stop-on-first-error (a later op never fires, no navigate);
 *   - config errors (unknown/non-mutating op ref, ops×fanOutPath) dispatch NOTHING.
 */
/* eslint-disable no-template-curly-in-string -- these tests intentionally use literal ${...} (the jq-override / redirect DSL). */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResourcesRefs, WidgetAction } from '../types/Widget'

import { dispatchAction, type ActionContext } from './useHandleActions'

type RestAction = WidgetAction & { type: 'rest' }

// A fully-mocked ActionContext so the dispatcher runs without React (same shape as
// useHandleActions.test.ts).
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
  provenanceEnabled: false,
  registerCleanup: vi.fn(),
  reloadRoutes: vi.fn(),
  resolveJq: vi.fn((expr: string) => Promise.resolve(`jq:${expr}`)),
  setLoading: vi.fn(),
  ...over,
})

const refs = (items: ResourcesRefs['items']): ResourcesRefs => ({ items })
const fakeResponse = (ok: boolean, body: string): Response =>
  ({ ok, text: () => Promise.resolve(body) } as unknown as Response)

// Two refs with DIFFERENT targets (different plurals) — the shape fanOutPath structurally
// cannot express (it reuses ONE ref's path/verb for every op).
const roleRef = { allowed: true, id: 'create-role', path: '/call?apiVersion=rbac.authorization.k8s.io%2Fv1&resource=roles', payload: {}, verb: 'POST' as const }
const bindingRef = { allowed: true, id: 'create-rolebinding', path: '/call?apiVersion=rbac.authorization.k8s.io%2Fv1&resource=rolebindings', payload: {}, verb: 'POST' as const }
const rbacRefs = () => refs([roleRef, bindingRef])

// A grant-shaped action (Role + RoleBinding): each op carries its OWN static payload
// shape + overrides; both interpolate against the SAME submitted values. The top-level
// resourceRefId is ignored for dispatch (it points at the first op's ref per contract).
const opsAction = (over: Partial<RestAction> = {}): RestAction => ({
  headers: [],
  id: 'a1',
  onSuccessNavigateTo: '/settings/access/${subject}',
  ops: [
    {
      payload: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', rules: [{ apiGroups: [''], resources: ['pods'], verbs: ['get'] }] },
      payloadToOverride: [
        { name: 'metadata.name', value: '${ "krateo-access-" + .json.subject }' },
        { name: 'metadata.namespace', value: '${ .json.namespace }' },
      ],
      resourceRefId: 'create-role',
    },
    {
      payload: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role' } },
      payloadToOverride: [
        { name: 'metadata.name', value: '${ "krateo-access-" + .json.subject }' },
        { name: 'metadata.namespace', value: '${ .json.namespace }' },
        { name: 'roleRef.name', value: '${ "krateo-access-" + .json.subject }' },
      ],
      resourceRefId: 'create-rolebinding',
    },
  ],
  resourceRefId: 'create-role',
  type: 'rest',
  ...over,
})

// resolveJq stub implementing just the two expressions the action uses.
const opsResolveJq = () => vi.fn((expr: string, vals: Record<string, unknown>): Promise<string> => {
  const json = vals.json as { namespace: string; subject: string }
  if (expr.includes('.json.namespace')) { return Promise.resolve(json.namespace) }
  return Promise.resolve(`krateo-access-${json.subject}`)
})

describe('dispatchAction — W3-2 ops (one submit → N DISTINCT writes via the set fabric)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('applies two DIFFERENT payload shapes to two DIFFERENT refs behind ONE confirm, in order', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.fn(() => Promise.resolve(true))
    const ctx = makeCtx({ confirm, resolveJq: opsResolveJq() })

    await dispatchAction(
      opsAction(),
      { customPayload: { namespace: 'team-a', subject: 'alice' }, resourcesRefs: rbacRefs() },
      ctx
    )

    // ONE aggregated confirm for the whole set, then one POST per op in authored order,
    // each hitting its OWN ref path with its OWN payload's name/namespace.
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map((call) => (call as unknown as [string])[0])
    expect(urls[0]).toBe('http://sp/call?apiVersion=rbac.authorization.k8s.io%2Fv1&resource=roles&name=krateo-access-alice&namespace=team-a')
    expect(urls[1]).toBe('http://sp/call?apiVersion=rbac.authorization.k8s.io%2Fv1&resource=rolebindings&name=krateo-access-alice&namespace=team-a')
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(((call as unknown as [string, { body: string }])[1]).body) as { kind: string; metadata: { name: string; namespace: string }; roleRef?: { name: string }; rules?: unknown[] })
    expect(bodies[0].kind).toBe('Role')
    expect(bodies[0].rules).toHaveLength(1)
    expect(bodies[0].metadata).toEqual({ name: 'krateo-access-alice', namespace: 'team-a' })
    expect(bodies[1].kind).toBe('RoleBinding')
    expect(bodies[1].roleRef?.name).toBe('krateo-access-alice')
    expect(bodies[1].metadata).toEqual({ name: 'krateo-access-alice', namespace: 'team-a' })
    // Full success → set success toast, drawer closed, onSuccessNavigateTo interpolated
    // from the submitted values.
    expect(ctx.notification.success).toHaveBeenCalled()
    expect(ctx.closeDrawer).toHaveBeenCalled()
    expect(ctx.navigate).toHaveBeenCalledWith('/settings/access/alice')
  })

  it('declined set confirm: NOTHING is dispatched and no navigation happens', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx({ confirm: vi.fn(() => Promise.resolve(false)), resolveJq: opsResolveJq() })

    await dispatchAction(
      opsAction(),
      { customPayload: { namespace: 'team-a', subject: 'alice' }, resourcesRefs: rbacRefs() },
      ctx
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.navigate).not.toHaveBeenCalled()
  })

  it('stop-on-first-error: a failed op halts the set — the later op never fires, no navigate', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse(false, '{"message":"boom"}'))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx({ resolveJq: opsResolveJq() })

    await dispatchAction(
      opsAction(),
      { customPayload: { namespace: 'team-a', subject: 'alice' }, resourcesRefs: rbacRefs() },
      ctx
    )

    // The Role POST fails → the RoleBinding POST never fires; honest partial-state toast; no redirect.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ctx.notification.error).toHaveBeenCalled()
    expect(ctx.navigate).not.toHaveBeenCalled()
  })

  it('an op with an unknown resourceRefId is a config error: no confirm, nothing dispatched', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.fn(() => Promise.resolve(true))
    const ctx = makeCtx({ confirm, resolveJq: opsResolveJq() })

    await dispatchAction(
      opsAction(),
      // The SECOND op's ref is missing — even a mid-list config error must dispatch nothing.
      { customPayload: { namespace: 'team-a', subject: 'alice' }, resourcesRefs: refs([roleRef]) },
      ctx
    )

    expect(confirm).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.notification.error).toHaveBeenCalled()
  })

  it('an op referencing a non-mutating (GET) ref is a config error: nothing dispatched', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.fn(() => Promise.resolve(true))
    const ctx = makeCtx({ confirm, resolveJq: opsResolveJq() })

    await dispatchAction(
      opsAction(),
      { customPayload: { namespace: 'team-a', subject: 'alice' }, resourcesRefs: refs([roleRef, { ...bindingRef, verb: 'GET' as const }]) },
      ctx
    )

    expect(confirm).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.notification.error).toHaveBeenCalled()
  })

  it('ops + fanOutPath is a config error (mutually exclusive): nothing dispatched', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.fn(() => Promise.resolve(true))
    const ctx = makeCtx({ confirm, resolveJq: opsResolveJq() })

    await dispatchAction(
      opsAction({ fanOutPath: 'subjects' }),
      { customPayload: { namespace: 'team-a', subject: 'alice', subjects: ['alice'] }, resourcesRefs: rbacRefs() },
      ctx
    )

    expect(confirm).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.notification.error).toHaveBeenCalled()
  })
})
