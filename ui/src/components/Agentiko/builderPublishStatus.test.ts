import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '../../context/ConfigContext'

import {
  allResolved,
  fetchLocalResourceStatuses,
  localResourceName,
  pendingStatuses,
  readLocalResourceCondition,
  summarizePublishStatus,
  trackPublishStatus,
  type LocalResourceStatus, stoppedWatchingNote } from './builderPublishStatus'
import type { AgentikoMessage } from './types'

describe('localResourceName', () => {
  it('mirrors the composition %03d index (zero-padded)', () => {
    expect(localResourceName('publish-sock-shop', 0)).toBe('publish-sock-shop-000')
    expect(localResourceName('publish-sock-shop', 5)).toBe('publish-sock-shop-005')
    expect(localResourceName('publish-sock-shop', 42)).toBe('publish-sock-shop-042')
  })
})

describe('readLocalResourceCondition', () => {
  it('reads a Synced=True condition as committed', () => {
    expect(readLocalResourceCondition({ status: { conditions: [{ message: 'done', status: 'True', type: 'Synced' }] } }))
      .toEqual({ message: 'done', ok: true })
  })

  it('reads a Synced=False condition as failed and keeps the message (the git error)', () => {
    const obj = { status: { conditions: [{ message: 'observe failed: failed to clone repository: authentication required: invalid credentials', status: 'False', type: 'Synced' }] } }
    expect(readLocalResourceCondition(obj)).toEqual({ message: 'observe failed: failed to clone repository: authentication required: invalid credentials', ok: false })
  })

  it('treats a missing object / missing Synced condition as still pending (null)', () => {
    expect(readLocalResourceCondition(null)).toEqual({ message: 'pending — not created yet', ok: null })
    expect(readLocalResourceCondition({ status: {} })).toEqual({ message: 'pending — not reconciled yet', ok: null })
    expect(readLocalResourceCondition({ status: { conditions: [{ status: 'True', type: 'Ready' }] } })).toEqual({ message: 'pending — not reconciled yet', ok: null })
  })
})

describe('allResolved', () => {
  const mk = (ok: boolean | null): LocalResourceStatus => ({ message: '', name: 'n', ok, path: 'p' })
  it('is true only once every status has committed or failed', () => {
    expect(allResolved([mk(true), mk(false)])).toBe(true)
    expect(allResolved([mk(true), mk(null)])).toBe(false)
    expect(allResolved([])).toBe(false)
  })
})

describe('fetchLocalResourceStatuses', () => {
  const cfg = { api: { SNOWPLOW_API_BASE_URL: 'http://snowplow/' }, params: {} } as Config
  afterEach(() => { vi.unstubAllGlobals() })

  it('GETs each LocalResource by its deterministic name over snowplow /call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: { conditions: [{ status: 'True', type: 'Synced' }] } }),
      ok: true,
    })
    vi.stubGlobal('fetch', fetchMock)
    const statuses = await fetchLocalResourceStatuses(cfg, 'krateo-system', 'publish-sock-shop', ['Chart.yaml', 'values.yaml'])
    expect(statuses.map((status) => status.ok)).toEqual([true, true])
    expect(statuses.map((status) => status.path)).toEqual(['Chart.yaml', 'values.yaml'])
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe('/call')
    expect(url.searchParams.get('resource')).toBe('localresources')
    expect(url.searchParams.get('apiVersion')).toBe('git.krateo.io/v1alpha1')
    expect(url.searchParams.get('name')).toBe('publish-sock-shop-000')
    expect(url.searchParams.get('namespace')).toBe('krateo-system')
  })

  it('maps a 404 (not created yet) to a pending status rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const statuses = await fetchLocalResourceStatuses(cfg, 'krateo-system', 'publish-x', ['a'])
    expect(statuses[0].ok).toBeNull()
  })

  it('returns unavailable statuses (no throw) when no snowplow endpoint is configured', async () => {
    const statuses = await fetchLocalResourceStatuses({ api: {}, params: {} } as Config, 'krateo-system', 'publish-x', ['a', 'b'])
    expect(statuses).toHaveLength(2)
    expect(statuses.every((status) => status.ok === null)).toBe(true)
  })
})

