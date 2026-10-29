/**
 * useHandleAction — dispatchAction coverage: routing, the onEventNavigateTo (SSE) race and
 * cleanup, and the W3-1 fan-out fabric (one submit → N ordered writes).
 *
 * SCOPE: still no RTL / jsdom. `makeCtx` supplies a fully-mocked ActionContext, which is what
 * makes the (formerly React-bound) dispatcher unit-testable; the pure helpers it is built from
 * are covered in useHandleActions.test.ts.
 */
/* eslint-disable no-template-curly-in-string -- these tests intentionally use literal ${...} (the jq / redirect DSL). */
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest'

import type { ResourcesRefs, WidgetAction } from '../types/Widget'

import { restAction, type RestAction } from './__fixtures__/restAction'
import { dispatchAction, type ActionContext } from './useHandleActions'

// A fully-mocked ActionContext so the (formerly React-bound) dispatcher is unit-testable.
const makeCtx = (over: Partial<ActionContext> = {}): ActionContext => ({
  apiBaseUrl: 'http://sp',
  closeDrawer: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(true)),
  eventsBaseUrl: 'http://ev',
  getAccessToken: vi.fn(() => 'tok'),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  message: { destroy: vi.fn(), loading: vi.fn() } as unknown as ActionContext['message'],
  navigate: vi.fn(),
  notification: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } as unknown as ActionContext['notification'],
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
const postRef = { allowed: true, id: 'ref', path: '/api/x', payload: {}, verb: 'POST' as const }
const fakeResponse = (ok: boolean, body: string): Response =>
  ({ ok, text: () => Promise.resolve(body) } as unknown as Response)

describe('X2 — a denied action ref is not a broken widget definition', () => {
  /**
   * The rule is that "denied", "not found" and "broken" stay distinguishable. RBAC filters
   * `resourcesRefs.items` BEFORE this path sees it, so a denied ref and a typo'd one are
   * byte-identical here — both simply absent. WidgetRenderer was given `deniedRefIds` to tell
   * them apart; this path was not, so every denial was reported as a broken widget definition:
   * the author blamed for the viewer's permissions, and someone sent hunting a typo that is
   * not there.
   */
  it('reports a DENIED ref as not-permitted, not as a missing reference', async () => {
    const ctx = makeCtx()
    await dispatchAction(
      { id: 'a', resourceRefId: 'hidden', type: 'openDrawer' },
      { deniedRefIds: ['hidden'], resourcesRefs: refs([]) }, ctx)
    expect(ctx.notification.warning).toHaveBeenCalledTimes(1)
    expect(ctx.notification.error).not.toHaveBeenCalled()
    // And it must not name the withheld resource: saying which ref was denied leaks the
    // existence of something outside the viewer's scope, which is why a denied child renders
    // as absence rather than as an announcement.
    // Cast to the SHAPE antd's notification takes, not to `ReturnType<typeof vi.fn>` — that is
    // `Mock<Procedure>`, whose args are `any`, so reading `.mock.calls` out of it checks nothing.
    const warned = ctx.notification.warning as unknown as Mock<(config: Record<string, unknown>) => void>
    const [[arg]] = warned.mock.calls
    expect(JSON.stringify(arg)).not.toContain('hidden')
  })

  it('still reports a genuinely MISSING ref as a broken definition', async () => {
    const ctx = makeCtx()
    await dispatchAction(
      { id: 'a', resourceRefId: 'typo', type: 'openDrawer' },
      { deniedRefIds: [], resourcesRefs: refs([]) }, ctx)
    expect(ctx.notification.error).toHaveBeenCalledTimes(1)
    expect(ctx.notification.warning).not.toHaveBeenCalled()
  })

  it('defaults to the broken-definition reading when no deniedRefIds are supplied', async () => {
    // Back-compat: a call site that filters nothing behaves exactly as before.
    const ctx = makeCtx()
    await dispatchAction(
      { id: 'a', resourceRefId: 'typo', type: 'openDrawer' },
      { resourcesRefs: refs([]) }, ctx)
    expect(ctx.notification.error).toHaveBeenCalledTimes(1)
    expect(ctx.notification.warning).not.toHaveBeenCalled()
  })
})

