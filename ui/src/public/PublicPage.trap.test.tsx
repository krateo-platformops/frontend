// @vitest-environment jsdom
/**
 * THE TRAP: a public page, opened in a browser that still holds a session token, must send that
 * token NOWHERE.
 *
 * Why a trap rather than a unit test: the property is "no request carries Authorization", and the
 * way it breaks is a path nobody thought of — a widget's side fetch, a stream, an upload, the span
 * exporter. So this renders the REAL app at a public address, with a synthetic token in storage,
 * real widgets (a Flex holding a Table, a Form, a Button, an Upload and a streaming List), and
 * records every request the page makes through every channel a browser has — fetch,
 * XMLHttpRequest, EventSource, and the OTLP exporter's header function — then clicks the Button,
 * submits the Form and picks a file for the Upload.
 *
 * The same render proves the rest of the contract: the page renders outside the signed-in shell
 * (no INIT layout is ever fetched, no redirect to /login), the declared fragment keys reach the
 * widgets through the request BODY and never a URL, and the address bar loses them while keeping
 * an anchor.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { telemetryAuthHeaders } from '../otel/telemetryCredential'
import { invalidateAccessTokenCache } from '../utils/getAccessToken'

/**
 * Under vitest, `antd/es/app/useApp` (what the widgets import) and the `antd` App the app mounts
 * resolve to different module instances, so the hook sees an empty default context — the same
 * reason the Button tests mock it. Captured instead of rendered: what matters is WHICH notice the
 * page gave, and that it gave one without a request.
 */
const notices: string[] = []
vi.mock('antd/es/app/useApp', () => {
  const record = (arg: { message: string }) => { notices.push(arg.message) }
  return {
    default: () => ({
      message: { destroy: () => undefined, error: record, info: record, loading: record, success: record, warning: record },
      modal: { confirm: () => undefined },
      notification: { destroy: () => undefined, error: record, info: record, open: record, success: record, warning: record },
    }),
  }
})

const SNOWPLOW = 'http://snowplow.test'
const EVENTS = 'http://events.test'
const TOKEN = 'SYNTHETIC-TOKEN-never-leaves'
const INIT = '/call?resource=layouts&apiVersion=widgets.templates.krateo.io/v1beta1&name=app-shell&namespace=krateo-system'

const config = {
  api: {
    AUTHN_API_BASE_URL: 'http://authn.test',
    EVENTS_API_BASE_URL: EVENTS,
    EVENTS_PUSH_API_BASE_URL: EVENTS,
    INIT,
    PUBLIC_POST_PATHS: '/request-access/api/v1/',
    SNOWPLOW_API_BASE_URL: SNOWPLOW,
  },
  params: { DELAY_SAVE_NOTIFICATION: '10000', FRONTEND_NAMESPACE: 'krateo-system' },
}

const endpoint = (resource: string, name: string) =>
  `/call?resource=${resource}&apiVersion=widgets.templates.krateo.io/v1beta1&name=${name}&namespace=krateo-system`

const ref = (id: string, path: string, verb = 'GET') => ({ allowed: true, id, path, payload: {}, verb })

const widget = (kind: string, name: string, widgetData: Record<string, unknown>, refs: unknown[] = [], annotations?: Record<string, string>) => ({
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  kind,
  metadata: { annotations, name, namespace: 'krateo-system', uid: `uid-${name}` },
  spec: { widgetData },
  status: { resourcesRefs: { items: refs }, widgetData },
})

