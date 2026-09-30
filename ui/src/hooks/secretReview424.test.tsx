// @vitest-environment jsdom
/**
 * Security review of #424 (head 8337cb7) — one probe per finding. Each FAILS on 8337cb7 and pins
 * the fix. The /jq resolver is the real one over a mocked fetch, so assertions are about the
 * bytes that would have left the browser.
 */
/* eslint-disable no-template-curly-in-string -- the ${…} jq-override DSL is the subject under test */
import { cleanup, render } from '@testing-library/react'
import type { JSONSchema4 } from 'json-schema'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourcesRefs, WidgetAction } from '../types/Widget'
import { resolveJqExpression } from '../utils/jq-expression'
import { isSecretSchemaNode, omitSecretPaths, secretFieldPaths } from '../utils/secretFields'
import { evaluateLocalExpression, parseLocalExpression, planOverride, SecretExpressionError } from '../utils/secretJq'
import { ReviewSummary } from '../widgets/Form/Form'

import { buildPayload, buildPayloadDetailed, dispatchAction, type ActionContext } from './useHandleActions'

vi.mock('../utils/getAccessToken', () => ({ getAccessToken: () => 'tok' }))

type RestAction = WidgetAction & { type: 'rest' }

// Built at runtime: an obviously fake fixture, never a literal a secret scanner could flag.
const TYPED = ['typed', 'by', 'hand'].join('-')
let requests: Array<{ url: string; body: string }> = []
const realResolveJq = (expression: string, values: Record<string, unknown>) => resolveJqExpression('http://sp/jq', expression, values)
const jqBodies = () => requests.filter((request) => request.url.endsWith('/jq')).map((request) => request.body)
const respondWith = (ok: boolean, body: unknown) => vi.fn((url: string, init?: RequestInit) => {
  requests.push({ body: typeof init?.body === 'string' ? init.body : '', url })
  if (url.endsWith('/jq')) {
    return Promise.resolve({ json: () => Promise.resolve('msg'), ok: true } as unknown as Response)
  }
  return Promise.resolve({ json: () => Promise.resolve(body), ok, status: ok ? 201 : 422, text: () => Promise.resolve(JSON.stringify(body)) } as unknown as Response)
})

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      addEventListener: noop,
      addListener: noop,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: noop,
      removeListener: noop,
    }),
    writable: true,
  })
})
beforeEach(() => {
  requests = []
  vi.stubGlobal('fetch', respondWith(true, {}))
})
afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const makeCtx = (): ActionContext => ({
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
  provenanceEnabled: true,
  registerCleanup: vi.fn(),
  reloadRoutes: vi.fn(),
  resolveJq: realResolveJq,
  setLoading: vi.fn(),
})

const dbRef: ResourcesRefs = { items: [{ allowed: true, id: 'r', path: '/call?resource=databases&namespace=ns1', payload: {}, verb: 'POST' }] }
const dbAction = (over: Partial<RestAction>): RestAction => ({
  headers: [],
  id: 's',
  payload: { apiVersion: 'x/v1', kind: 'Database' },
  payloadToOverride: [
    { name: 'metadata.name', value: 'db1' },
    { name: 'metadata.namespace', value: 'ns1' },
    { name: 'spec.password', value: '${ .json.password }' },
  ],
  resourceRefId: 'r',
  type: 'rest',
  ...over,
})
const nonWriteRequestsWithSecret = () => requests.filter((request) => !request.url.includes('resource=databases') && request.body.includes(TYPED))

