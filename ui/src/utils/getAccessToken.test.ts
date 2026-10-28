// @vitest-environment jsdom
/**
 * getAccessToken — the module-level token cache and its invalidation listeners.
 *
 * The listener registry exists because a credential change has consequences beyond the
 * next fetch: an SSE stream opened with the old token keeps the old identity on the
 * server for as long as it stays open (frontend#503). Putting that knowledge in one
 * place is the point — a new call site of `invalidateAccessTokenCache` inherits it
 * rather than having to remember it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storeSession = (accessToken: string) => {
  localStorage.setItem('K_user', JSON.stringify({ accessToken }))
}

const freshModule = async () => {
  vi.resetModules()

  return import('./getAccessToken')
}

describe('getAccessToken', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('caches the token and re-reads the store after an invalidation', async () => {
    storeSession('first')
    const { getAccessToken, invalidateAccessTokenCache } = await freshModule()

    expect(getAccessToken()).toBe('first')

    // Without the invalidation the cache would keep answering 'first' — this is the whole
    // reason the in-place resume flow has to call it.
    storeSession('second')
    expect(getAccessToken()).toBe('first')

    invalidateAccessTokenCache()
    expect(getAccessToken()).toBe('second')
  })

  it('throws when there is no stored session', async () => {
    const { getAccessToken } = await freshModule()

    expect(() => getAccessToken()).toThrow('No access token found')
  })

  it('tells every listener the session changed, and stops after unsubscribe', async () => {
    storeSession('first')
    const { invalidateAccessTokenCache, onAccessTokenInvalidated } = await freshModule()

    const calls: string[] = []
    const off = onAccessTokenInvalidated(() => calls.push('a'))
    onAccessTokenInvalidated(() => calls.push('b'))

    invalidateAccessTokenCache()
    expect(calls).toEqual(['a', 'b'])

    off()
    invalidateAccessTokenCache()
    expect(calls).toEqual(['a', 'b', 'b'])
  })

  it('a throwing listener stops neither the other listeners nor the invalidation itself', async () => {
    storeSession('first')
    const { getAccessToken, invalidateAccessTokenCache, onAccessTokenInvalidated } = await freshModule()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(getAccessToken()).toBe('first')

    const reached: string[] = []
    onAccessTokenInvalidated(() => { throw new Error('listener blew up') })
    onAccessTokenInvalidated(() => reached.push('after the thrower'))

    storeSession('second')
    invalidateAccessTokenCache()

    // The listener after the thrower still ran...
    expect(reached).toEqual(['after the thrower'])
    // ...and the cache was still cleared, which is the part that must never be collateral.
    expect(getAccessToken()).toBe('second')
  })
})
