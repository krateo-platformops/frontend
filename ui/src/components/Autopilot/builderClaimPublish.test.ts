import { describe, expect, it } from 'vitest'

import type { Config } from '../../context/ConfigContext'

import { buildClaimPublish } from './builderClaimPublish'
import { BUILDER_PUBLISH_GVR } from './builderPublishClaim'

const cfg = (api: Partial<Config['api']>): Config => ({ api } as Config)
const origin = { prompt: 'publish it', sessionId: 'sess-1' }
const allow = () => ({ allowed: true }) as const
const deny = () => ({ allowed: false, reason: 'denied — preview the chart first' }) as const
const files = [{ content: 'apiVersion: v1\nkind: ConfigMap\n', path: 'chart/templates/card.foo.yaml' }]

describe('buildClaimPublish', () => {
  it('compiles one gated + authorship-stamped claim POST and a deep link when allowed', () => {
    const res = buildClaimPublish({
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
    expect(res.compiled.ops?.[0]).toMatchObject({ gvr: BUILDER_PUBLISH_GVR, verb: 'POST' })
    // authorship stamp landed on the claim envelope
    const payload = res.compiled.ops?.[0].payload as { metadata: { labels: Record<string, string> } }
    expect(payload.metadata.labels['app.kubernetes.io/managed-by']).toBe('krateo')
    // deep link to the target repo's compare page
    expect(res.branch).toBe('builder/foo')
    expect(res.deepLink).toBe('https://github.com/acme/pages/compare/main...builder/foo?expand=1')
  })

  it('denies (no ops, no deep link) when the preview gate refuses', () => {
    const res = buildClaimPublish({
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

  it('the user-confirmed destination overrides the install-config target', () => {
    const res = buildClaimPublish({
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
})
