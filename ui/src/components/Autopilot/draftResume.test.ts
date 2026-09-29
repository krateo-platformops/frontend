/**
 * Resume's read side. What these pin:
 *   - only a record name draftRecordName could have made is read — anything else is never a request;
 *   - the read is a `/call` GET of that ConfigMap in the sandbox, and every way it fails (not
 *     configured, 404, 403, another status, a body that is not a record, no network) is a sentence;
 *   - the restored banner says Undo starts here, says "preview again" only when the hash did not
 *     match, and mentions the thread only when it was actually re-linked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DRAFT_RECORD_KEY, type DraftRecordBody } from './draftRecord'
import {
  isDraftRecordName,
  readDraftRecordByName,
  restoredBannerCopy,
  RESUME_NOT_CONFIGURED,
  resumeRecordNameFrom,
  savedWhen,
  wrongComposerMessage,
} from './draftResume'

const body: DraftRecordBody = {
  files: { 'Chart.yaml': 'apiVersion: v2\nname: catalog-service\nversion: 0.1.0\n' },
  kind: 'blueprint',
  name: 'catalog-service',
  state: 'open',
  updatedAt: '2026-09-29T12:04:00Z',
  version: 1,
}

const configMap = (record: unknown) => ({ apiVersion: 'v1', data: { [DRAFT_RECORD_KEY]: JSON.stringify(record) }, kind: 'ConfigMap', metadata: { name: 'draft-blueprint-admin-catalog-service' } })

const answer = (status: number, json: unknown = {}) => vi.fn(() => Promise.resolve({ json: () => Promise.resolve(json), ok: status >= 200 && status < 300, status }))

afterEach(() => { vi.unstubAllGlobals() })

describe('record names', () => {
  it('accepts a DNS-1123 name that starts draft- and fits 63 characters', () => {
    expect(isDraftRecordName('draft-blueprint-admin-catalog-service')).toBe(true)
    expect(isDraftRecordName('draft-page-diego-braga-fleet')).toBe(true)
  })

  it('refuses anything else — another sandbox object, a crafted value, an over-long name', () => {
    for (const name of ['page-fleet', 'bp-preview-x-1234', 'draft-', 'draft-Fleet', 'draft-a/../b', 'draft-a-', `draft-${'a'.repeat(60)}`, '', null, 42]) {
      expect(isDraftRecordName(name)).toBe(false)
    }
  })

  it('reads ?resume= from a search string, and ignores an invalid one', () => {
    expect(resumeRecordNameFrom('?resume=draft-page-admin-fleet')).toBe('draft-page-admin-fleet')
    expect(resumeRecordNameFrom('?resume=page-fleet')).toBeNull()
    expect(resumeRecordNameFrom('?other=1')).toBeNull()
  })
})

describe('readDraftRecordByName', () => {
  it('GETs the ConfigMap by name in the sandbox through /call, and returns the record', async () => {
    const fetchMock = answer(200, configMap(body))
    vi.stubGlobal('fetch', fetchMock)
    const read = await readDraftRecordByName('https://snowplow.test/', 'krateo-preview', 'draft-blueprint-admin-catalog-service')
    expect(read).toEqual({ ok: true, record: body })
    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0])
    expect(url.pathname).toBe('/call')
    expect(Object.fromEntries(url.searchParams)).toEqual({ apiVersion: 'v1', name: 'draft-blueprint-admin-catalog-service', namespace: 'krateo-preview', resource: 'configmaps' })
  })

  it('says why on a 404, a 403 and any other status', async () => {
    vi.stubGlobal('fetch', answer(404))
    expect(await readDraftRecordByName('https://s', 'ns', 'draft-page-a-b')).toEqual({ message: expect.stringContaining('is not in your drafts any more') as string, ok: false })
    vi.stubGlobal('fetch', answer(403))
    expect(await readDraftRecordByName('https://s', 'ns', 'draft-page-a-b')).toEqual({ message: expect.stringContaining('not allowed to read') as string, ok: false })
    vi.stubGlobal('fetch', answer(500))
    expect(await readDraftRecordByName('https://s', 'ns', 'draft-page-a-b')).toEqual({ message: expect.stringContaining('answered 500') as string, ok: false })
  })

  it('says a damaged record cannot be restored, rather than handing it on', async () => {
    vi.stubGlobal('fetch', answer(200, { data: { [DRAFT_RECORD_KEY]: '{not json' } }))
    expect(await readDraftRecordByName('https://s', 'ns', 'draft-page-a-b')).toEqual({ message: expect.stringContaining('cannot be restored') as string, ok: false })
    vi.stubGlobal('fetch', answer(200, configMap({ ...body, version: 2 })))
    expect((await readDraftRecordByName('https://s', 'ns', 'draft-page-a-b')).ok).toBe(false)
  })

  it('never throws — no network and no sandbox are sentences too, and an invalid name is never fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    expect(await readDraftRecordByName('https://s', 'ns', 'draft-page-a-b')).toEqual({ message: expect.stringContaining('offline') as string, ok: false })
    expect(await readDraftRecordByName(undefined, 'ns', 'draft-page-a-b')).toEqual({ message: RESUME_NOT_CONFIGURED, ok: false })
    const fetchMock = answer(200)
    vi.stubGlobal('fetch', fetchMock)
    expect((await readDraftRecordByName('https://s', 'ns', 'page-x')).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('what the composer says', () => {
  const now = new Date(2026, 8, 29, 15, 0)

  it('dates the last save relative to today', () => {
    expect(savedWhen(new Date(2026, 8, 29, 12, 4).toISOString(), now)).toBe('today at 12:04')
    expect(savedWhen(new Date(2026, 8, 28, 9, 5).toISOString(), now)).toBe('yesterday at 09:05')
    expect(savedWhen('garbage', now)).toBe('at an unknown time')
  })

  it('the restored banner (screen 3): Undo starts here; preview again only on a hash mismatch; the thread only when re-linked', () => {
    const updatedAt = new Date(2026, 8, 29, 12, 4).toISOString()
    const stale = restoredBannerCopy({ everPreviewed: true, kind: 'blueprint', previewed: false, relinked: true, updatedAt }, now)
    expect(stale.title).toBe('Restored from your drafts — last saved today at 12:04.')
    expect(stale.body).toBe('The chart is exactly as you left it, and Undo starts here. It changed after its last Preview, so preview it again before publishing. Autopilot\'s thread is re-linked.')
    const ready = restoredBannerCopy({ everPreviewed: true, kind: 'page', previewed: true, relinked: false, updatedAt }, now)
    expect(ready.body).toBe('The page is exactly as you left it, and Undo starts here.')
    expect(restoredBannerCopy({ everPreviewed: false, kind: 'page', previewed: false, relinked: false, updatedAt }, now).body)
      .toContain('It has not been previewed yet')
  })

  it('a record opened in the other composer says where it belongs', () => {
    expect(wrongComposerMessage({ kind: 'page', name: 'fleet' })).toContain('Portal Builder')
    expect(wrongComposerMessage({ kind: 'blueprint', name: 'x' })).toContain('Blueprint Builder')
  })
})
