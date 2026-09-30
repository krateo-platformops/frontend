/**
 * A form's secret field (`format: password` / `writeOnly`) never reaches snowplow's /jq.
 *
 * The /jq resolver used here is the REAL one (utils/jq-expression.ts `resolveJqExpression`) over a
 * mocked `fetch`, so every assertion is about the bytes that would have left the browser.
 */
/* eslint-disable no-template-curly-in-string -- the ${…} jq-override DSL is the subject under test */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourcesRefs, WidgetAction } from '../types/Widget'
import { resolveJqExpression } from '../utils/jq-expression'

import { buildPayload, dispatchAction, type ActionContext } from './useHandleActions'

vi.mock('../utils/getAccessToken', () => ({ getAccessToken: () => 'tok' }))

type RestAction = WidgetAction & { type: 'rest' }

// Built at runtime: an obviously fake fixture, never a literal a secret scanner could flag.
const TYPED = ['typed', 'by', 'hand'].join('-')
const FORM = { avatarURL: '', displayName: 'Alice', group: 'none — portal access only', password: TYPED, username: 'alice' }
const SECRET_PATHS = [['password']]

/** The portal's settings-user-create form, verbatim: a basic-auth Secret, then the User. */
const SECRET_OP: RestAction = {
  headers: [],
  id: 'submit',
  payload: { apiVersion: 'v1', kind: 'Secret', type: 'kubernetes.io/basic-auth' },
  payloadToOverride: [
    { name: 'metadata.name', value: '${ .json.username + "-password" }' },
    { name: 'metadata.namespace', value: 'krateo-system' },
    { name: 'metadata.labels', value: '${ {"krateo.io/managed-by":"portal-users"} }' },
    { name: 'stringData', value: '${ { username: .json.username, password: .json.password } }' },
  ],
  resourceRefId: 'create-secret',
  type: 'rest',
}
const USER_OP: RestAction = {
  headers: [],
  id: 'submit',
  payload: { apiVersion: 'basic.authn.krateo.io/v1alpha1', kind: 'User' },
  payloadToOverride: [
    { name: 'metadata.name', value: '${ .json.username }' },
    { name: 'spec.displayName', value: '${ .json.displayName }' },
    { name: 'spec.avatarURL', value: '${ if ((.json.avatarURL // "") | length) > 0 then .json.avatarURL else "https://www.gravatar.com/avatar/?d=mp" end }' },
    { name: 'spec.passwordRef', value: '${ { name: (.json.username + "-password"), namespace: "krateo-system", key: "password" } }' },
    { name: 'spec.groups', value: '${ ((.json.group // "none") | split(" ")[0]) as $g | if $g == "none" or $g == "" then null else [$g] end }' },
  ],
  resourceRefId: 'create-user',
  type: 'rest',
}

/** A fake snowplow: records every request body, answers /jq with a canned value. */
let requests: Array<{ url: string; body: string }> = []
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  requests.push({ body: (typeof init?.body === 'string' ? init.body : ''), url })
  const answer = url.endsWith('/jq') ? '"jq-result"' : '{}'
  return Promise.resolve({ json: () => Promise.resolve(JSON.parse(answer)), ok: true, text: () => Promise.resolve(answer) } as unknown as Response)
})
const realResolveJq = (expression: string, values: Record<string, unknown>) => resolveJqExpression('http://sp/jq', expression, values)
const jqBodies = () => requests.filter((request) => request.url.endsWith('/jq')).map((request) => request.body)

