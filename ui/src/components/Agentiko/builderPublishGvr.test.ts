import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '../../context/ConfigContext'

import { gvrFromCompositionDefinition, resolveBuilderPublishGvr } from './builderPublishGvr'

describe('gvrFromCompositionDefinition', () => {
  it('extracts group / resource / SERVED version from a reconciled CompositionDefinition status', () => {
    const compdef = {
      status: {
        managed: { group: 'composition.krateo.io', versionInfo: [{ served: false, version: 'vacuum' }, { served: true, version: 'v1-7-17' }] },
        resource: 'builderpublishes',
      },
    }
    expect(gvrFromCompositionDefinition(compdef)).toEqual({
      apiVersion: 'composition.krateo.io/v1-7-17',
      gvr: { group: 'composition.krateo.io', resource: 'builderpublishes', version: 'v1-7-17' },
    })
  })

  it('picks the served version even when a newer chart re-derives it (drift-proof)', () => {
    const compdef = { status: { managed: { group: 'composition.krateo.io', versionInfo: [{ served: true, version: 'v2-0-0' }] }, resource: 'builderpublishes' } }
    expect(gvrFromCompositionDefinition(compdef)?.apiVersion).toBe('composition.krateo.io/v2-0-0')
  })

  it('returns null when no version is served yet (composition not reconciled)', () => {
    expect(gvrFromCompositionDefinition({ status: { managed: { versionInfo: [{ served: false, version: 'v1-7-17' }] } } })).toBeNull()
    expect(gvrFromCompositionDefinition({ status: {} })).toBeNull()
    expect(gvrFromCompositionDefinition(null)).toBeNull()
  })
})

describe('resolveBuilderPublishGvr', () => {
  const cfg = { api: { SNOWPLOW_API_BASE_URL: 'http://snowplow/' }, params: { FRONTEND_NAMESPACE: 'krateo-system' } } as Config
  afterEach(() => { vi.unstubAllGlobals() })

  it('GETs the builder-publish CompositionDefinition over snowplow /call and returns the live GVR', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: { managed: { group: 'composition.krateo.io', versionInfo: [{ served: true, version: 'v1-7-17' }] }, resource: 'builderpublishes' } }),
      ok: true,
    })
    vi.stubGlobal('fetch', fetchMock)
    const resolved = await resolveBuilderPublishGvr(cfg)
    expect(resolved?.gvr.version).toBe('v1-7-17')
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe('/call')
    expect(url.searchParams.get('resource')).toBe('compositiondefinitions')
    expect(url.searchParams.get('apiVersion')).toBe('core.krateo.io/v1alpha1')
    expect(url.searchParams.get('name')).toBe('builder-publish')
    expect(url.searchParams.get('namespace')).toBe('krateo-system')
  })

  it('returns null (→ caller denies) on a non-OK response, a throw, or missing config', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    expect(await resolveBuilderPublishGvr(cfg)).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    expect(await resolveBuilderPublishGvr(cfg)).toBeNull()
    expect(await resolveBuilderPublishGvr({ api: {}, params: {} } as Config)).toBeNull()
  })
})
