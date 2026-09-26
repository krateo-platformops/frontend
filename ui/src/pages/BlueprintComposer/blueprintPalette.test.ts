// @vitest-environment jsdom
/**
 * The palette read — the portal's `blueprint-palette` RESTAction over snowplow `/call`, as the
 * person. Every failure is a sentence; nothing throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { invalidateAccessTokenCache } from '../../utils/getAccessToken'

import { PALETTE_STATUS } from './__fixtures__/s4a'
import {
  COMPOSITIONS_DENIED,
  CUSTOM_DENIED,
  PALETTE_NOT_CONFIGURED,
  PALETTE_RA_DENIED,
  PALETTE_RA_MISSING,
  readBlueprintPalette,
  shapePaletteStatus,
} from './blueprintPalette'

const respond = (status: number, body: unknown = {}) => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve(body), ok: status >= 200 && status < 300, status })))
}

beforeEach(() => {
  invalidateAccessTokenCache()
  localStorage.setItem('K_user', JSON.stringify({ accessToken: 'tok-cyberjoker' }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  invalidateAccessTokenCache()
})

describe('readBlueprintPalette — the request', () => {
  it('GETs the RESTAction through /call, in the frontend namespace, with the person\'s own bearer — nothing else', async () => {
    respond(200, { status: PALETTE_STATUS })
    await readBlueprintPalette('http://snowplow/', 'krateo-system')
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://snowplow/call?resource=restactions&apiVersion=templates.krateo.io%2Fv1&name=blueprint-palette&namespace=krateo-system')
    expect(init).toEqual({ headers: { Authorization: 'Bearer tok-cyberjoker' } })
  })

  it('not configured: no fetch at all, and one sentence for the pane', async () => {
    respond(200)
    const reads = await Promise.all([readBlueprintPalette(undefined, 'krateo-system'), readBlueprintPalette('http://snowplow', undefined)])
    expect(reads.map((read) => read.unavailable)).toEqual([PALETTE_NOT_CONFIGURED, PALETTE_NOT_CONFIGURED])
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('readBlueprintPalette — a failure of the RESTAction is one sentence for the pane', () => {
  it('404: the portal chart predates the composer', async () => {
    respond(404)
    const read = await readBlueprintPalette('http://snowplow', 'krateo-system')
    expect(read.unavailable).toBe(PALETTE_RA_MISSING)
    expect(read.custom).toEqual({ sentence: PALETTE_RA_MISSING, state: 'error' })
    expect(read.compositions).toEqual({ sentence: PALETTE_RA_MISSING, state: 'error' })
  })

  it('403: the person may not run it', async () => {
    respond(403)
    expect((await readBlueprintPalette('http://snowplow', 'krateo-system')).unavailable).toBe(PALETTE_RA_DENIED)
  })

  it('5xx: says what snowplow answered', async () => {
    respond(503)
    expect((await readBlueprintPalette('http://snowplow', 'krateo-system')).unavailable)
      .toBe('The blueprint-palette RESTAction could not run — snowplow answered 503. Kubernetes native kinds still work.')
  })

  it('unreachable: says so, never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Failed to fetch'))))
    expect((await readBlueprintPalette('http://snowplow', 'krateo-system')).unavailable)
      .toBe('Could not reach snowplow — Failed to fetch. Kubernetes native kinds still work.')
  })

  it('a body that is not a RESTAction: one sentence, not a crash', async () => {
    respond(200, 'nonsense')
    expect((await readBlueprintPalette('http://snowplow', 'krateo-system')).unavailable).toMatch(/shape this build does not understand/)
  })
})

describe('shapePaletteStatus — each class on its own', () => {
  it('the admin shape: kinds and installed blueprints, typed', () => {
    const read = shapePaletteStatus(PALETTE_STATUS)
    expect(read.unavailable).toBeUndefined()
    expect(read.custom.state === 'ok' && read.custom.items.find((kind) => kind.kind === 'Repository')).toEqual({
      conditions: true,
      group: 'github.krateo.io',
      kind: 'Repository',
      owner: 'krateo-system/github-provider-kog-repository',
      plural: 'repositories',
      scope: 'Namespaced',
      statusFields: ['clone_url', 'conditions', 'default_branch', 'full_name', 'html_url', 'id', 'name', 'node_id', 'ssh_url'],
      version: 'v2022-11-28',
    })
    expect(read.compositions.state === 'ok' && read.compositions.items.map((item) => [item.name, item.running])).toEqual([
      ['builder-publish', 23],
      // runningPartial: a zero that may be a zero the person cannot see past — no count, not "0".
      ['mongodb', null],
      ['aws-rds-stack', 3],
    ])
  })

  it('a zero is a zero when every kind was counted — and when the caller asks for it', () => {
    const status = { ...PALETTE_STATUS, runningPartial: false }
    const read = shapePaletteStatus(status)
    expect(read.compositions.state === 'ok' && read.compositions.items[1].running).toBe(0)
    const kept = shapePaletteStatus(PALETTE_STATUS, false)
    expect(kept.compositions.state === 'ok' && kept.compositions.items[1].running).toBe(0)
  })

  it('crds 403: the custom sentence, while the compositions still list', () => {
    const read = shapePaletteStatus({ ...PALETTE_STATUS, custom: { error: { code: 403, message: 'forbidden', reason: 'Forbidden' } } })
    expect(read.custom).toEqual({ sentence: CUSTOM_DENIED, state: 'denied' })
    expect(read.compositions.state).toBe('ok')
  })

  it('compdefs 403 (the cyberjoker shape): the compositions sentence, while the custom kinds still list', () => {
    const read = shapePaletteStatus({ ...PALETTE_STATUS, compositions: { error: { code: 403, message: 'compositiondefinitions is forbidden', reason: 'Forbidden' } } })
    expect(read.compositions).toEqual({ sentence: COMPOSITIONS_DENIED, state: 'denied' })
    expect(read.custom.state).toBe('ok')
  })

  it('any other class error names what the cluster answered', () => {
    const read = shapePaletteStatus({ ...PALETTE_STATUS, custom: { error: { code: 500, message: 'etcd timeout', reason: 'InternalError' } } })
    expect(read.custom).toEqual({ sentence: 'Could not list custom resource kinds — the cluster answered 500 InternalError.', state: 'error' })
    const bare = shapePaletteStatus({ ...PALETTE_STATUS, compositions: { error: { message: 'dial tcp: i/o timeout' } } })
    expect(bare.compositions).toEqual({ sentence: 'Could not list installed blueprints — the cluster answered dial tcp: i/o timeout.', state: 'error' })
  })

  it('an entry missing what a placement needs is dropped, not guessed', () => {
    const read = shapePaletteStatus({ compositions: { items: [{ name: 'x' }] }, custom: { kinds: [{ group: 'g', kind: 'K' }] } })
    expect(read.custom).toEqual({ items: [], state: 'ok' })
    expect(read.compositions).toEqual({ items: [], state: 'ok' })
  })
})