/** The page: a root Flex declaring `s` and `t`, holding a Table, a Form, a Button, an Upload and a streaming List. */
const fixtures: Record<string, unknown> = {
  'demo-button': widget('Button', 'demo-button', {
    actions: { rest: [{ id: 'write', payload: {}, resourceRefId: 'write-target', type: 'rest' }] },
    clickActionId: 'write',
    label: 'Make a change',
  }, [ref('write-target', '/call?resource=configmaps&apiVersion=v1&name=target&namespace=krateo-system', 'POST')]),
  'demo-form': widget('Form', 'demo-form', {
    actions: { rest: [{ headers: ['Content-Type: application/json'], id: 'submit', payload: {}, resourceRefId: 'form-target', type: 'rest' }] },
    buttonConfig: { primary: { label: 'Send request' } },
    schema: { properties: { note: { title: 'Note', type: 'string' } }, type: 'object' },
    submitActionId: 'submit',
  }, [ref('form-target', '/call?resource=configmaps&apiVersion=v1&name=form-target&namespace=krateo-system', 'POST')]),
  'demo-list': widget('Listy', 'demo-list', { dataSource: [], sseEndpoint: '/notifications', sseTopic: 'krateo' }),
  'demo-table': widget('Table', 'demo-table', {
    columns: [{ title: 'Name', valueKey: 'name' }],
    dataSource: [[{ kind: 'jsonSchemaType', stringValue: 'alpha-row', type: 'string', valueKey: 'name' }]],
  }),
  'demo-upload': widget('Upload', 'demo-upload', { label: 'Upload a file', resourceRefId: 'upload-target' }, [
    ref('upload-target', '/call?resource=configmaps&apiVersion=v1&name=upload&namespace=krateo-system', 'POST'),
  ]),
  'page-demo': widget('Flex', 'page-demo', {
    allowedResources: ['tables', 'forms', 'buttons', 'uploads', 'listies'],
    items: [{ resourceRefId: 'table' }, { resourceRefId: 'form' }, { resourceRefId: 'button' }, { resourceRefId: 'upload' }, { resourceRefId: 'list' }],
  }, [
    ref('table', endpoint('tables', 'demo-table')),
    ref('form', endpoint('forms', 'demo-form')),
    ref('button', endpoint('buttons', 'demo-button')),
    ref('upload', endpoint('uploads', 'demo-upload')),
    ref('list', endpoint('listies', 'demo-list')),
  ], { 'krateo.io/fragment-keys': 's,t' }),
}

interface Recorded { body?: string; channel: 'fetch' | 'xhr' | 'eventsource'; headers: Record<string, string>; method: string; url: string }
let recorded: Recorded[] = []
/** Per-widget status overrides, keyed by object name. */
let statusFor: Record<string, number> = {}
/** Per-widget error answered IN THE BODY of a 200 (a k8s Status), keyed by object name. */
let bodyStatusFor: Record<string, number> = {}

const lowerCased = (headers: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (headers instanceof Headers) {
    headers.forEach((value, name) => { out[name.toLowerCase()] = value })
  } else if (headers && typeof headers === 'object') {
    for (const [name, value] of Object.entries(headers as Record<string, string>)) { out[name.toLowerCase()] = String(value) }
  }
  return out
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status })

const fakeFetch = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
  let url: string
  if (typeof input === 'string') {
    url = input
  } else if (input instanceof URL) {
    url = input.toString()
  } else {
    ({ url } = input)
  }
  recorded.push({ body: typeof init.body === 'string' ? init.body : undefined, channel: 'fetch', headers: lowerCased(init.headers), method: (init.method ?? 'GET').toUpperCase(), url })
  if (url.startsWith('/config/')) { return Promise.resolve(json(config)) }
  if (url.startsWith(SNOWPLOW)) {
    const name = new URL(url).searchParams.get('name') ?? ''
    const status = statusFor[name]
    if (status) { return Promise.resolve(json({ code: status, kind: 'Status', message: `answered ${status}`, status: 'Failure' }, status)) }
    const inBody = bodyStatusFor[name]
    if (inBody) { return Promise.resolve(json({ code: inBody, kind: 'Status', message: `answered ${inBody} in the body`, status: 'Failure' })) }
    const body = fixtures[name]
    return Promise.resolve(body ? json(body) : json({ message: 'not found' }, 404))
  }
  return Promise.resolve(json({}, 404))
})

// Saved and restored as property DESCRIPTORS: the prototype methods are swapped for recorders below.
const XHR_METHODS = ['open', 'setRequestHeader', 'send'] as const
const realXhr = Object.fromEntries(XHR_METHODS.map((name) => [name, Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, name)]))

// The XHR recorders swapped onto the prototype in beforeEach. `function`, for the XHR as `this`.
type RecordingXhr = XMLHttpRequest & { __rec?: Recorded }
function recordOpen(this: RecordingXhr, method: string, url: string | URL) {
  this.__rec = { channel: 'xhr', headers: {}, method, url: String(url) }
  recorded.push(this.__rec)
}
function recordHeader(this: RecordingXhr, name: string, value: string) {
  if (this.__rec) { this.__rec.headers[name.toLowerCase()] = value }
}
function neverSend() { /* never sent */ }

// The whole app, imported once: every widget module loads with it, which is slow on a busy machine.
let App: React.ComponentType
beforeAll(async () => {
  ({ default: App } = await import('../App'))
}, 300_000)

const open = async (address: string) => {
  window.history.replaceState(null, '', address)
  render(<App />)
  await Promise.resolve()
}

const requestsTo = (name: string) => recorded.filter(({ url }) => url.includes(`name=${name}`))
const snowplowRequests = () => recorded.filter(({ url }) => url.startsWith(SNOWPLOW))

