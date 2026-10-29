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
    const outcome = await runExport('http://sp/call?format=csv', 'csv', 'pods.csv', { deliver, fetch: reply({}) })
    expect(outcome).toEqual({ ok: true, truncated: false })
    expect(delivered).toEqual([{ filename: 'pods.csv', size: 8 }])
  })

  it('delivers it and reports TRUNCATED when snowplow says so — the file is the first 50,000 rows', async () => {
    const outcome = await runExport('http://sp/call?format=csv', 'csv', 'pods.csv', {
      deliver, fetch: reply({ headers: { [TRUNCATED_HEADER]: 'true' } }),
    })
    expect(outcome).toEqual({ ok: true, truncated: true })
    // The file is still handed over: it is valid, just partial.
    expect(delivered).toHaveLength(1)
  })

  it('treats any other header value as not truncated, rather than as truthy', async () => {
    const outcome = await runExport('http://sp/c', 'json', 'p.json', { deliver, fetch: reply({ headers: { [TRUNCATED_HEADER]: 'false' } }) })
    expect(outcome).toEqual({ ok: true, truncated: false })
  })
})

describe('no file came back', () => {
  it('reports pdf\'s 422 at the row bound with snowplow\'s own message, and delivers nothing', async () => {
    // pdf is never truncated: at 50,000 rows it answers 422 with a JSON body and NO file.
    const outcome = await runExport('http://sp/c', 'pdf', 'p.pdf', {
      deliver,
      fetch: reply({ body: JSON.stringify({ message: 'export exceeds the 50000 row bound for pdf' }), status: 422 }),
    })
    expect(outcome).toEqual({ message: 'export exceeds the 50000 row bound for pdf', ok: false })
    expect(delivered).toEqual([])
  })

  it('refuses a zero-byte 200, which would otherwise download as a successful empty export', async () => {
    const outcome = await runExport('http://sp/c', 'csv', 'p.csv', { deliver, fetch: reply({ body: '' }) })
    expect(outcome).toEqual({ message: 'the export came back empty', ok: false })
    expect(delivered).toEqual([])
  })

  it('raises the session-resume modal on 401 instead of reporting a failed download', async () => {
    const onSessionExpired = vi.fn()
    const outcome = await runExport('http://sp/c', 'csv', 'p.csv', { deliver, fetch: reply({ status: 401 }), onSessionExpired })
    expect(onSessionExpired).toHaveBeenCalledOnce()
    expect(outcome).toHaveProperty('sessionExpired', true)
    expect(delivered).toEqual([])
  })

  it('falls back to the status line when the error body carries no message', async () => {
    const outcome = await runExport('http://sp/c', 'csv', 'p.csv', { deliver, fetch: reply({ body: 'not json', status: 400 }) })
    expect(outcome.ok).toBe(false)
    expect(outcome).toHaveProperty('message')
    expect((outcome as { message: string }).message).toContain('400')
  })

  it('reports a transport failure rather than throwing at the caller', async () => {
    const outcome = await runExport('http://sp/c', 'csv', 'p.csv', { deliver, fetch: () => Promise.reject(new Error('offline')) })
    expect(outcome).toEqual({ message: 'offline', ok: false })
    expect(delivered).toEqual([])
  })
})
