import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pluralCache, resolvePlural } from './Notifications'

vi.mock('../../utils/getAccessToken', () => ({ getAccessToken: () => 'tok' }))

const BASE = 'https://snowplow.test'

beforeEach(() => { pluralCache.clear() })
afterEach(() => { vi.unstubAllGlobals() })

const respondWith = (body: unknown, ok = true) => {
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => body, ok })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('resolvePlural — the notification deep-link plural', () => {
  it('uses the plural the apiserver reports, not a guess', async () => {
    respondWith({ plural: 'repositories' })
    // The bug this locks: `Repository`.toLowerCase() + 's' = "repositorys", a route the apiserver
    // has no handler for, so the notification linked to a 404 for an object that exists.
    expect(await resolvePlural(BASE, 'github.krateo.io/v2022-11-28', 'Repository')).toBe('repositories')
  })

  it('asks /api-info/names with the apiVersion and kind, bearing the token', async () => {
    const fetchMock = respondWith({ plural: 'repositories' })
    await resolvePlural(BASE, 'github.krateo.io/v2022-11-28', 'Repository')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/api-info/names')
    expect(url).toContain(`apiVersion=${encodeURIComponent('github.krateo.io/v2022-11-28')}`)
    expect(url).toContain('kind=Repository')
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer tok')
  })

  it('caches per apiVersion+kind, so a busy drawer asks once per kind', async () => {
    const fetchMock = respondWith({ plural: 'repositories' })
    await resolvePlural(BASE, 'github.krateo.io/v2022-11-28', 'Repository')
    await resolvePlural(BASE, 'github.krateo.io/v2022-11-28', 'Repository')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT cache a failure, so a transient error is retried next click', async () => {
    const fetchMock = respondWith({}, false)
    await resolvePlural(BASE, 'g/v1', 'Repository')
    await resolvePlural(BASE, 'g/v1', 'Repository')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to the old guess when discovery fails — navigation beats no navigation', async () => {
    respondWith({}, false)
    expect(await resolvePlural(BASE, 'g/v1', 'Composition')).toBe('compositions')
  })

  it('falls back when fetch throws outright', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await resolvePlural(BASE, 'g/v1', 'Composition')).toBe('compositions')
  })
})