describe('dispatchAction — routing + non-SSE rest paths', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('navigate: navigates to the literal path', async () => {
    const ctx = makeCtx()
    await dispatchAction({ id: 'n', path: '/go', type: 'navigate' }, { resourcesRefs: refs([]) }, ctx)
    expect(ctx.navigate).toHaveBeenCalledWith('/go')
  })

  it('navigate: a ${...} path is resolved via jq before navigating', async () => {
    const ctx = makeCtx({ resolveJq: vi.fn(() => Promise.resolve('/resolved')) })
    await dispatchAction({ id: 'n', path: '${.widget}', type: 'navigate' }, { resourcesRefs: refs([]) }, ctx)
    expect(ctx.navigate).toHaveBeenCalledWith('/resolved')
  })

  it('navigate: errors when no path is given (no widgetEndpoint bypass)', async () => {
    const ctx = makeCtx()
    await dispatchAction({ id: 'n', type: 'navigate' }, { resourcesRefs: refs([]) }, ctx)
    expect(ctx.navigate).not.toHaveBeenCalled()
    expect(ctx.notification.error).toHaveBeenCalledTimes(1)
  })

  it('navigate: declined confirmation does not navigate', async () => {
    const ctx = makeCtx({ confirm: vi.fn(() => Promise.resolve(false)) })
    await dispatchAction({ id: 'n', path: '/go', requireConfirmation: true, type: 'navigate' }, { resourcesRefs: refs([]) }, ctx)
    expect(ctx.navigate).not.toHaveBeenCalled()
  })

  it('errors when the action references a resourceRef that is not present', async () => {
    const ctx = makeCtx()
    await dispatchAction({ headers: [], id: 'a', resourceRefId: 'missing', type: 'rest' }, { resourcesRefs: refs([]) }, ctx)
    expect(ctx.notification.error).toHaveBeenCalledTimes(1)
  })

  it('openDrawer: opens with the resource ref path as the widget endpoint', async () => {
    const ctx = makeCtx()
    await dispatchAction(
      { id: 'd', resourceRefId: 'ref', type: 'openDrawer' },
      { resourcesRefs: refs([{ allowed: true, id: 'ref', path: '/api/drawer', payload: {}, verb: 'GET' }]) },
      ctx
    )
    expect(ctx.openDrawer).toHaveBeenCalledWith(expect.objectContaining({ widgetEndpoint: '/api/drawer' }))
  })

  it('rest POST: success → success toast + query invalidation', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, '{"metadata":{"name":"n","namespace":"ns"},"message":"ok"}'))))
    const ctx = makeCtx()
    await dispatchAction(
      { headers: [], id: 'a', resourceRefId: 'ref', type: 'rest' },
      { resourcesRefs: refs([postRef]) },
      ctx
    )
    expect(ctx.notification.success).toHaveBeenCalledTimes(1)
    expect(ctx.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(ctx.notification.error).not.toHaveBeenCalled()
  })

  it('rest DELETE: empty 204 body succeeds (no false error)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, ''))))
    const ctx = makeCtx()
    await dispatchAction(
      { headers: [], id: 'a', resourceRefId: 'ref', type: 'rest' },
      { resourcesRefs: refs([{ allowed: true, id: 'ref', path: '/api/x', payload: {}, verb: 'DELETE' }]) },
      ctx
    )
    expect(ctx.notification.success).toHaveBeenCalledTimes(1)
    expect(ctx.notification.error).not.toHaveBeenCalled()
  })

  it('rest: a non-ok response surfaces an error toast', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(false, '{"status":404,"reason":"NotFound","message":"nope"}'))))
    const ctx = makeCtx()
    await dispatchAction(
      { headers: [], id: 'a', resourceRefId: 'ref', type: 'rest' },
      { resourcesRefs: refs([postRef]) },
      ctx
    )
    expect(ctx.notification.error).toHaveBeenCalledTimes(1)
    expect(ctx.invalidateQueries).not.toHaveBeenCalled()
  })

  it('rest: declined confirmation never issues the request', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx({ confirm: vi.fn(() => Promise.resolve(false)) })
    await dispatchAction(
      { headers: [], id: 'a', requireConfirmation: true, resourceRefId: 'ref', type: 'rest' },
      { resourcesRefs: refs([postRef]) },
      ctx
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.notification.success).not.toHaveBeenCalled()
  })

  it('routes unexpected handler errors to an error toast', async () => {
    const ctx = makeCtx({ getAccessToken: vi.fn(() => { throw new Error('boom') }) })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, '{}'))))
    await dispatchAction(
      { headers: [], id: 'a', resourceRefId: 'ref', type: 'rest' },
      { resourcesRefs: refs([postRef]) },
      ctx
    )
    expect(ctx.notification.error).toHaveBeenCalledTimes(1)
  })
})

