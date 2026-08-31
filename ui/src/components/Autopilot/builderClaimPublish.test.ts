import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '../../context/ConfigContext'

import { buildClaimPublish } from './builderClaimPublish'
import { BUILDER_PUBLISH_GVR_DENIAL } from './builderPublishGvr'

// config carries the snowplow base + namespace the GVR resolver reads.
const cfg = (api: Partial<Config['api']>): Config =>
  ({ api: { SNOWPLOW_API_BASE_URL: 'http://snowplow', ...api }, params: { FRONTEND_NAMESPACE: 'krateo-system' } } as Config)
const origin = { prompt: 'publish it', sessionId: 'sess-1' }
const allow = () => ({ allowed: true }) as const
const deny = () => ({ allowed: false, reason: 'denied — preview the chart first' }) as const
const files = [{ content: 'apiVersion: v1\nkind: ConfigMap\n', path: 'chart/templates/card.foo.yaml' }]

// The builder-publish CompositionDefinition the resolver reads: served version drives the live GVR.
const COMPDEF = {
  status: { managed: { group: 'composition.krateo.io', versionInfo: [{ served: true, version: 'v1-7-17' }, { served: false, version: 'vacuum' }] }, resource: 'builderpublishes' },
}
const okFetch = (body: unknown) => vi.fn().mockResolvedValue({ json: () => Promise.resolve(body), ok: true })

describe('buildClaimPublish', () => {
  beforeEach(() => { vi.stubGlobal('fetch', okFetch(COMPDEF)) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('compiles one gated + authorship-stamped claim POST at the RESOLVED GVR + a deep link when allowed', async () => {
    const res = await buildClaimPublish({
      builder: 'page',
      config: cfg({ AUTOPILOT_PAGE_BUILDER_REPO: 'acme/pages' }),
      dest: null,
      files,
      gate: allow,
      namespace: 'krateo-system',
      origin,
      slug: 'foo',
    })
    expect(res.compiled.denial).toBeNull()
    expect(res.compiled.ops).toHaveLength(1)
    // GVR is the live composition group + served version, NOT a hardcoded apps.krateo.io/v1alpha1.
    expect(res.compiled.ops?.[0]).toMatchObject({ gvr: { group: 'composition.krateo.io', resource: 'builderpublishes', version: 'v1-7-17' }, verb: 'POST' })
    // authorship stamp + matching apiVersion landed on the claim envelope
    const payload = res.compiled.ops?.[0].payload as { apiVersion: string; metadata: { labels: Record<string, string> } }
    expect(payload.apiVersion).toBe('composition.krateo.io/v1-7-17')
    expect(payload.metadata.labels['app.kubernetes.io/managed-by']).toBe('krateo')
    // deep link to the target repo's compare page
    expect(res.branch).toBe('builder/foo')
    expect(res.deepLink).toBe('https://github.com/acme/pages/compare/main...builder/foo?expand=1')
  })

  it('denies (no ops, no deep link) when the preview gate refuses', async () => {
    const res = await buildClaimPublish({
      builder: 'blueprint',
      config: cfg({}),
      dest: null,
      files,
      gate: deny,
      namespace: 'krateo-system',
      origin,
      slug: 'foo',
    })
    expect(res.compiled.denial).toBe('denied — preview the chart first')
    expect(res.compiled.ops).toBeNull()
    expect(res.deepLink).toBeNull()
  })

  it('the user-confirmed destination overrides the install-config target', async () => {
    const res = await buildClaimPublish({
      builder: 'controller',
      config: cfg({ AUTOPILOT_KOG_BUILDER_REPO: 'krateo-platformops/oas' }),
      dest: { owner: 'customer-org', repo: 'their-oas' },
      files,
      gate: allow,
      namespace: 'krateo-system',
      origin,
      slug: 'githubrepo',
    })
    expect(res.deepLink).toContain('https://github.com/customer-org/their-oas/compare/')
  })

  it('DENIES with an actionable message (never POSTs a guessed GVR) when the composition is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const res = await buildClaimPublish({
      builder: 'page',
      config: cfg({}),
      dest: null,
      files,
      gate: allow,
      namespace: 'krateo-system',
      origin,
      slug: 'foo',
    })
    expect(res.compiled.denial).toBe(BUILDER_PUBLISH_GVR_DENIAL)
    expect(res.compiled.ops).toBeNull()
    expect(res.deepLink).toBeNull()
  })
})
