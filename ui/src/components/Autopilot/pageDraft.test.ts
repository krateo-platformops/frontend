import { describe, expect, it } from 'vitest'

import { createBlueprintGate } from './blueprintGate'
import {
  isPageDraft,
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

// The safety invariant: a page publish (RepoContent/GitRef/PullRequest ops) is DENIED by the
// SHARED blueprint gate unless the SAME page was previewed this thread — identical to the
// blueprint invariant, so FE-P2 does not weaken the mutation-safety boundary.
describe('page publish gate (safety)', () => {
  const pagePublishOps = [
    { gvr: { group: 'github.krateo.io', resource: 'gitrefs', version: 'v1alpha1' }, namespace: 'krateo-system', verb: 'POST' as const },
    { gvr: { group: 'github.krateo.io', resource: 'repocontents', version: 'v1alpha1' }, namespace: 'krateo-system', verb: 'POST' as const },
    { gvr: { group: 'github.krateo.io', resource: 'pullrequests', version: 'v1alpha1' }, namespace: 'krateo-system', verb: 'POST' as const },
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