describe('summarizePublishStatus', () => {
  const target = { branch: 'builder/sock-shop', owner: 'krateo-blueprints', repo: 'sock-shop' }

  it('renders the destination header, per-file lines, and counts', () => {
    const md = summarizePublishStatus([
      { message: 'committed', name: 'publish-sock-shop-000', ok: true, path: 'Chart.yaml' },
      { message: 'pending — not created yet', name: 'publish-sock-shop-001', ok: null, path: 'values.yaml' },
    ], target)
    expect(md).toContain('`krateo-blueprints/sock-shop`')
    expect(md).toContain('builder/sock-shop')
    expect(md).toContain('1/2 committed')
    expect(md).toContain('✓ `Chart.yaml`')
    expect(md).toContain('… `values.yaml`')
  })

  it('adds the repo-must-exist hint when a clone/auth error is present', () => {
    const md = summarizePublishStatus([
      { message: 'observe failed: failed to clone repository: authentication required: invalid credentials', name: 'publish-sock-shop-000', ok: false, path: 'Chart.yaml' },
    ], target)
    expect(md).toContain('✗ `Chart.yaml`')
    expect(md).toContain('does not exist yet')
    expect(md).toContain('it does not create it')
  })

  it('omits the hint when every file committed', () => {
    const md = summarizePublishStatus([
      { message: 'committed', name: 'publish-sock-shop-000', ok: true, path: 'Chart.yaml' },
    ], target)
    expect(md).not.toContain('does not exist yet')
  })
})

describe('pendingStatuses', () => {
  it('seeds one all-pending status per held file, index-named', () => {
    const seed = pendingStatuses('publish-x', ['Chart.yaml', 'values.yaml'])
    expect(seed).toEqual([
      { message: 'pending — not created yet', name: 'publish-x-000', ok: null, path: 'Chart.yaml' },
      { message: 'pending — not created yet', name: 'publish-x-001', ok: null, path: 'values.yaml' },
    ])
  })
})

describe('trackPublishStatus', () => {
  const cfg = { api: { SNOWPLOW_API_BASE_URL: 'http://snowplow/' }, params: {} } as Config
  const claim = { namespace: 'krateo-system', paths: ['Chart.yaml'], publishName: 'publish-sock-shop', target: { branch: 'builder/sock-shop', owner: 'krateo-blueprints', repo: 'sock-shop' } }
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('seeds a pending rail message, then updates it with the failure + repo-must-exist hint', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: { conditions: [{ message: 'failed to clone repository: authentication required: invalid credentials', status: 'False', type: 'Synced' }] } }),
      ok: true,
    }))
    let store: AgentikoMessage[] = []
    const setMessages = (updater: (prev: AgentikoMessage[]) => AgentikoMessage[]) => { store = updater(store) }
    trackPublishStatus(cfg, claim, setMessages, () => 'status-1', 10, 3)
    expect(store).toHaveLength(1)
    expect(store[0].text).toContain('0/1 committed')
    expect(store[0].streaming).toBe(true)
    await vi.advanceTimersByTimeAsync(15)
    expect(store).toHaveLength(1)
    expect(store[0].text).toContain('✗ `Chart.yaml`')
    expect(store[0].text).toContain('does not exist yet')
    expect(store[0].streaming).toBe(false)
  })
})

describe('stoppedWatchingNote — the bound must not read as a verdict', () => {
  const st = (name: string, ok: boolean | null, message = '') => ({ message, name, ok, path: name })

  it('says nothing when everything resolved', () => {
    expect(stoppedWatchingNote([st('p-000', true), st('p-001', false)], 30_000)).toBe('')
  })

  it('with pending and NO failures, says stopped watching — never "failed"', () => {
    const note = stoppedWatchingNote([st('p-000', true), st('p-001', null)], 30_000)
    expect(note).toContain('Stopped watching after 30s')
    expect(note).toContain('nothing has failed')
    expect(note.toLowerCase()).not.toContain('publish failed')
  })

  it('with pending AND failures, keeps the failures real', () => {
    const note = stoppedWatchingNote([st('p-000', false), st('p-001', null)], 30_000)
    expect(note).toContain('failures above are real')
    expect(note).toContain('1 file(s) still pending')
  })
})
