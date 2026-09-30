/**
 * Day-2 grounding: the resolved cluster-object identity (GVR + name/namespace/uid)
 * a widget renders must reach the Autopilot page-context so the copilot can answer
 * "what is the GVR of this resource" / propose a targeted patch against the ACTUAL
 * object rather than a title (W0-5).
 *
 * SCOPE: pure-logic only (like the repo's other Autopilot tests — no RTL / jsdom).
 * We assert:
 *   1. parseGvrFromRefPath splits a snowplow ResourceRef `path` into {group, version,
 *      resource, namespace?, name?} across the named / list, namespaced / cluster, and
 *      core-group forms.
 *   2. summarizeWidget derives `resource` from status.resourcesRefs — a detail widget
 *      yields the single object's gvr+name (+uid), a list widget yields the LIST gvr
 *      with no name, and a payload-only widget yields no resource (no fabricated GVR).
 *   3. The identity passes through the redactor UNCHANGED (gvr/name are non-sensitive)
 *      while a sibling token/secret field is still scrubbed — pinned so a future
 *      redactor change cannot silently drop the grounding.
 */
import { describe, expect, it } from 'vitest'

import { redactAutopilotContext } from './redact'
import type { PageContextEnvelope, WidgetInventoryEntry } from './types'
import { parseGvrFromRefPath, summarizeWidget } from './useAutopilotContext'

/** Wrap raw widget JSON the way the react-query cache holds it: useInfiniteQuery `pages`. */
const cached = (widget: unknown): unknown => ({ pages: [widget] })

describe('parseGvrFromRefPath', () => {
  it('parses a namespaced, named ResourceRef path into a full identity', () => {
    expect(parseGvrFromRefPath('/apis/core.krateo.io/v1alpha1/namespaces/foo/compositions/bar')).toEqual({
      group: 'core.krateo.io',
      name: 'bar',
      namespace: 'foo',
      resource: 'compositions',
      version: 'v1alpha1',
    })
  })

  it('parses a namespaced LIST path (no name) — the compositions-list gvr', () => {
    expect(parseGvrFromRefPath('/apis/core.krateo.io/v1/namespaces/demo/compositions')).toEqual({
      group: 'core.krateo.io',
      name: undefined,
      namespace: 'demo',
      resource: 'compositions',
      version: 'v1',
    })
  })

  it('parses a cluster-scoped path (no namespace)', () => {
    expect(parseGvrFromRefPath('/apis/apiextensions.k8s.io/v1/customresourcedefinitions/widgets')).toEqual({
      group: 'apiextensions.k8s.io',
      name: 'widgets',
      namespace: undefined,
      resource: 'customresourcedefinitions',
      version: 'v1',
    })
  })

  it('parses a core-group path (/api/<version>/…) as an empty group', () => {
    expect(parseGvrFromRefPath('/api/v1/namespaces/kube-system/configmaps/coredns')).toEqual({
      group: '',
      name: 'coredns',
      namespace: 'kube-system',
      resource: 'configmaps',
      version: 'v1',
    })
  })

  it('tolerates a trailing query string / slash', () => {
    expect(parseGvrFromRefPath('/apis/core.krateo.io/v1/namespaces/foo/compositions/bar/?limit=1')).toMatchObject({
      name: 'bar',
      resource: 'compositions',
    })
  })

  it('returns undefined for an unrecognizable path (no fabricated GVR)', () => {
    expect(parseGvrFromRefPath(undefined)).toBeUndefined()
    expect(parseGvrFromRefPath('')).toBeUndefined()
    expect(parseGvrFromRefPath('/healthz')).toBeUndefined()
    expect(parseGvrFromRefPath('/apis/core.krateo.io/v1alpha1')).toBeUndefined()
  })
})

