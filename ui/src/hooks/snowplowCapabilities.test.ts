/**
 * snowplowCapabilities — the once-per-session `GET /capabilities` read, failing CLOSED: only a
 * listed `call.provenance` turns the header path on; a 404, another status, a network error or a
 * malformed body all leave the caller on the pre-capability path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readSnowplowCapabilities, resetSnowplowCapabilitiesCache, snowplowReadsCallProvenance } from './snowplowCapabilities'

const json = (status: number, body: unknown): Response =>
  ({ json: () => Promise.resolve(body), ok: status >= 200 && status < 300, status } as unknown as Response)

const ALL = ['call.dryRun', 'call.fieldValidation', 'call.provenance', 'call.raw', 'call.read.inline']

describe('readSnowplowCapabilities', () => {
  beforeEach(() => {
    resetSnowplowCapabilitiesCache()
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads {base}/capabilities with the portal\'s Bearer, and lists the tokens', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, { capabilities: ALL })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(snowplowReadsCallProvenance('http://sp', () => 'tok')).resolves.toBe(true)
    const [[url, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]]
    expect(url).toBe('http://sp/capabilities')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('ONCE per session: concurrent and later callers share one request', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, { capabilities: ALL })))
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([snowplowReadsCallProvenance('http://sp', () => 'tok'), snowplowReadsCallProvenance('http://sp', () => 'tok')])
    await snowplowReadsCallProvenance('http://sp', () => 'tok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a snowplow that lists other tokens but not call.provenance → false', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, { capabilities: ['call.dryRun', 'call.raw'] }))))
    await expect(snowplowReadsCallProvenance('http://sp', () => 'tok')).resolves.toBe(false)
  })

  it('404 (an older snowplow) means no tokens, and is a definitive answer (cached)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(404, { message: 'not found' })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(snowplowReadsCallProvenance('http://sp', () => 'tok')).resolves.toBe(false)
    await expect(snowplowReadsCallProvenance('http://sp', () => 'tok')).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a 500', () => Promise.resolve(json(500, {}))],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a body without the list', () => Promise.resolve(json(200, { tokens: ALL }))],
    ['a non-JSON body (an index.html fallback)', () => Promise.resolve({ json: () => Promise.reject(new SyntaxError('Unexpected token <')), ok: true, status: 200 } as unknown as Response)],
  ])('%s fails CLOSED (false) and is NOT cached: the next write asks again', async (_label, failure) => {
    const fetchMock = vi.fn(failure).mockImplementationOnce(failure)
    vi.stubGlobal('fetch', fetchMock)

    await expect(snowplowReadsCallProvenance('http://sp', () => 'tok')).resolves.toBe(false)
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { capabilities: ALL })))
    await expect(snowplowReadsCallProvenance('http://sp', () => 'tok')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a throwing token getter fails closed too (never rejects)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, { capabilities: ALL }))))
    await expect(readSnowplowCapabilities('http://sp', () => { throw new Error('no token') })).resolves.toEqual(new Set())
  })

  it('per base URL: two snowplows are asked separately', async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(json(200, { capabilities: url.startsWith('http://new') ? ALL : [] })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(snowplowReadsCallProvenance('http://new', () => 'tok')).resolves.toBe(true)
    await expect(snowplowReadsCallProvenance('http://old', () => 'tok')).resolves.toBe(false)
  })
})
