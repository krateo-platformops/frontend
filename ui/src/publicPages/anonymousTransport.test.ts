// @vitest-environment jsdom
/**
 * The anonymous transport: what it sends (never a credential), and the one write it allows — a
 * same-origin JSON POST to an install-allowlisted path — with everything else refused UNSENT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnonymousCredentialError, anonymousRead, checkPublicPost, createAnonymousTransport, parsePublicPostPaths, PublicPostRefused } from './anonymousTransport'

const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response('{}')))

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  // A token in storage changes nothing: the transport cannot read it.
  localStorage.setItem('K_user', JSON.stringify({ accessToken: 'SYNTHETIC', user: {} }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const headersOf = (call: number) => (fetchMock.mock.calls[call][1]?.headers ?? {}) as Record<string, string>

describe('anonymous reads', () => {
  it('sends the caller\'s headers and no credential, with cookies omitted', async () => {
    await anonymousRead('http://sp/call?x=1', { headers: { 'Content-Type': 'application/json' }, method: 'POST' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [[url, init]] = fetchMock.mock.calls
    expect(url).toBe('http://sp/call?x=1')
    expect(init).toMatchObject({ credentials: 'omit', method: 'POST' })
    expect(headersOf(0)).toEqual({ 'Content-Type': 'application/json' })
  })

  it('throws, sending nothing, when a caller hands it an Authorization header — in any case', () => {
    for (const name of ['Authorization', 'authorization', 'AUTHORIZATION']) {
      expect(() => anonymousRead('http://sp/call', { headers: { [name]: 'Bearer x' } })).toThrow(AnonymousCredentialError)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a caller cannot turn cookies back on', async () => {
    await anonymousRead('http://sp/call', { credentials: 'include' })
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe('omit')
  })

  it('has no session, so nothing that needs one can run on it', () => {
    expect(createAnonymousTransport().session).toBeUndefined()
    expect(createAnonymousTransport().identity).toBe('anonymous')
  })

  it('reports a 401 to whoever the page told it to', () => {
    const onUnauthorized = vi.fn()
    createAnonymousTransport({ onUnauthorized }).onUnauthorized({ code: 401 })
    expect(onUnauthorized).toHaveBeenCalledWith({ code: 401 })
  })
})

describe('the public POST allowlist', () => {
  const post = (path: string, allowlist = ['/request-access/api/v1/']) => createAnonymousTransport({ postAllowlist: allowlist }).post!(path, { name: 'ada' })

  it('POSTs JSON to an allowlisted same-origin path, with no credential', async () => {
    await post('/request-access/api/v1/requests')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [[url, init]] = fetchMock.mock.calls
    expect(url).toBe('/request-access/api/v1/requests')
    expect(init).toMatchObject({ body: '{"name":"ada"}', credentials: 'omit', method: 'POST' })
    expect(headersOf(0)).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' })
    expect(Object.keys(headersOf(0)).map((name) => name.toLowerCase())).not.toContain('authorization')
  })

  it.each([
    ['an off-list path', '/call?resource=configmaps'],
    ['an absolute URL', 'https://evil.example/request-access/api/v1/x'],
    ['an absolute URL to this very origin', `${window.location.origin}/request-access/api/v1/x`],
    ['a protocol-relative URL', '//evil.example/request-access/api/v1/x'],
    ['a backslash trick', '/\\evil.example/request-access/api/v1/x'],
    ['a dot-dot escape', '/request-access/api/v1/../../call'],
    ['an encoded dot-dot escape', '/request-access/api/v1/%2e%2e/%2e%2e/call'],
    ['a look-alike prefix', '/request-access/api/v1evil'],
    ['a relative path', 'request-access/api/v1/x'],
    ['an empty path', ''],
  ])('refuses %s, and sends nothing', async (_label, path) => {
    await expect(post(path)).rejects.toBeInstanceOf(PublicPostRefused)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses everything when the install allowlisted nothing (the default)', async () => {
    await expect(createAnonymousTransport().post!('/request-access/api/v1/x', {})).rejects.toBeInstanceOf(PublicPostRefused)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an entry without a trailing slash is still matched by whole segments', () => {
    const origin = 'https://portal.example'
    expect(checkPublicPost('/request-access/x', ['/request-access'], origin).ok).toBe(true)
    expect(checkPublicPost('/request-access-evil/x', ['/request-access'], origin).ok).toBe(false)
  })
})

describe('PUBLIC_POST_PATHS parsing', () => {
  it('takes the comma-separated string the installer emits, and an array', () => {
    expect(parsePublicPostPaths('/a/, /b/')).toEqual(['/a/', '/b/'])
    expect(parsePublicPostPaths(['/a/', '/b/'])).toEqual(['/a/', '/b/'])
  })

  it('drops anything that is not a same-origin absolute path', () => {
    expect(parsePublicPostPaths('https://evil/, //evil/, relative/, , /ok/')).toEqual(['/ok/'])
    expect(parsePublicPostPaths(undefined)).toEqual([])
    expect(parsePublicPostPaths('')).toEqual([])
    expect(parsePublicPostPaths(42)).toEqual([])
  })
})