describe('summarizeWidget resolves the backing resource identity', () => {
  it('yields the single-object gvr + name + namespace (+uid) for a detail widget', () => {
    const widget = {
      kind: 'Panel',
      metadata: { name: 'composition-detail-panel' },
      status: {
        resourcesRefs: {
          items: [
            {
              allowed: true,
              id: 'ref-0',
              path: '/apis/core.krateo.io/v1alpha1/namespaces/demo-system/compositions/alb-ingress-prod',
              verb: 'GET',
            },
          ],
        },
        widgetData: { metadata: { uid: 'a1b2c3d4-0000-1111-2222-333344445555' }, title: 'ALB Ingress' },
      },
    }
    const entry = summarizeWidget('/call?resource=panels&name=x', cached(widget), undefined)
    expect(entry.resource).toEqual({
      group: 'core.krateo.io',
      name: 'alb-ingress-prod',
      namespace: 'demo-system',
      resource: 'compositions',
      uid: 'a1b2c3d4-0000-1111-2222-333344445555',
      version: 'v1alpha1',
    })
  })

  it('yields the LIST gvr (no name, no uid) for a list widget', () => {
    const widget = {
      kind: 'Table',
      metadata: { name: 'compositions-list' },
      status: {
        resourcesRefs: {
          items: [
            {
              allowed: true,
              id: 'ref-0',
              path: '/apis/core.krateo.io/v1/namespaces/krateo-system/compositions',
              verb: 'GET',
            },
          ],
        },
        widgetData: { items: [{ name: 'one' }, { name: 'two' }] },
      },
    }
    const entry = summarizeWidget('/call?resource=tables&name=x', cached(widget), undefined)
    expect(entry.resource).toMatchObject({
      group: 'core.krateo.io',
      resource: 'compositions',
      version: 'v1',
    })
    expect(entry.resource?.name).toBeUndefined()
    expect(entry.resource?.uid).toBeUndefined()
  })

  it('prefers the GET ref over a mutating (PATCH/DELETE) ref for the backing object', () => {
    const widget = {
      kind: 'Panel',
      metadata: { name: 'composition-detail-actions' },
      status: {
        resourcesRefs: {
          items: [
            { allowed: true, id: 'del', path: '/apis/core.krateo.io/v1/namespaces/demo/compositions/x', verb: 'DELETE' },
            { allowed: true, id: 'get', path: '/apis/core.krateo.io/v1/namespaces/demo/compositions/x', verb: 'GET' },
          ],
        },
        widgetData: {},
      },
    }
    const entry = summarizeWidget('/call?resource=panels&name=y', cached(widget), undefined)
    expect(entry.resource).toMatchObject({ name: 'x', resource: 'compositions', version: 'v1' })
  })

  it('emits no resource for a widget without resolved resourcesRefs (no fabricated GVR)', () => {
    const widget = { kind: 'Paragraph', metadata: { name: 'static-note' }, status: { widgetData: { text: 'hello' } } }
    const entry = summarizeWidget('/call?resource=paragraphs&name=z', cached(widget), undefined)
    expect(entry.resource).toBeUndefined()
  })
})

describe('resource identity survives the redactor unchanged', () => {
  const entry: WidgetInventoryEntry = {
    endpoint: '/call?resource=panels&name=x',
    kind: 'Panel',
    resource: {
      group: 'core.krateo.io',
      name: 'alb-ingress-prod',
      namespace: 'demo-system',
      resource: 'compositions',
      version: 'v1alpha1',
    },
  }

  it('leaves gvr/name/namespace intact while still scrubbing a sibling secret field', () => {
    const envelope = {
      route: '/compositions/demo-system/alb-ingress-prod',
      // A denylisted sibling key on the same envelope — must be redacted, proving the redactor
      // still runs while leaving the non-sensitive resource identity untouched.
      token: 'super-secret-bearer-value',
      widgets: [entry],
    } as unknown as PageContextEnvelope
    const safe = redactAutopilotContext(envelope)
    expect(safe.widgets[0].resource).toEqual(entry.resource)
    expect((safe as unknown as Record<string, unknown>).token).toBe('[redacted]')
  })
})

describe('summarizeWidget — a Form\'s field inventory', () => {
  const schema = {
    properties: {
      apiKey: { type: 'string', writeOnly: true },
      password: { format: 'password', type: 'string' },
      username: { type: 'string' },
    },
    type: 'object',
  }

  it.each([
    ['schema', { schema }],
    ['stringSchema', { stringSchema: JSON.stringify(schema) }],
  ])('names the fields, never a secret one (via %s) — and never any value', (_via, widgetData) => {
    const widget = { kind: 'Form', metadata: { name: 'f' }, status: { widgetData: { ...widgetData, initialValues: { password: 'seeded' } } } }
    const entry = summarizeWidget('/call?resource=forms&name=f', cached(widget), undefined)
    expect(entry.fields).toEqual(['username'])
    expect(JSON.stringify(entry)).not.toContain('seeded')
  })
})