/**
 * Controllable subscription on the shared SSE client, for the onEventNavigateTo path.
 *
 * Mocked at the sseClient seam rather than at the global: the transport (fetch + Bearer,
 * connection sharing, frame parsing) is sseClient.test.ts's subject, and these tests are
 * about dispatchAction's event race and cleanup. Stubbing a global EventSource would also
 * no longer work — the client uses `fetch`, which these tests already stub for the REST
 * call, so the two would collide.
 *
 * `vi.hoisted` because a `vi.mock` factory runs before the file body, so a plain
 * module-level const would still be in its TDZ when the factory reads it.
 */
const { sseSubscriptions } = vi.hoisted(() => ({
  sseSubscriptions: [] as { url: string; topic: string; onMessage: (raw: string) => void; closed: boolean }[],
}))

vi.mock('./sseClient', () => ({
  subscribeSse: (url: string, topic: string, subscriber: { onMessage: (raw: string) => void }) => {
    const entry = { closed: false, onMessage: subscriber.onMessage, topic, url }
    sseSubscriptions.push(entry)

    return () => { entry.closed = true }
  },
}))

/** Deliver one event on the most recent subscription, as the server would. */
const emitSse = (data: unknown) => { sseSubscriptions.at(-1)?.onMessage(JSON.stringify(data)) }

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0) })

const restOnEvent = (): WidgetAction => ({
  headers: [],
  id: 'a',
  onEventNavigateTo: { eventReason: 'Ready', url: '/done' },
  resourceRefId: 'ref',
  type: 'rest',
})

