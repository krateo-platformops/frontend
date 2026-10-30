/**
 * `runExport` — the outcomes a caller has to tell apart.
 *
 * The three formats fail differently at snowplow's 50,000-row bound, and two of those paths cannot
 * be exercised against the real endpoint until 1.12.62 is tagged. So they are pinned here against
 * the contract snowplow confirmed, and these tests are what will catch it if the contract moved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runExport, TRUNCATED_HEADER } from './tableExportRun'

vi.mock('../../utils/getAccessToken', () => ({ getAccessToken: () => 'tok' }))

let delivered: { filename: string; size: number }[] = []
const deliver = (blob: Blob, filename: string) => { delivered.push({ filename, size: blob.size }) }

const reply = (init: { status?: number; body?: BodyInit; headers?: Record<string, string> }): typeof fetch =>
  () => Promise.resolve(new Response(init.body ?? 'a,b\n1,2\n', { headers: init.headers, status: init.status ?? 200 }))

beforeEach(() => { delivered = [] })
afterEach(() => { vi.restoreAllMocks() })

describe('a file came back', () => {
  it('delivers it and reports NOT truncated when the header is absent', async () => {
    const outcome = await runExport('http://sp/call?format=csv', null, 'csv', 'pods.csv', { deliver, fetch: reply({}) })
    expect(outcome).toEqual({ ok: true, truncated: false })
    expect(delivered).toEqual([{ filename: 'pods.csv', size: 8 }])
  })

  it('delivers it and reports TRUNCATED when snowplow says so — the file is the first 50,000 rows', async () => {
    const outcome = await runExport('http://sp/call?format=csv', null, 'csv', 'pods.csv', {
      deliver, fetch: reply({ headers: { [TRUNCATED_HEADER]: 'true' } }),
    })
    expect(outcome).toEqual({ ok: true, truncated: true })
    // The file is still handed over: it is valid, just partial.
    expect(delivered).toHaveLength(1)
  })

  it('treats any other header value as not truncated, rather than as truthy', async () => {
    const outcome = await runExport('http://sp/c', null, 'json', 'p.json', { deliver, fetch: reply({ headers: { [TRUNCATED_HEADER]: 'false' } }) })
    expect(outcome).toEqual({ ok: true, truncated: false })
  })
})

describe('no file came back', () => {
  it('reports pdf\'s 422 at the row bound with snowplow\'s own message, and delivers nothing', async () => {
    // pdf is never truncated: at 50,000 rows it answers 422 with a JSON body and NO file.
    const outcome = await runExport('http://sp/c', null, 'pdf', 'p.pdf', {
      deliver,
      fetch: reply({ body: JSON.stringify({ message: 'export exceeds the 50000 row bound for pdf' }), status: 422 }),
    })
    expect(outcome).toEqual({ message: 'export exceeds the 50000 row bound for pdf', ok: false })
    expect(delivered).toEqual([])
  })

  it('refuses a zero-byte 200, which would otherwise download as a successful empty export', async () => {
    const outcome = await runExport('http://sp/c', null, 'csv', 'p.csv', { deliver, fetch: reply({ body: '' }) })
    expect(outcome).toEqual({ message: 'the export came back empty', ok: false })
    expect(delivered).toEqual([])
  })

  it('raises the session-resume modal on 401 instead of reporting a failed download', async () => {
    const onSessionExpired = vi.fn()
    const outcome = await runExport('http://sp/c', null, 'csv', 'p.csv', { deliver, fetch: reply({ status: 401 }), onSessionExpired })
    expect(onSessionExpired).toHaveBeenCalledOnce()
    expect(outcome).toHaveProperty('sessionExpired', true)
    expect(delivered).toEqual([])
  })

  it('explains a 431 as a request too long to send, naming the columns', async () => {
    // The gateway refused the URL; the request never reached snowplow, so its body says nothing
    // useful. With extras now in the POST body, the remaining contributor is the query itself —
    // `header` is sent once per column — so the message names columns rather than the filter.
    const outcome = await runExport('http://sp/c', null, 'csv', 'p.csv', { deliver, fetch: reply({ body: '', status: 431 }) })
    expect(outcome.ok).toBe(false)
    expect((outcome as { message: string }).message).toMatch(/too many columns to export in one request/)
    expect((outcome as { message: string }).message).toMatch(/narrower set of columns/)
    expect(delivered).toEqual([])
  })

  it('falls back to the status line when the error body carries no message', async () => {
    const outcome = await runExport('http://sp/c', null, 'csv', 'p.csv', { deliver, fetch: reply({ body: 'not json', status: 400 }) })
    expect(outcome.ok).toBe(false)
    expect(outcome).toHaveProperty('message')
    expect((outcome as { message: string }).message).toContain('400')
  })

  it('reports a transport failure rather than throwing at the caller', async () => {
    const outcome = await runExport('http://sp/c', null, 'csv', 'p.csv', { deliver, fetch: () => Promise.reject(new Error('offline')) })
    expect(outcome).toEqual({ message: 'offline', ok: false })
    expect(delivered).toEqual([])
  })
})

describe('it POSTs, with extras in the body (snowplow POST /export)', () => {
  /** Captures the request so the body and method can be asserted, not just the outcome. */
  const capture = () => {
    const seen: { url: string; body: string; method?: string; headers?: Record<string, string> }[] = []
    // Parameters annotated rather than inferred from `typeof fetch`: under this eslint config the
    // inferred `init` is `any`, so every `init?.body` read is an unsafe-member-access error.
    const fetchMock = ((url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        body: typeof init?.body === 'string' ? init.body : '',
        headers: init?.headers as Record<string, string> | undefined,
        method: init?.method,
        url: url instanceof Request ? url.url : url.toString(),
      })
      return Promise.resolve(new Response('a\n1\n', { status: 200 }))
    }) as typeof fetch
    return { fetchMock, seen }
  }

  it('sends the widget\'s extras in the body, parsed back into an object', async () => {
    // `extras` arrives as the JSON STRING the GET form would have URL-encoded; the body envelope
    // wants the object, so it is parsed back. Sending the string would nest a string in `extras`.
    const { fetchMock, seen } = capture()
    await runExport('http://sp/c?format=csv', '{"q":"nginx"}', 'csv', 'p.csv', { deliver, fetch: fetchMock })
    expect(seen[0].method).toBe('POST')
    expect(JSON.parse(seen[0].body)).toEqual({ extras: { q: 'nginx' } })
    expect(seen[0].url).not.toContain('extras=')
  })

  it('sends an empty extras object when the widget has none', async () => {
    const { fetchMock, seen } = capture()
    await runExport('http://sp/c?format=csv', null, 'csv', 'p.csv', { deliver, fetch: fetchMock })
    expect(JSON.parse(seen[0].body)).toEqual({ extras: {} })
  })

  it('declares JSON and carries the bearer token', async () => {
    const { fetchMock, seen } = capture()
    await runExport('http://sp/c', null, 'csv', 'p.csv', { deliver, fetch: fetchMock })
    expect(seen[0].headers?.['Content-Type']).toBe('application/json')
    expect(seen[0].headers?.Authorization).toBe('Bearer tok')
  })

  it('reports unencodable extras rather than throwing at the caller', async () => {
    // A string that will not parse is a bug upstream of here. It must not surface as a failed
    // export with a JSON parser's message, and it must not take the caller down.
    const { fetchMock, seen } = capture()
    const outcome = await runExport('http://sp/c', '{not json', 'csv', 'p.csv', { deliver, fetch: fetchMock })
    expect(outcome.ok).toBe(false)
    expect((outcome as { message: string }).message).toMatch(/could not be encoded for the export/)
    // Nothing was sent: there is no point asking snowplow to judge a filter we could not build.
    expect(seen).toEqual([])
  })
})
