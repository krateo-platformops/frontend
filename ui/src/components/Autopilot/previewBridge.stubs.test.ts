/**
 * The render request carries a draft's stand-ins, and the answer's lookups report comes back
 * normalized — the two ends of previewStubs.ts on the transport seam.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ARCHITECTURE_TEMPLATE_PATH, wrapAsConfigMapTemplate } from '../../pages/BlueprintComposer/architecture'

import { buildBlueprintRenderExtras, callBlueprintRenderRA } from './previewBridge'

afterEach(() => { vi.unstubAllGlobals() })

describe('the render request carries the stand-ins', () => {
  it('for a draft whose descriptor declares an edge', () => {
    const rawTemplates = {
      [ARCHITECTURE_TEMPLATE_PATH]: wrapAsConfigMapTemplate(`apiVersion: architecture.krateo.io/v1alpha1
kind: ChartArchitecture
chart: demo
resources:
  - { id: config, class: native, apiVersion: v1, kind: ConfigMap, template: templates/configmap.yaml, name: demo-config }
  - { id: app, class: native, apiVersion: apps/v1, kind: Deployment, template: templates/app.yaml, name: demo-app, dependsOn: [{ ref: config }] }
`, 'demo'),
      'Chart.yaml': 'apiVersion: v2\nname: demo\nversion: 0.1.0\n',
    }
    const extras = JSON.parse(buildBlueprintRenderExtras({ rawTemplates })) as { lookupStubs?: unknown }
    expect(extras.lookupStubs).toEqual([{ apiVersion: 'v1', kind: 'ConfigMap', object: {} }])
  })

  it('never for a published chart, which has no descriptor to read', () => {
    const extras = JSON.parse(buildBlueprintRenderExtras({ chart: { url: 'oci://x/aws-vpc' } })) as Record<string, unknown>
    expect(extras).not.toHaveProperty('lookupStubs')
  })
})

describe('the lookups report', () => {
  it('is read back, keeping only its well-formed entries', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({
        status: {
          lookups: [
            { apiVersion: 'v1', kind: 'ConfigMap', name: 'demo-config', namespace: 'ns', stubbed: true },
            { kind: 'NoApiVersion' },
            'not an object',
          ],
          objects: [],
        },
      }),
      ok: true,
      status: 200,
    })))
    const result = await callBlueprintRenderRA('http://snowplow.local', 'krateo-system', { chart: { url: 'oci://x/y' } })
    expect(result.lookups).toEqual([{ apiVersion: 'v1', kind: 'ConfigMap', name: 'demo-config', namespace: 'ns', stubbed: true }])
  })
})
