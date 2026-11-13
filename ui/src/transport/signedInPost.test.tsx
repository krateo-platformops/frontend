// @vitest-environment jsdom
/**
 * THE SIGNED-IN TRANSPORT'S `post` IS THE ANONYMOUS ONE. A Form's `fieldChecks` / `submitPost`
 * send through the transport in scope; inside the signed-in shell that transport holds a token, and
 * these endpoints are not snowplow's. So its `post` must be the same token-less, allow-listed post
 * (transport/allowlistedPost.ts): no Authorization, no cookies, PUBLIC_POST_PATHS only, and the
 * same refusals — while its reads keep their bearer.
 */
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PublicPostRefused } from './allowlistedPost'
import { SignedInTransportProvider } from './signedInTransport'
import { useWidgetTransport, type WidgetTransport } from './widgetTransport'

vi.mock('../utils/getAccessToken', () => ({
  getAccessToken: () => 'SYNTHETIC-TOKEN',
  invalidateAccessTokenCache: vi.fn(),
  onAccessTokenInvalidated: () => () => undefined,
}))
vi.mock('../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { api: { PUBLIC_POST_PATHS: '/request-access/api/v1/' } } }),
}))

const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response('{}', { status: 200 })))

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

const signedIn = (): WidgetTransport => {
  let captured: WidgetTransport | undefined
  const Probe = () => {
    captured = useWidgetTransport()
    return null
  }
  render(<SignedInTransportProvider><Probe /></SignedInTransportProvider>)
  if (!captured) { throw new Error('no transport') }
  return captured
}

describe('the signed-in transport\'s post', () => {
  it('sends JSON to an allowlisted path with no credential, and passes the abort signal', async () => {
    const transport = signedIn()
    const { signal } = new AbortController()
    await transport.post!('/request-access/api/v1/username-checks', { username: 'ada' }, { signal })
    const [[url, init]] = fetchMock.mock.calls
    expect(url).toBe('/request-access/api/v1/username-checks')
    expect(init).toMatchObject({ body: '{"username":"ada"}', credentials: 'omit', method: 'POST', signal })
    expect(JSON.stringify(init)).not.toContain('SYNTHETIC-TOKEN')
    expect(Object.keys(init?.headers as Record<string, string>).map((name) => name.toLowerCase())).not.toContain('authorization')
  })

  it('its reads still carry the bearer (control: the token IS reachable here)', async () => {
    const transport = signedIn()
    await transport.fetch('/call?x=1')
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer SYNTHETIC-TOKEN' } })
  })

  it.each([
    ['an off-list path', '/call?resource=configmaps'],
    ['an absolute URL', 'https://evil.example/request-access/api/v1/x'],
    ['a protocol-relative URL', '//evil.example/request-access/api/v1/x'],
    ['a dot-dot escape', '/request-access/api/v1/../../call'],
    ['a tab-smuggled protocol-relative URL', '/\t/evil.example/request-access/api/v1/x'],
    ['a space inside an allowlisted path', '/request-access/api/v1/a b'],
  ])('refuses %s, and sends nothing', async (_label, path) => {
    const transport = signedIn()
    await expect(transport.post!(path, {})).rejects.toBeInstanceOf(PublicPostRefused)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