describe('dispatchAction — onEventNavigateTo (SSE) race + cleanup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sseSubscriptions.length = 0
  })

  it('a PLAIN-TEXT loadingMessage is shown as-is and never sent to /jq', async () => {
    // This site guarded on TRUTHINESS, not on `${`, so a plain message went to the jq resolver —
    // which warned and handed it back. That pass-through made the resolver double as "resolve it,
    // or else return it". Once a malformed expression THROWS (portal#226), an unguarded plain
    // message would abort the very action it was announcing. Nothing else covers this.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, '{"metadata":{"uid":"U1"}}'))))
    const action = { ...restOnEvent(), onEventNavigateTo: { eventReason: 'Ready', loadingMessage: 'Creating your page…', url: '/done' } }

    const ctx = makeCtx()
    await dispatchAction(action, { resourcesRefs: refs([postRef]) }, ctx)
    await flush()

    expect(ctx.message.loading).toHaveBeenCalledWith('Creating your page…', expect.anything())
    expect(ctx.resolveJq).not.toHaveBeenCalled()
  })

  it('a ${…} loadingMessage still goes through /jq', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, '{"metadata":{"uid":"U1"}}'))))
    const action = { ...restOnEvent(), onEventNavigateTo: { eventReason: 'Ready', loadingMessage: '${ "Creating " + .json.kind }', url: '/done' } }

    const ctx = makeCtx()
    await dispatchAction(action, { resourcesRefs: refs([postRef]) }, ctx)
    await flush()

    expect(ctx.resolveJq).toHaveBeenCalledWith('${ "Creating " + .json.kind }', expect.anything())
    expect(ctx.message.loading).toHaveBeenCalledWith('jq:${ "Creating " + .json.kind }', expect.anything())
  })

  it('(3) replays an event that arrived before the POST response set resourceUid', async () => {
    let resolveFetch: (r: Response) => void = () => undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))

    const ctx = makeCtx()
    const pending = dispatchAction(restOnEvent(), { resourcesRefs: refs([postRef]) }, ctx)

    // let runRest reach the fetch await (the stream is subscribed by now)
    await flush()
    expect(sseSubscriptions.at(-1)).toBeDefined()

    // event arrives FIRST — it must be buffered, not dropped
    emitSse({ involvedObject: { uid: 'U123' }, reason: 'Ready' })
    expect(ctx.navigate).not.toHaveBeenCalled()

    // the response lands and sets resourceUid → the buffered event replays
    resolveFetch(fakeResponse(true, '{"metadata":{"uid":"U123"}}'))
    await pending
    await flush()

    expect(ctx.navigate).toHaveBeenCalledWith('/done')
    expect(ctx.notification.error).not.toHaveBeenCalled()
  })

  it('subscribes with NO credential in the url, on the shared /notifications stream', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, '{"metadata":{"uid":"U"}}'))))

    await dispatchAction(restOnEvent(), { resourcesRefs: refs([postRef]) }, makeCtx({ getAccessToken: vi.fn(() => 'a.b+c') }))

    // installer#395: the token used to ride here as ?access_token= and reach every access
    // log on the path. sseClient now sends it as an Authorization header instead, so this
    // call site must hand over the bare endpoint — and the same one the bell uses, so the
    // two share a connection rather than opening a socket each.
    const subscription = sseSubscriptions.at(-1)
    expect(subscription?.url).toBe('http://ev/notifications')
    expect(subscription?.url).not.toContain('a.b')
    expect(subscription?.url).not.toContain('access_token')
    expect(subscription?.topic).toBe('krateo')
  })

  it('(7) keeps waiting after the widget unmounts, and still shows the result and redirects', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, '{"metadata":{"uid":"U"}}'))))

    let captured: (() => void) | undefined
    const ctx = makeCtx({ registerCleanup: (fn) => { captured = fn } })

    await dispatchAction(restOnEvent(), { resourcesRefs: refs([postRef]) }, ctx)

    const subscription = sseSubscriptions.at(-1)
    expect(captured).toBeDefined()

    // the hook's unmount teardown: a refetch re-rendered the button away
    captured?.()
    expect(subscription?.closed).toBe(false)

    emitSse({ involvedObject: { uid: 'U' }, reason: 'Ready' })
    await flush()

    expect(subscription?.closed).toBe(true)
    expect(ctx.message.destroy).toHaveBeenCalled()
    expect(ctx.notification.success).toHaveBeenCalled()
    expect(ctx.navigate).toHaveBeenCalledWith('/done')
  })

  it('(7) after the user left the page, shows the result but does not redirect', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, '{"metadata":{"uid":"U"}}'))))

    const location = { pathname: '/incidents/ns/name' }
    vi.stubGlobal('window', { location })

    let captured: (() => void) | undefined
    const ctx = makeCtx({ registerCleanup: (fn) => { captured = fn } })

    await dispatchAction(restOnEvent(), { resourcesRefs: refs([postRef]) }, ctx)
    captured?.()
    location.pathname = '/elsewhere'

    emitSse({ involvedObject: { uid: 'U' }, reason: 'Ready' })
    await flush()

    expect(ctx.notification.success).toHaveBeenCalled()
    expect(ctx.navigate).not.toHaveBeenCalled()
  })
})