beforeEach(() => {
  recorded = []
  statusFor = {}
  bodyStatusFor = {}
  notices.length = 0
  // jsdom has no IntersectionObserver; the List's scroll pager needs one to mount.
  // jsdom has no matchMedia or ResizeObserver; the Table asks both.
  vi.stubGlobal('matchMedia', (query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }))
  vi.stubGlobal('ResizeObserver', class { disconnect() { /* none */ } observe() { /* none */ } unobserve() { /* none */ } })
  vi.stubGlobal('IntersectionObserver', class { disconnect() { /* none */ } observe() { /* none */ } takeRecords() { return [] } unobserve() { /* none */ } })
  // A SYNTHETIC session in jsdom's own (fake) storage: what an earlier sign-in would have left.
  localStorage.setItem('K_user', JSON.stringify({ accessToken: TOKEN, user: { displayName: 'Ada', username: 'ada' } }))
  invalidateAccessTokenCache()
  vi.stubGlobal('fetch', fakeFetch)
  // Every EventSource is recorded and none connects. (The app's own SSE client streams over fetch,
  // which is recorded above; this catches anything that would open a native one.)
  vi.stubGlobal('EventSource', class {
    constructor(url: string | URL) { recorded.push({ channel: 'eventsource', headers: {}, method: 'GET', url: String(url) }) }
    addEventListener() { /* none */ }
    close() { /* none */ }
    removeEventListener() { /* none */ }
  })
  // Every XHR is recorded and none leaves: the Upload widget is the XHR user.
  Object.defineProperty(XMLHttpRequest.prototype, 'open', { configurable: true, value: recordOpen })
  Object.defineProperty(XMLHttpRequest.prototype, 'setRequestHeader', { configurable: true, value: recordHeader })
  Object.defineProperty(XMLHttpRequest.prototype, 'send', { configurable: true, value: neverSend })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  for (const name of XHR_METHODS) { Object.defineProperty(XMLHttpRequest.prototype, name, realXhr[name]!) }
  localStorage.clear()
  invalidateAccessTokenCache()
  window.history.replaceState(null, '', '/')
})

describe('a public page in a browser that holds a session token', () => {
  it('renders the page anonymously: no request on any channel carries Authorization or the token, including after a write is attempted', async () => {
    await open('/public/demo#s=S1&t=T1&anchor')

    await screen.findByRole('button', { name: /make a change/i })
    await screen.findByText(/upload a file/i)
    await screen.findByText('alpha-row')
    await screen.findByRole('button', { name: /send request/i })

    const noCredential = () => {
      expect(recorded.length).toBeGreaterThan(0)
      for (const request of recorded) {
        expect(request.headers.authorization, `${request.method} ${request.url}`).toBeUndefined()
        expect(JSON.stringify(request)).not.toContain(TOKEN)
        // Nor the identity the stored session names: the page is the one anyone sees.
        expect(decodeURIComponent(JSON.stringify(request)), `${request.method} ${request.url}`).not.toMatch(/"(?:username|displayName)"/)
      }
    }
    // Every read the page made to render.
    noCredential()
    // The span exporter's header function, asked now as it would be for the next batch: nothing.
    expect(telemetryAuthHeaders()).toEqual({})

    // The writes: a Button's `rest` action and an upload. Both are refused unsent.
    const before = recorded.length
    fireEvent.click(screen.getByRole('button', { name: /make a change/i }))
    const input = document.querySelector('input[type="file"]')
    expect(input).not.toBeNull()
    await act(async () => {
      fireEvent.change(input!, { target: { files: [new File(['x'], 'x.txt', { type: 'text/plain' })] } })
      await new Promise((resolve) => { setTimeout(resolve, 50) })
    })
    fireEvent.click(screen.getByRole('button', { name: /send request/i }))
    await waitFor(() => { expect(notices.filter((notice) => notice === 'Sign in to do this')).toHaveLength(3) })
    expect(recorded.slice(before)).toEqual([])
    noCredential()
    expect(recorded.some(({ channel }) => channel === 'eventsource')).toBe(false)
    expect(telemetryAuthHeaders()).toEqual({})
  })

  it('never renders the signed-in shell: no INIT layout read, no events stream, no redirect to /login', async () => {
    await open('/public/demo')
    await screen.findByRole('button', { name: /make a change/i })

    // Every widget rendered: the List too, without its stream.
    await waitFor(() => { expect(requestsTo('demo-list')).toHaveLength(1) })
    expect(screen.queryAllByTestId('widget-error')).toEqual([])
    expect(recorded.some(({ url }) => url.includes('name=app-shell'))).toBe(false)
    // The List declares an SSE stream; with no session there is no stream to open.
    expect(recorded.some(({ url }) => url.startsWith(EVENTS))).toBe(false)
    expect(window.location.pathname).toBe('/public/demo')
  })

  it('hands the declared fragment keys to the widgets in the request BODY, never in any URL, and clears them from the address bar', async () => {
    await open('/public/demo#s=S1&t=T1&u=U1&anchor')
    await screen.findByRole('button', { name: /make a change/i })

    // The root is read before its declaration is known: a plain GET with neither value.
    const [root] = requestsTo('page-demo')
    expect(root.method).toBe('GET')
    expect(new URL(root.url).pathname).toBe('/call')

    // A child reads through POST /call/read with s and t in the body — and not u, which the page
    // never declared.
    const [button] = requestsTo('demo-button')
    expect(button.method).toBe('POST')
    expect(new URL(button.url).pathname).toBe('/call/read')
    const { extras } = JSON.parse(button.body ?? '{}') as { extras: Record<string, unknown> }
    expect(extras.s).toBe('S1')
    expect(extras.t).toBe('T1')
    expect(extras.u).toBeUndefined()

    for (const request of recorded) {
      for (const secret of ['S1', 'T1']) {
        expect(request.url, `${request.method} ${request.url}`).not.toContain(secret)
      }
    }

    // Declared keys gone; what the page does not read stays, byte for byte.
    await waitFor(() => { expect(window.location.hash).toBe('#u=U1&anchor') })
    expect(window.location.pathname).toBe('/public/demo')
  })
})

