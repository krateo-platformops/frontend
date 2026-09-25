import { describe, expect, it } from 'vitest'

import { createBlueprintGate } from './blueprintGate'
import {
  isPageDraft,
  pageCompositionDefinition,
  pageDisplayName,
  pageDraftFiles,
  pageDraftSlug,
  pageRootSlug,
} from './pageDraft'

const flexRoot = { apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name: 'page-postgres', namespace: 'krateo-system' }, spec: { widgetData: { items: [] } } }
const card = { apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Card', metadata: { name: 'pg-summary', namespace: 'krateo-system' }, spec: { widgetData: { title: 'Postgres' } } }

describe('pageDraftSlug', () => {
  it('is <kind-lower>.<name>.yaml', () => {
    // Chart-relative: a page set publishes as its own Helm chart, and a chart keeps its manifests
    // in templates/. The key IS the path now — there is no routing step left to apply.
    expect(pageDraftSlug('Flex', 'page-postgres')).toBe('templates/flex.page-postgres.yaml')
    expect(pageDraftSlug('Card', 'pg-summary')).toBe('templates/card.pg-summary.yaml')
  })
})

describe('pageDraftFiles', () => {
  it('refuses (null) an empty list, a non-object entry, or a CR missing kind/name', () => {
    expect(pageDraftFiles([])).toBeNull()
    expect(pageDraftFiles(['nope'])).toBeNull()
    expect(pageDraftFiles([{ kind: 'Card' }])).toBeNull()
    expect(pageDraftFiles([{ metadata: { name: 'x' } }])).toBeNull()
    expect(pageDraftFiles([{ kind: '  ', metadata: { name: 'x' } }])).toBeNull()
  })

  describe('emits a CHART, not a bag of manifests', () => {
    const chart = () => pageDraftFiles([flexRoot, card]) as Record<string, string>

    it('ships Chart.yaml and values.schema.json beside the templates', () => {
      // Chart.yaml or there is no chart. values.schema.json or core-provider cannot build the CRD,
      // and the chart publishes, merges, releases, and then wedges the CompositionDefinition at
      // Ready=False — several layers and one merge away from anything that names the cause.
      expect(Object.keys(chart()).sort()).toEqual([
        'Chart.yaml',
        'templates/_tiers.tpl',
        'templates/card.pg-summary.yaml',
        'templates/flex.page-postgres.yaml',
        'values.schema.json',
        'values.yaml',
      ])
    })

    it('leaves the chart version as the placeholder the release workflow stamps', () => {
      // A real version here would mint a chart claiming a version nothing published.
      expect(chart()['Chart.yaml']).toContain('version: CHART_VERSION')
      expect(chart()['Chart.yaml']).toContain('name: postgres')
    })

    it('advertises ONLY the value its templates read', () => {
      // tiers.common is referenced by every template; the portal's schema also offers admin and
      // tenant, and copying those in would put two knobs in the install form that nothing reads.
      const schema = JSON.parse(chart()['values.schema.json']) as { properties: { tiers: { properties: Record<string, unknown> } } }
      expect(Object.keys(schema.properties.tiers.properties)).toEqual(['common'])
    })

    it('states the same defaults in values.yaml as in the schema', () => {
      // Two files describing one fact drift; this is the cheapest place to notice.
      const schema = JSON.parse(chart()['values.schema.json']) as { properties: { tiers: { properties: { common: { default: string } } } } }
      expect(schema.properties.tiers.properties.common.default).toBe('')
      expect(chart()['values.yaml']).toMatch(/^tiers:\n(?:.*\n)?\s+common: ""\n$/)
    })

    it('carries no subschema combinator — the class that cannot become a structural CRD', () => {
      // An `anyOf` in builder-publish's values.schema.json stranded its served CRD a version behind
      // and left the human blueprint-publish path non-functional for two releases.
      expect(chart()['values.schema.json']).not.toMatch(/"(anyOf|oneOf|allOf|not)"/)
    })
  })

  describe('namespace is resolved at INSTALL time, not authoring time', () => {
    const chart = () => pageDraftFiles([flexRoot, card]) as Record<string, string>

    it('templates metadata.namespace through the tier helper', () => {
      // Dumping the authoring namespace would pin every installation of this page set to whichever
      // namespace the author happened to be working in.
      expect(chart()['templates/flex.page-postgres.yaml'])
        .toContain('namespace: \'{{ include "page.tierNamespace" (dict "ctx" . "tier" "common") }}\'')
      expect(chart()['templates/flex.page-postgres.yaml']).not.toContain('namespace: krateo-system')
    })

    it('ships the helper it calls — `portal.tierNamespace` is NOT in scope in another chart', () => {
      // A page set is a separate chart now. Calling the portal's helper renders
      // "template not defined", which fails the install rather than failing quietly — but it fails.
      expect(chart()['templates/_tiers.tpl']).toContain('define "page.tierNamespace"')
      expect(chart()['templates/_tiers.tpl']).toContain('.ctx.Release.Namespace')
    })

    it('moves a SIBLING ref with it — a parent left behind renders an empty, healthy page', () => {
      const parent = {
        apiVersion: 'widgets.templates.krateo.io/v1beta1',
        kind: 'Flex',
        metadata: { name: 'page-postgres', namespace: 'krateo-system' },
        spec: {
          resourcesRefs: { items: [
            { apiVersion: 'widgets.templates.krateo.io/v1beta1', id: 'pg-summary', name: 'pg-summary', namespace: 'krateo-system', resource: 'cards', verb: 'GET' },
            { apiVersion: 'widgets.templates.krateo.io/v1beta1', id: 'fleet', name: 'fleet-elsewhere', namespace: 'other-ns', resource: 'tables', verb: 'GET' },
          ] },
          widgetData: { items: [{ resourceRefId: 'pg-summary' }] },
        },
      }
      const files = pageDraftFiles([parent, card]) as Record<string, string>
      const root = files['templates/flex.page-postgres.yaml']

      // The sibling this chart ships moves to the tier…
      expect(root).toMatch(/name: pg-summary\n\s+namespace: '\{\{ include "page\.tierNamespace"/)
      // …and a widget placed from ELSEWHERE keeps its own namespace: this chart neither creates nor
      // moves it, so retargeting it would point the page at a resource that is not there.
      expect(root).toMatch(/name: fleet-elsewhere\n\s+namespace: other-ns/)
    })

    it('leaves a CR with no refs exactly as it was held', () => {
      expect(chart()['templates/card.pg-summary.yaml']).not.toContain('resourcesRefs')
    })
  })
})

describe('page root + identity', () => {
  it('pageRootSlug extracts <slug> from the flex.page-<slug>.yaml key, else null', () => {
    expect(pageRootSlug({ 'templates/card.x.yaml': '...', 'templates/flex.page-postgres.yaml': '...' })).toBe('postgres')
    expect(pageRootSlug({ 'templates/card.x.yaml': '...', 'templates/table.y.yaml': '...' })).toBeNull()
  })
})

describe('isPageDraft', () => {
  it('reads the kind the writer recorded, not the shape of the file set', () => {
    // It used to be `!('Chart.yaml' in files)` — sound only while a page could never carry a chart.
    // A page that ships as its own chart inverts that test silently, so the fact is carried now.
    expect(isPageDraft({ kind: 'page' })).toBe(true)
    expect(isPageDraft({ kind: 'blueprint' })).toBe(false)
  })

  it('does not change its answer when a page draft gains a Chart.yaml', () => {
    // The whole reason the shape sniff had to go: this is the case that used to flip.
    const held = { bytes: 1, files: { 'Chart.yaml': 'name: my-page', 'templates/flex.page-x.yaml': '…' }, kind: 'page' as const }

    expect(isPageDraft(held)).toBe(true)
  })
})

describe('pageDisplayName', () => {
  it('is the page-root flex slug, stable across recompute', () => {
    const files = pageDraftFiles([card, flexRoot])!
    expect(pageDisplayName(files)).toBe('page:flex.page-postgres')
    // Stable: same files → same identity (record-time == publish-time).
    expect(pageDisplayName(pageDraftFiles([flexRoot, card])!)).toBe('page:flex.page-postgres')
  })

  it('says it does not know, rather than naming whichever file sorted first', () => {
    // It used to fall back to `Object.keys(files)[0]`. Harmless while every key was a widget CR;
    // a bug the moment a page carries a chart, because the first key sorts to `Chart.yaml` and the
    // draft would identify itself as `page:Chart`. The publish gate matches on this string, so an
    // identity naming the wrong file is worse than one that admits it does not know.
    expect(pageDisplayName({ 'templates/card.a.yaml': '...', 'templates/table.b.yaml': '...' })).toBe('page:draft')
  })
})

// The safety invariant: a page publish (the BuilderPublish claim) is DENIED by the SHARED blueprint
// gate unless the SAME page was previewed this thread — identical to the blueprint invariant, so
// FE-P2 does not weaken the mutation-safety boundary.
describe('page publish gate (safety)', () => {
  const pagePublishOps = [
    { gvr: { group: 'composition.krateo.io', resource: 'builderpublishes', version: 'v1-8-21' }, namespace: 'krateo-system', verb: 'POST' as const },
  ]

  it('DENIES a page publish that was never previewed', () => {
    const gate = createBlueprintGate()
    const files = pageDraftFiles([flexRoot, card])!
    expect(gate.evaluate(pagePublishOps, pageDisplayName(files)).allowed).toBe(false)
  })

  it('ALLOWS the page publish only after the SAME page was previewed', () => {
    const gate = createBlueprintGate()
    const files = pageDraftFiles([flexRoot, card])!
    // recordPreview mirrors the provider's previewPage branch (recordPagePreview)
    gate.recordPreview(pageDisplayName(files))
    expect(gate.evaluate(pagePublishOps, pageDisplayName(files)).allowed).toBe(true)
  })

  it('still DENIES after reset (newThread forgets the preview)', () => {
    const gate = createBlueprintGate()
    const files = pageDraftFiles([flexRoot, card])!
    gate.recordPreview(pageDisplayName(files))
    gate.reset()
    expect(gate.evaluate(pagePublishOps, pageDisplayName(files)).allowed).toBe(false)
  })

  it('does not allow a DIFFERENT page than the one previewed', () => {
    const gate = createBlueprintGate()
    // previewed page-postgres, then attempt to publish page-redis
    gate.recordPreview(pageDisplayName(pageDraftFiles([flexRoot])!))
    const otherRoot = { ...flexRoot, metadata: { name: 'page-redis', namespace: 'krateo-system' } }
    const otherName = pageDisplayName(pageDraftFiles([otherRoot])!)
    expect(gate.evaluate(pagePublishOps, otherName).allowed).toBe(false)
  })
})

describe('pageCompositionDefinition — what actually REGISTERS a published page set', () => {
  const cd = () => pageCompositionDefinition('fleet-health', 'acme')

  it('points at the page set\'s OWN chart, under the destination owner', () => {
    // The url is <owner>/charts/<chart name>. Getting either half wrong registers a chart that
    // exists (someone else\'s) or none at all, and the failure surfaces as a wedged
    // CompositionDefinition rather than anything naming the url.
    expect(cd()).toContain('url: oci://ghcr.io/acme/charts/fleet-health')
    expect(cd()).toContain('name: fleet-health')
  })

  it('leaves CHART_VERSION for the release workflow to stamp', () => {
    // Registering a concrete version from the branch pins a chart version that was never published.
    expect(cd()).toContain('version: CHART_VERSION')
  })

  it('tells the reader to apply the RELEASE copy, not this one', () => {
    // The whole hazard of a placeholder in a file people kubectl apply by hand.
    expect(cd()).toMatch(/STAMPED copy from the GitHub release/)
  })

  it('is a CompositionDefinition core-provider will accept', () => {
    expect(cd()).toContain('apiVersion: core.krateo.io/v1alpha1')
    expect(cd()).toContain('kind: CompositionDefinition')
  })
})
