/**
 * recordBlueprintPreview — the FE-BP1/BP2 arming rule, moved out of the provider so a preview a
 * PERSON starts from the composer arms exactly what a proposed one does. It holds the tree and arms
 * the gate ONLY for a lint-clean draft whose render succeeded; every other case holds nothing.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { CHART_YAML_PATH, VALUES_SCHEMA_PATH } from './blueprintDraft'
import { createBlueprintDraftStore } from './blueprintDraftStore'
import { createBlueprintGate } from './blueprintGate'
import { draftHistory } from './draftHistory'
import { blueprintChipRendered, recordBlueprintPreview, recordPagePreview } from './publishCompile'

const CLEAN: Record<string, string> = {
  [CHART_YAML_PATH]: 'apiVersion: v2\nname: nginx-demo\nversion: 0.1.0\n',
  [VALUES_SCHEMA_PATH]: JSON.stringify({ properties: { replicas: { default: 1, type: 'integer' } }, type: 'object' }),
  'templates/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\n',
}
/** core-provider#46: a populated OBJECT default — lint-dirty, and would wedge the CompositionDefinition. */
const DIRTY: Record<string, string> = {
  ...CLEAN,
  [VALUES_SCHEMA_PATH]: JSON.stringify({ properties: { resources: { default: { limits: { cpu: '100m' } }, type: 'object' } }, type: 'object' }),
}
/** The one BuilderPublish claim every builder publishes through — the set the gate arms on. */
const publishSet = [{ gvr: { group: 'composition.krateo.io', resource: 'builderpublishes', version: 'v1-8-21' }, name: 'publish-nginx-demo', namespace: 'krateo-system', payload: {}, verb: 'POST' as const }]

describe('recordBlueprintPreview', () => {
  it('holds a clean, rendered draft AS A BLUEPRINT and arms the gate for its Chart.yaml name', () => {
    const store = createBlueprintDraftStore()
    const gate = createBlueprintGate()
    expect(recordBlueprintPreview(CLEAN, false, store, gate)).toBe(true)
    expect(store.get()?.kind).toBe('blueprint')
    expect(store.get()?.files).toEqual(CLEAN)
    expect(gate.evaluate(publishSet, 'nginx-demo').allowed).toBe(true)
  })

  it('arms NOTHING when the render failed — lint-clean is not enough (a chart that fails helm template lints clean)', () => {
    const store = createBlueprintDraftStore()
    const gate = createBlueprintGate()
    expect(recordBlueprintPreview(CLEAN, true, store, gate)).toBe(false)
    expect(store.get()).toBeNull()
    expect(gate.evaluate(publishSet, 'nginx-demo').allowed).toBe(false)
  })

  it('arms NOTHING for a lint-dirty draft', () => {
    const store = createBlueprintDraftStore()
    const gate = createBlueprintGate()
    expect(recordBlueprintPreview(DIRTY, false, store, gate)).toBe(false)
    expect(store.get()).toBeNull()
    expect(gate.evaluate(publishSet, 'nginx-demo').allowed).toBe(false)
  })

  it('holds nothing for a remote-chart preview — there is no authored tree to publish', () => {
    const store = createBlueprintDraftStore()
    const gate = createBlueprintGate()
    expect(recordBlueprintPreview(undefined, false, store, gate)).toBe(false)
    expect(store.get()).toBeNull()
  })
})

describe('a proposal replacing the held draft — the undo history belongs to the draft it was made on', () => {
  afterEach(() => draftHistory.clear())

  it('a DIFFERENT chart replacing the held one takes the history with it', () => {
    const store = createBlueprintDraftStore()
    const gate = createBlueprintGate()
    recordBlueprintPreview(CLEAN, false, store, gate)
    draftHistory.push({ files: CLEAN, kind: 'blueprint' })
    const other = { ...CLEAN, [CHART_YAML_PATH]: 'apiVersion: v2\nname: aws-vpc\nversion: 0.1.0\n' }
    recordBlueprintPreview(other, false, store, gate)
    // Undo would otherwise restore nginx-demo's tree over aws-vpc.
    expect(draftHistory.depth()).toBe(0)
  })

  it('a re-preview of the SAME chart keeps it — undoing back past the agent\'s own revision is the point', () => {
    const store = createBlueprintDraftStore()
    const gate = createBlueprintGate()
    recordBlueprintPreview(CLEAN, false, store, gate)
    draftHistory.push({ files: CLEAN, kind: 'blueprint' })
    recordBlueprintPreview({ ...CLEAN, 'templates/service.yaml': 'kind: Service\n' }, false, store, gate)
    expect(draftHistory.depth()).toBe(1)
  })
})

describe('the page twin, and a store that holds nothing', () => {
  afterEach(() => draftHistory.clear())
  const flex = (name: string) => [{ apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name, namespace: 'krateo-system' }, spec: { widgetData: { items: [] } } }]

  it('a DIFFERENT page replacing the held one takes the history with it', () => {
    const store = createBlueprintDraftStore()
    const gate = createBlueprintGate()
    recordPagePreview(flex('page-a'), store, gate)
    draftHistory.push({ files: store.get()?.files ?? {}, kind: 'page' })
    recordPagePreview(flex('page-b'), store, gate)
    expect(draftHistory.depth()).toBe(0)
  })

  it('a re-preview of the SAME page keeps it', () => {
    const store = createBlueprintDraftStore()
    const gate = createBlueprintGate()
    recordPagePreview(flex('page-a'), store, gate)
    draftHistory.push({ files: store.get()?.files ?? {}, kind: 'page' })
    recordPagePreview(flex('page-a'), store, gate)
    expect(draftHistory.depth()).toBe(1)
  })

  it('steps left over with NOTHING held belong to no draft — the first proposal drops them', () => {
    // The history is module state and the store is the provider's: a provider remount (every
    // nav-route registration remounts the router) empties the store and keeps the steps.
    draftHistory.push({ files: { 'templates/flex.page-old.yaml': 'kind: Flex' }, kind: 'page' })
    recordPagePreview(flex('page-new'), createBlueprintDraftStore(), createBlueprintGate())
    expect(draftHistory.depth()).toBe(0)
  })
})

describe('recordBlueprintPreview holds the tree that was RENDERED', () => {
  it('a file the model wrapped in a code fence is held de-fenced — as the preview parsed and rendered it', () => {
    // The drawer reads the de-fenced tree and labels it the held draft; the provider used to lint
    // the raw bytes, refuse, and leave whatever was held before — which the drawer's edits then hit.
    const store = createBlueprintDraftStore()
    const fenced = { ...CLEAN, [VALUES_SCHEMA_PATH]: `\`\`\`json\n${CLEAN[VALUES_SCHEMA_PATH]}\n\`\`\`` }
    expect(recordBlueprintPreview(fenced, false, store, createBlueprintGate())).toBe(true)
    expect(store.get()?.files[VALUES_SCHEMA_PATH]).toBe(CLEAN[VALUES_SCHEMA_PATH])
  })
})

describe('blueprintChipRendered — arming needs a positive render', () => {
  it('only a chip that says it rendered counts; the absence of a failure does not', () => {
    expect(blueprintChipRendered({ rendered: true })).toBe(true)
    // The render-unavailable chip, a refused proposal and a lint-rejected draft carry neither flag.
    expect(blueprintChipRendered({})).toBe(false)
    expect(blueprintChipRendered({ rendered: false })).toBe(false)
  })
})