describe('F1 — a response echo never reaches /jq', () => {
  it('success template: a non-Secret CR echoing spec.password', async () => {
    vi.stubGlobal('fetch', respondWith(true, { apiVersion: 'x/v1', kind: 'Database', metadata: { name: 'db1', uid: 'u1' }, spec: { password: TYPED } }))
    const ctx = makeCtx()
    await dispatchAction(dbAction({ successMessage: '${ "Created " + .response.metadata.name }' }),
      { customPayload: { password: TYPED }, resourcesRefs: dbRef, secretPaths: [['password']] }, ctx)
    expect(jqBodies()).toHaveLength(1)
    expect(jqBodies()[0]).not.toContain(TYPED)
    // the template still gets what names the object
    expect(jqBodies()[0]).toContain('"name":"db1"')
  })

  it('error template, toast and audit: a 422 Status quoting the invalid value', async () => {
    const status = {
      code: 422,
      details: { causes: [{ message: `Invalid value: "${TYPED}"` }] },
      kind: 'Status',
      message: `Database.x "db1" is invalid: spec.password: Invalid value: "${TYPED}": too short`,
      reason: 'Invalid',
      status: 'Failure',
    }
    vi.stubGlobal('fetch', respondWith(false, status))
    const ctx = makeCtx()
    await dispatchAction(dbAction({ errorMessage: '${ "Failed: " + .response.reason }' }),
      { customPayload: { password: TYPED }, resourcesRefs: dbRef, secretPaths: [['password']] }, ctx)
    await vi.waitFor(() => { expect(requests.some((request) => request.body.includes('"AuditRecord"'))).toBe(true) })
    expect(jqBodies().join('')).not.toContain('Invalid value')
    expect(nonWriteRequestsWithSecret()).toEqual([])
    const toast = (ctx.notification.error as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => JSON.stringify(call)).join('')
    expect(toast).not.toContain(TYPED)
  })

  it('the scalar toast of a failure without an errorMessage template is scrubbed too', async () => {
    vi.stubGlobal('fetch', respondWith(false, { code: 422, kind: 'Status', message: `Invalid value: "${TYPED}"`, reason: 'Invalid' }))
    const ctx = makeCtx()
    await dispatchAction(dbAction({}), { customPayload: { password: TYPED }, resourcesRefs: dbRef, secretPaths: [['password']] }, ctx)
    const toast = JSON.stringify((ctx.notification.error as unknown as ReturnType<typeof vi.fn>).mock.calls)
    expect(toast).toContain('Invalid value')
    expect(toast).not.toContain(TYPED)
  })
})