describe('what an anonymous read answered decides what the page shows', () => {
  it('401 on the root: "Public pages aren\'t enabled", with a plain Sign in link — no shell, no redirect', async () => {
    statusFor['page-demo'] = 401
    await open('/public/demo')

    expect(await screen.findByText("Public pages aren't enabled on this installation")).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
    expect(window.location.pathname).toBe('/public/demo')
    expect(recorded.some(({ url }) => url.includes('name=app-shell'))).toBe(false)
  })

  it('401 on a CHILD is the installation\'s answer too: the whole page says so', async () => {
    statusFor['demo-button'] = 401
    await open('/public/demo')

    expect(await screen.findByText("Public pages aren't enabled on this installation")).toBeTruthy()
  })

  it('a 401 snowplow answers IN THE BODY of a 200 is the same answer: no session resume, no logout, no redirect', async () => {
    bodyStatusFor['demo-button'] = 401
    await open('/public/demo')

    expect(await screen.findByText("Public pages aren't enabled on this installation")).toBeTruthy()
    // The session resume, with no resume surface mounted, falls through to a logout that clears
    // the stored session and leaves for /login. None of that happened.
    expect(window.location.pathname).toBe('/public/demo')
    expect(localStorage.getItem('K_user')).toContain(TOKEN)
    expect(screen.queryByText(/session/i)).toBeNull()
  })

  it('403 on the root: "This page isn\'t public"', async () => {
    statusFor['page-demo'] = 403
    await open('/public/demo')

    expect(await screen.findByText("This page isn't public")).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
    expect(screen.queryByTestId('widget-forbidden')).toBeNull()
  })

  it('403 on a CHILD: that child shows its own forbidden state, in place, and its siblings render', async () => {
    statusFor['demo-button'] = 403
    await open('/public/demo')

    expect(await screen.findByTestId('widget-forbidden')).toBeTruthy()
    expect(await screen.findByText(/upload a file/i)).toBeTruthy()
    expect(screen.queryByText("This page isn't public")).toBeNull()
  })

  it('a failed root clears the whole fragment: the values can never be read, so they do not linger', async () => {
    statusFor['page-demo'] = 403
    await open('/public/demo#s=S1&anchor')

    await screen.findByText("This page isn't public")
    await waitFor(() => { expect(window.location.hash).toBe('') })
  })

  it('an address that cannot name a page is not shared, and nothing is asked of snowplow', async () => {
    await open('/public/Not_A_Slug')

    expect(await screen.findByText("This page isn't public")).toBeTruthy()
    expect(snowplowRequests()).toEqual([])
  })

  it('/public/:namespace/:slug reads page-<slug> in that namespace', async () => {
    await open('/public/team-a/demo')

    await waitFor(() => { expect(snowplowRequests().length).toBeGreaterThan(0) })
    const url = new URL(snowplowRequests()[0].url)
    expect(url.searchParams.get('name')).toBe('page-demo')
    expect(url.searchParams.get('namespace')).toBe('team-a')
  })
})
