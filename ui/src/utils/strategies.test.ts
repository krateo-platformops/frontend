/**
 * fetchStrategies must turn every way `/strategies` can fail into a StrategiesError that says which
 * way, because the classification — wait, or tell an administrator — depends on it. It used to be
 * `fetch(url).then(r => r.json())`: a gateway's 503 was never noticed, and a 200 that was not a list
 * became the method list and broke the first `.find`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchStrategies, StrategiesError, strategiesFailureFrom } from './strategies'

const failureOf = async (response: () => Promise<Response>) => {
  vi.stubGlobal('fetch', vi.fn(response))
  const error: unknown = await fetchStrategies('http://authn.test/strategies').catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(StrategiesError)
  return strategiesFailureFrom(error)
}

afterEach(() => { vi.unstubAllGlobals() })

describe('fetchStrategies', () => {
  it('returns the list on a 200 list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('[{"kind":"oidc","name":"x","path":"/oidc/login"}]'))))
    await expect(fetchStrategies('http://authn.test/strategies')).resolves.toHaveLength(1)
  })

  it('a rejected fetch is unreachable', async () => {
    expect(await failureOf(() => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ kind: 'unreachable' })
  })

  it('a non-2xx is reported with its status — even when its body is JSON', async () => {
    expect(await failureOf(() => Promise.resolve(new Response('[]', { status: 503 })))).toEqual({ kind: 'status', status: 503 })
    expect(await failureOf(() => Promise.resolve(new Response('nope', { status: 404 })))).toEqual({ kind: 'status', status: 404 })
  })

  it('a 200 that is not a list, or not JSON, is unusable', async () => {
    expect(await failureOf(() => Promise.resolve(new Response('{"kind":"Status"}')))).toEqual({ kind: 'unusable' })
    expect(await failureOf(() => Promise.resolve(new Response('<html></html>')))).toEqual({ kind: 'unusable' })
  })

  it('an error it did not raise has no failure to report', () => {
    expect(strategiesFailureFrom(new Error('other'))).toBeNull()
  })
})