describe('F2 — a write SET never puts the secret in the audit record or the toast', () => {
  it('ops: failed op message quoting the value', async () => {
    vi.stubGlobal('fetch', respondWith(false, { code: 422, kind: 'Status', message: `Invalid value: "${TYPED}"`, reason: 'Invalid' }))
    const ctx = makeCtx()
    await dispatchAction(dbAction({ ops: [{ payload: { apiVersion: 'x/v1', kind: 'Database' }, payloadToOverride: dbAction({}).payloadToOverride, resourceRefId: 'r' }] }),
      { customPayload: { password: TYPED }, resourcesRefs: dbRef, secretPaths: [['password']] }, ctx)
    await vi.waitFor(() => { expect(requests.some((request) => request.body.includes('"AuditRecord"'))).toBe(true) })
    expect(nonWriteRequestsWithSecret()).toEqual([])
    expect(JSON.stringify((ctx.notification.error as unknown as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(TYPED)
  })
})

describe('F3 — every secret shape is detected, kept out of /jq and masked', () => {
  it('a map of passwords (additionalProperties)', async () => {
    const schema: JSONSchema4 = { properties: { creds: { additionalProperties: { format: 'password', type: 'string' }, type: 'object' } }, type: 'object' }
    const paths = secretFieldPaths(schema)
    expect(paths).toEqual([['creds', '{*}']])
    const values = { creds: { admin: TYPED }, name: 'x' }
    await buildPayload({ headers: [], id: 'a', payloadToOverride: [{ name: 'spec.name', value: '${ .json.name + "!" }' }], resourceRefId: 'r', type: 'rest' }, {}, values, realResolveJq, paths)
    expect(jqBodies()).toHaveLength(1)
    expect(jqBodies()[0]).not.toContain(TYPED)
    const { container } = render(<ReviewSummary schema={schema} values={values} />)
    expect(container.textContent).not.toContain(TYPED)
  })

  it('a nullable string (type: [string, null])', () => {
    expect(isSecretSchemaNode({ format: 'password', type: ['string', 'null'] })).toBe(true)
    expect(isSecretSchemaNode({ type: ['string', 'null'], writeOnly: true })).toBe(true)
    expect(isSecretSchemaNode({ format: 'password', type: ['string', 'integer'] })).toBe(false)
  })

  it('an array of passwords (items: { format: password })', () => {
    const paths = secretFieldPaths({ properties: { tokens: { items: { format: 'password', type: 'string' }, type: 'array' } }, type: 'object' })
    expect(paths).toEqual([['tokens', '*']])
    expect(omitSecretPaths({ keep: 1, tokens: [TYPED, TYPED] }, paths)).toEqual({ keep: 1, tokens: [] })
  })

  it('oneOf / anyOf / allOf are walked', () => {
    const schema = {
      allOf: [{ properties: { rootPw: { format: 'password', type: 'string' } } }],
      properties: {
        auth: { oneOf: [{ properties: { basic: { properties: { pw: { format: 'password', type: 'string' } }, type: 'object' } } }], type: 'object' },
        token: { anyOf: [{ type: 'string', writeOnly: true }, { type: 'null' }] },
      },
      type: 'object',
    } as JSONSchema4
    expect(secretFieldPaths(schema)).toEqual([['auth', 'basic', 'pw'], ['token'], ['rootPw']])
  })
})

describe('F4 — a secret is never silently dropped: evaluated locally or refused', () => {
  const values = { name: 'n', spec: { password: TYPED, user: 'u' }, users: [{ n: 'a', password: TYPED }] }
  const paths = [['spec', 'password'], ['users', '*', 'password']]

  it.each(['${ .json.spec }', '${ .json.users }'])('%s (an ancestor, in the grammar) → local, the whole value', (expression) => {
    const plan = planOverride('x', expression, values, paths)
    expect(plan).toMatchObject({ mode: 'local', touchesSecret: true })
  })

  it.each([
    '${ .json["pass"+"word"] }',
    '${ .json.spec | to_entries }',
    '${ ."json".spec }',
    '${ .json.spec | .["pass" + "word"] }',
    '${ .["json"] | tojson }',
    '${ [..] | length }',
    '${ getpath(["json","spec","password"]) }',
    '${ . | tojson }',
    '${ .json.name as $k | .json[$k] }',
    '${ "\\(.json)" }',
  ])('%s → refused', (expression) => {
    expect(() => planOverride('x', expression, values, paths)).toThrow(SecretExpressionError)
  })

  it('the ancestor is masked, whole, in the confirm', async () => {
    const { payload, secretTargets } = await buildPayloadDetailed(
      { headers: [], id: 'a', payloadToOverride: [{ name: 'spec', value: '${ .json.spec }' }], resourceRefId: 'r', type: 'rest' },
      {}, values, realResolveJq, paths,
    )
    expect(payload.spec).toEqual(values.spec)
    expect(secretTargets).toEqual(['spec'])
    expect(requests).toHaveLength(0)
  })

  it('the portal user-create overrides still pass', () => {
    const form = { __secret_key__: 'password', __secret_value__: TYPED, avatarURL: '', displayName: 'A', group: 'none — x', password: TYPED, username: 'alice' }
    const secret = [['password'], ['__secret_value__']]
    for (const expression of [
      '${ .json.username + "-password" }',
      '${ {"krateo.io/managed-by":"portal-users"} }',
      '${ { username: .json.username, password: .json.password } }',
      '${ {(.json.__secret_key__): .json.__secret_value__} }',
      '${ if ((.json.avatarURL // "") | length) > 0 then .json.avatarURL else "https://www.gravatar.com/avatar/?d=mp" end }',
      '${ { name: (.json.username + "-password"), namespace: "krateo-system", key: "password" } }',
      '${ ((.json.group // "none") | split(" ")[0]) as $g | if $g == "none" or $g == "" then null else [$g] end }',
    ]) {
      expect(() => planOverride('x', expression, form, secret), expression).not.toThrow()
    }
  })
})

describe('F5 — local lookups read own properties only', () => {
  it('constructor / __proto__ are null, as in jq', () => {
    const parsed = parseLocalExpression('${ { a: .json.password, b: .json.constructor, c: .json.__proto__ } }')
    expect(parsed).not.toBeNull()
    expect(evaluateLocalExpression(parsed!, { password: TYPED })).toEqual({ a: TYPED, b: null, c: null })
  })
})

describe('F6 — a secret never becomes identity or a redirect', () => {
  it('a secret in metadata.name is refused', async () => {
    await expect(buildPayload(
      { headers: [], id: 'a', payloadToOverride: [{ name: 'metadata.name', value: '${ .json.password }' }], resourceRefId: 'r', type: 'rest' },
      {}, { password: TYPED }, realResolveJq, [['password']],
    )).rejects.toThrow(/metadata/)
  })

  it('onSuccessNavigateTo ${field} interpolation (ops) never sees a secret', async () => {
    vi.stubGlobal('fetch', respondWith(true, { kind: 'Database', metadata: { name: 'db1' } }))
    const ctx = makeCtx()
    await dispatchAction(dbAction({ onSuccessNavigateTo: '/db/${password}', ops: [{ payload: { apiVersion: 'x/v1', kind: 'Database' }, payloadToOverride: dbAction({}).payloadToOverride, resourceRefId: 'r' }] }),
      { customPayload: { password: TYPED }, resourcesRefs: dbRef, secretPaths: [['password']] }, ctx)
    expect(JSON.stringify((ctx.navigate as unknown as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(TYPED)
  })
})

describe('no secrets → /jq bodies byte-identical to before', () => {
  it('identical', async () => {
    const values = { a: 1, b: { c: 'x' } }
    await buildPayload({ headers: [], id: 'a', payloadToOverride: [{ name: 'x', value: '${ .json.a }' }, { name: 'y', value: '${ .json }' }], resourceRefId: 'r', type: 'rest' }, {}, values, realResolveJq)
    expect(jqBodies()).toEqual([JSON.stringify({ data: { json: values }, query: ' .json.a ' }), JSON.stringify({ data: { json: values }, query: ' .json ' })])
  })
})
