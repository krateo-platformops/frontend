/**
 * recordBlueprintPreview — the FE-BP1/BP2 arming rule, moved out of the provider so a preview a
 * PERSON starts from the composer arms exactly what a proposed one does. It holds the tree and arms
 * the gate ONLY for a lint-clean draft whose render succeeded; every other case holds nothing.
 */
import { describe, expect, it } from 'vitest'

import { CHART_YAML_PATH, VALUES_SCHEMA_PATH } from './blueprintDraft'
import { createBlueprintDraftStore } from './blueprintDraftStore'
import { createBlueprintGate } from './blueprintGate'
import { recordBlueprintPreview } from './publishCompile'

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
const publishSet = [{ gvr: { group: 'github.krateo.io', resource: 'pullrequests', version: 'v1alpha1' }, name: 'pr', namespace: 'krateo-system', payload: {}, verb: 'POST' as const }]

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
