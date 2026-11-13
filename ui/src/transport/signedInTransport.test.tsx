// @vitest-environment jsdom
/**
 * SIGNED-IN BEHAVIOUR IS UNCHANGED. Moving the credential off the call sites and onto the transport
 * must not change one byte of what a signed-in widget sends. Pinned here at the two layers:
 *
 *  - the transport itself: `read(url)` calls fetch with exactly `{ headers: { Authorization } }`,
 *    the argument the widget query used to build inline, and a caller's own headers survive;
 *  - the widget query through it: inside the shell's provider a widget read is that exact call and
 *    a 401 raises the session resume; with NO provider (the fail-closed default) the same read
 *    carries no credential and a 401 raises nothing.
 *
 * The token is synthetic and lives in a mocked getter; no storage is read.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useWidgetQuery } from '../hooks/useWidgetQuery'
import { telemetryAuthHeaders } from '../otel/telemetryCredential'

import { SignedInTransportProvider, signedInTransport } from './signedInTransport'

vi.mock('../utils/getAccessToken', () => ({
  getAccessToken: () => 'SYNTHETIC-TOKEN',
  invalidateAccessTokenCache: vi.fn(),
  onAccessTokenInvalidated: () => () => undefined,
}))

const raiseSessionExpired = vi.fn((_cause?: unknown) => Promise.resolve('resumed'))
vi.mock('../utils/sessionResume', () => ({ raiseSessionExpired: (cause: unknown) => raiseSessionExpired(cause) }))

vi.mock('../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { api: { SNOWPLOW_API_BASE_URL: 'http://sp.test', SNOWPLOW_IDENTITY_INJECTION: 'true', WIDGET_LIVE_REFRESH_ENABLED: false } } }),
}))

let answer: { body: unknown; status: number } = { body: {}, status: 200 }
const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
  Promise.resolve(new Response(JSON.stringify(answer.body), { headers: { 'Content-Type': 'application/json' }, status: answer.status })))

beforeEach(() => {
  answer = { body: { kind: 'Flex', metadata: { uid: 'u' }, status: { widgetData: {} } }, status: 200 }
  fetchMock.mockClear()
  raiseSessionExpired.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the signed-in transport', () => {
  it('a plain read is exactly the call the widget query used to make: { headers: { Authorization } }', async () => {
    await signedInTransport.read('http://sp.test/call?x=1')
    expect(fetchMock.mock.calls[0]).toEqual(['http://sp.test/call?x=1', { headers: { Authorization: 'Bearer SYNTHETIC-TOKEN' } }])
  })

  it('a caller\'s own headers and options survive, with the credential added', async () => {
    const { signal } = new AbortController()
    await signedInTransport.read('http://sp.test/jq', { body: '{}', headers: { 'Content-Type': 'application/json' }, method: 'POST', signal })
    expect(fetchMock.mock.calls[0]).toEqual(['http://sp.test/jq', {
      body: '{}',
      headers: { Authorization: 'Bearer SYNTHETIC-TOKEN', 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    }])
  })

  it('a 401 raises the in-place session resume, with the cause snowplow named', () => {
    signedInTransport.onUnauthorized({ details: { causes: [{ reason: 'StepUpRequired' }] } })
    expect(raiseSessionExpired).toHaveBeenCalledTimes(1)
  })

  it('carries the session: the token getter and the SSE client', () => {
    expect(signedInTransport.session?.getAccessToken()).toBe('SYNTHETIC-TOKEN')
    expect(typeof signedInTransport.session?.subscribeSse).toBe('function')
  })

  it('its provider holds the telemetry credential exactly while it is mounted', () => {
    expect(telemetryAuthHeaders()).toEqual({})
    const { unmount } = render(<SignedInTransportProvider><span /></SignedInTransportProvider>)
    expect(telemetryAuthHeaders()).toEqual({ Authorization: 'Bearer SYNTHETIC-TOKEN' })
    unmount()
    expect(telemetryAuthHeaders()).toEqual({})
  })
})

const ENDPOINT = '/call?resource=flexes&apiVersion=widgets.templates.krateo.io/v1beta1&name=page-x&namespace=krateo-system'

const harness = (signedIn: boolean) => ({ children }: { children: ReactNode }) => {
  const tree = (
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
  return signedIn ? <SignedInTransportProvider>{tree}</SignedInTransportProvider> : tree
}

describe('a widget read through the transport in context', () => {
  it('inside the signed-in provider: the exact pre-transport request, and a 401 raises the resume', async () => {
    const { result } = renderHook(() => useWidgetQuery(ENDPOINT), { wrapper: harness(true) })
    await waitFor(() => { expect(result.current.queryResult.isSuccess).toBe(true) })
    expect(fetchMock.mock.calls[0]).toEqual([`http://sp.test${ENDPOINT}`, { headers: { Authorization: 'Bearer SYNTHETIC-TOKEN' } }])

    answer = { body: { message: 'expired' }, status: 401 }
    await result.current.queryResult.refetch()
    expect(raiseSessionExpired).toHaveBeenCalledTimes(1)
  })

  it('with no provider (the default): no credential, and a 401 raises nothing', async () => {
    const { result } = renderHook(() => useWidgetQuery(ENDPOINT), { wrapper: harness(false) })
    await waitFor(() => { expect(result.current.queryResult.isSuccess).toBe(true) })
    const [[, init]] = fetchMock.mock.calls
    expect(init?.credentials).toBe('omit')
    expect(Object.keys(init?.headers ?? {}).map((name) => name.toLowerCase())).not.toContain('authorization')

    answer = { body: { message: 'public serving is off' }, status: 401 }
    await result.current.queryResult.refetch()
    expect(raiseSessionExpired).not.toHaveBeenCalled()
  })
})