beforeEach(() => {
  requests = []
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('buildPayload — secret fields never reach /jq', () => {
  it('the user-create Secret: stringData resolved locally, the rest via /jq without the password', async () => {
    const payload = await buildPayload(SECRET_OP, {}, FORM, realResolveJq, SECRET_PATHS)

    expect(payload.stringData).toEqual({ password: TYPED, username: 'alice' })
    expect(payload.metadata).toMatchObject({ name: 'jq-result', namespace: 'krateo-system' })
    // two overrides went to /jq (name, labels); the stringData one did not
    expect(jqBodies()).toHaveLength(2)
    for (const body of jqBodies()) {
      expect(body).not.toContain(TYPED)
      expect((JSON.parse(body) as { data: { json: unknown } }).data.json).toEqual({ avatarURL: '', displayName: 'Alice', group: 'none — portal access only', username: 'alice' })
    }
  })

  it('the User: plain paths resolve locally, the other three go to /jq — none carries the password', async () => {
    await buildPayload(USER_OP, {}, FORM, realResolveJq, SECRET_PATHS)
    expect(jqBodies()).toHaveLength(3)
    expect(jqBodies().join('\n')).not.toContain(TYPED)
  })

  it('refuses an unresolvable secret expression BEFORE any request is made', async () => {
    const action: RestAction = {
      ...SECRET_OP,
      payloadToOverride: [
        { name: 'metadata.name', value: '${ .json.username }' },
        { name: 'data.password', value: '${ .json.password | @base64 }' },
      ],
    }
    await expect(buildPayload(action, {}, FORM, realResolveJq, SECRET_PATHS)).rejects.toThrow(/"password"/)
    expect(requests).toHaveLength(0)
  })

  it('a form with no secret fields is unchanged: all values go to /jq as before', async () => {
    await buildPayload(SECRET_OP, {}, FORM, realResolveJq)
    expect(jqBodies()).toHaveLength(3)
    for (const body of jqBodies()) {
      expect((JSON.parse(body) as { data: { json: unknown } }).data).toEqual({ json: FORM })
    }
  })
})

const makeCtx = (resolveJq: ActionContext['resolveJq']): ActionContext => ({
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
  resolveJq,
  setLoading: vi.fn(),
})
const refs = (items: ResourcesRefs['items']): ResourcesRefs => ({ items })
const secretRef = { allowed: true, id: 'create-secret', path: '/call?resource=secrets', payload: {}, verb: 'POST' as const }

describe('dispatchAction — a Secret never reaches a success/error template', () => {
  const respondWith = (ok: boolean, body: unknown) => vi.fn((url: string, init?: RequestInit) => {
    requests.push({ body: (typeof init?.body === 'string' ? init.body : ''), url })
    if (url.endsWith('/jq')) {
      return Promise.resolve({ json: () => Promise.resolve('msg'), ok: true } as unknown as Response)
    }
    return Promise.resolve({ ok, text: () => Promise.resolve(JSON.stringify(body)) } as unknown as Response)
  })

  it('success: the response Secret loses data/stringData, the request body loses the secret-derived values', async () => {
    // The apiserver echoes the created Secret — with its data, base64'd.
    const echoed = { data: { password: btoa(TYPED), username: btoa('alice') }, kind: 'Secret', metadata: { name: 'alice-password', namespace: 'krateo-system', uid: 'u1' } }
    vi.stubGlobal('fetch', respondWith(true, echoed))
    const ctx = makeCtx(realResolveJq)

    await dispatchAction(
      { ...SECRET_OP, onSuccessNavigateTo: '${ "/users/" + .response.metadata.name }', successMessage: '${ "created " + .json.metadata.name }' },
      { customPayload: FORM, resourcesRefs: refs([secretRef]), secretPaths: SECRET_PATHS },
      ctx,
    )

    // the write itself carries the password — that is the one place it must go
    const write = requests.find((request) => request.url.includes('/call'))
    expect(write?.body).toContain(TYPED)
    // …and the confirm the human approved it through did not show it
    const radius = (ctx.confirm as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown
    expect(JSON.stringify(radius)).not.toContain(TYPED)
    expect(JSON.stringify(radius)).toContain('"password":"••••••"')

    const templateBodies = jqBodies().map((body) => JSON.parse(body) as { query: string; data: Record<string, unknown> })
      .filter((body) => 'response' in body.data)
    expect(templateBodies).toHaveLength(2)
    for (const body of templateBodies) {
      const text = JSON.stringify(body)
      expect(text).not.toContain(TYPED)
      expect(text).not.toContain(btoa(TYPED))
      expect(body.data.response).toEqual({ kind: 'Secret', metadata: echoed.metadata })
      expect(body.data.json).not.toHaveProperty('stringData')
    }
    expect(ctx.notification.error).not.toHaveBeenCalled()
  })

  it('error: the error template sees no Secret material either', async () => {
    vi.stubGlobal('fetch', respondWith(false, { code: 409, kind: 'Status', message: 'exists', reason: 'AlreadyExists', status: 'Failure' }))
    const ctx = makeCtx(realResolveJq)

    await dispatchAction(
      { ...SECRET_OP, errorMessage: '${ .response.message }' },
      { customPayload: FORM, resourcesRefs: refs([secretRef]), secretPaths: SECRET_PATHS },
      ctx,
    )
    const errorBody = jqBodies().find((body) => body.includes('.response.message'))
    expect(errorBody).toBeDefined()
    expect(errorBody).not.toContain(TYPED)
  })

  it('a refused override dispatches nothing and says which field', async () => {
    vi.stubGlobal('fetch', respondWith(true, {}))
    const ctx = makeCtx(realResolveJq)
    await dispatchAction(
      { ...SECRET_OP, payloadToOverride: [{ name: 'stringData', value: '${ { password: (.json.password | ascii_downcase) } }' }] },
      { customPayload: FORM, resourcesRefs: refs([secretRef]), secretPaths: SECRET_PATHS },
      ctx,
    )
    expect(requests).toHaveLength(0)
    expect(ctx.confirm).not.toHaveBeenCalled()
    const arg = (ctx.notification.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { description: string; message: string }
    expect(arg.message).toMatch(/secret field/i)
    expect(arg.description).toContain('"password"')
    expect(arg.description).not.toContain(TYPED)
  })

  it('ops (the real user-create shape): no /jq body carries the password; the Secret write does', async () => {
    vi.stubGlobal('fetch', respondWith(true, { kind: 'Secret', metadata: { name: 'x' } }))
    const ctx = makeCtx(realResolveJq)
    const userRef = { allowed: true, id: 'create-user', path: '/call?resource=users', payload: {}, verb: 'POST' as const }
    await dispatchAction(
      { ...SECRET_OP,
        ops: [
          { payload: SECRET_OP.payload, payloadToOverride: SECRET_OP.payloadToOverride, resourceRefId: 'create-secret' },
          { payload: USER_OP.payload, payloadToOverride: USER_OP.payloadToOverride, resourceRefId: 'create-user' },
        ] },
      { customPayload: FORM, resourcesRefs: refs([secretRef, userRef]), secretPaths: SECRET_PATHS },
      ctx,
    )
    expect(jqBodies().length).toBeGreaterThan(0)
    expect(jqBodies().join('\n')).not.toContain(TYPED)
    // the aggregated set confirm masks it too
    const radius = (ctx.confirm as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown
    expect(JSON.stringify(radius)).not.toContain(TYPED)
    expect(requests.filter((request) => request.url.includes('resource=secrets')).map((request) => request.body).join('')).toContain(TYPED)
  })
})