describe('dispatchAction — W3-1 fanOutPath (one submit → N ordered writes via the set fabric)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  // A fleet-rollout-shaped action: fan out over `clusters`, deriving each op's name and
  // deploy target from the SCALAR element the fabric substitutes for the array field.
  const fanAction = (over: Partial<RestAction> = {}): RestAction => restAction({
    fanOutPath: 'clusters',
    onSuccessNavigateTo: '/compositions',
    payload: { apiVersion: 'core.krateo.io/v1alpha1', kind: 'CompositionDefinition' },
    payloadToOverride: [
      { name: 'metadata.name', value: '${ .json.name + "-" + .json.clusters }' },
      { name: 'metadata.namespace', value: 'krateo-system' },
      { name: 'spec.deploy.targetRef.name', value: '${ .json.clusters }' },
    ],
    ...over,
  })

  // resolveJq stub implementing just the two expressions the action uses.
  const fanResolveJq = () => vi.fn((expr: string, vals: Record<string, unknown>): Promise<string> => {
    const json = vals.json as { clusters: string; name: string }
    if (expr.includes('.json.name')) { return Promise.resolve(`${json.name}-${json.clusters}`) }
    return Promise.resolve(json.clusters)
  })

  it('expands one write per element, substituting the scalar element for the array field', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.fn(() => Promise.resolve(true))
    const ctx = makeCtx({ confirm, resolveJq: fanResolveJq() })

    await dispatchAction(
      fanAction(),
      { customPayload: { clusters: ['spoke-a', 'spoke-b'], name: 'demo' }, resourcesRefs: refs([postRef]) },
      ctx
    )

    // ONE aggregated confirm for the whole set, then one POST per element in order.
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map((call) => (call as unknown as [string])[0])
    expect(urls[0]).toBe('http://sp/api/x?name=demo-spoke-a&namespace=krateo-system')
    expect(urls[1]).toBe('http://sp/api/x?name=demo-spoke-b&namespace=krateo-system')
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(((call as unknown as [string, { body: string }])[1]).body) as { metadata: { name: string }; spec: { deploy: { targetRef: { name: string } } } })
    expect(bodies[0].metadata.name).toBe('demo-spoke-a')
    expect(bodies[0].spec.deploy.targetRef.name).toBe('spoke-a')
    expect(bodies[1].metadata.name).toBe('demo-spoke-b')
    expect(bodies[1].spec.deploy.targetRef.name).toBe('spoke-b')
    // Full success → the set success toast + the onSuccessNavigateTo redirect.
    expect(ctx.notification.success).toHaveBeenCalled()
    expect(ctx.navigate).toHaveBeenCalledWith('/compositions')
  })

  it('declined set confirm: NOTHING is dispatched and no navigation happens', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx({ confirm: vi.fn(() => Promise.resolve(false)), resolveJq: fanResolveJq() })

    await dispatchAction(
      fanAction(),
      { customPayload: { clusters: ['spoke-a', 'spoke-b'], name: 'demo' }, resourcesRefs: refs([postRef]) },
      ctx
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.navigate).not.toHaveBeenCalled()
  })

  it('an empty fan-out array is a config error: no confirm, no fetch', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.fn(() => Promise.resolve(true))
    const ctx = makeCtx({ confirm, resolveJq: fanResolveJq() })

    await dispatchAction(fanAction(), { customPayload: { clusters: [], name: 'demo' }, resourcesRefs: refs([postRef]) }, ctx)

    expect(confirm).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.notification.error).toHaveBeenCalled()
  })

  it('fanOutPath + onEventNavigateTo is a config error (single-uid event redirect is meaningless for a set)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx({ resolveJq: fanResolveJq() })

    await dispatchAction(
      fanAction({ onEventNavigateTo: { eventReason: 'X', url: '/y' }, onSuccessNavigateTo: undefined }),
      { customPayload: { clusters: ['spoke-a'], name: 'demo' }, resourcesRefs: refs([postRef]) },
      ctx
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.notification.error).toHaveBeenCalled()
  })

  it('stop-on-first-error: a failed op halts the set and no success navigation happens', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse(true, '{}'))
      .mockResolvedValueOnce(fakeResponse(false, '{"message":"boom"}'))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = makeCtx({ resolveJq: fanResolveJq() })

    await dispatchAction(
      fanAction(),
      { customPayload: { clusters: ['spoke-a', 'spoke-b', 'spoke-c'], name: 'demo' }, resourcesRefs: refs([postRef]) },
      ctx
    )

    // Op 3 never fires; the error toast reports the partial state; no redirect.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(ctx.notification.error).toHaveBeenCalled()
    expect(ctx.navigate).not.toHaveBeenCalled()
  })
})
