/**
 * One mutation per rule: the example passes, and each mutation below breaks exactly one rule and
 * is refused at the step that owns it, with a problem line that names the object.
 */
import { describe, expect, it } from 'vitest'

import type { Envelope } from '../src/envelope'
import { byKind, type Draft, example, json, liveCtx, recorder, run } from './helpers'

const failsAt = (envelope: Envelope, stepName: string, pattern: RegExp): void => {
  expect(envelope.ok).toBe(false)
  expect(envelope.failedStep).toBe(stepName)
  const failed = envelope.steps.find((s) => s.name === stepName)!
  expect(failed.problems.join('\n')).toMatch(pattern)
}

const mutate = (change: (draft: Draft) => void): Draft => {
  const draft = example()
  change(draft)
  return draft
}

describe('the example passes offline', () => {
  it('every offline step ran and passed', async () => {
    const envelope = await run(example())
    expect(envelope.ok).toBe(true)
    expect(envelope.steps.map((s) => s.name)).toEqual(['builder', 'builder-lint', 'references', 'jq-compile', 'live-dry-run', 'data', 'coverage'])
  })
})

describe('builder', () => {
  it('an unknown Builder is refused', async () => {
    failsAt(await run(example(), undefined, 'no-such-builder'), 'builder', /no Builder "no-such-builder"/)
  })
  it('a Builder whose draftKind has no plan is refused, not skipped', async () => {
    failsAt(await run(example(), undefined, 'controller-builder'), 'builder', /no plan for draftKind "controller"/)
  })
  it('a draft over the Builder\'s byte cap is refused', async () => {
    const draft = mutate((d) => { byKind(d, 'Flex').metadata.annotations = { pad: 'x'.repeat(600_000) } })
    failsAt(await run(draft), 'builder', /holds at most 524288/)
  })
})

describe('builder-lint (the portal\'s own page lint)', () => {
  it('spec.allowedResources on a Flex (krateo-057, 2026-10-02) is refused', async () => {
    const draft = mutate((d) => { byKind(d, 'Flex').spec.allowedResources = ['piecharts'] })
    failsAt(await run(draft), 'builder-lint', /widgets\[0\] \(Flex\/page-pod-sizing\): \/spec must NOT have additional properties/)
  })
  it('an unknown kind', async () => {
    const draft = mutate((d) => { byKind(d, 'PieChart').kind = 'DonutChart' })
    failsAt(await run(draft), 'builder-lint', /DonutChart\/pod-phase-pie\): unknown kind/)
  })
  it('a name that is not DNS-1123', async () => {
    const draft = mutate((d) => { byKind(d, 'Table').metadata.name = 'Pod_Sizing' })
    failsAt(await run(draft), 'builder-lint', /metadata.name is required and must be a DNS-1123 name/)
  })
  it('a wrong apiVersion', async () => {
    const draft = mutate((d) => { byKind(d, 'Table').apiVersion = 'widgets.templates.krateo.io/v1' })
    failsAt(await run(draft), 'builder-lint', /apiVersion must be widgets.templates.krateo.io\/v1beta1/)
  })
  it('a missing spec', async () => {
    const draft = mutate((d) => { delete byKind(d, 'RESTAction').spec })
    failsAt(await run(draft), 'builder-lint', /RESTAction\/pod-sizing\): spec is required/)
  })
  it('a value outside the widget schema\'s enum', async () => {
    const draft = mutate((d) => { byKind(d, 'PieChart').spec.widgetData.legendPosition = 'middle' })
    failsAt(await run(draft), 'builder-lint', /PieChart\/pod-phase-pie\): \/spec\/widgetData\/legendPosition must be equal to one of the allowed values/)
  })
  it('a required widgetData field missing', async () => {
    const draft = mutate((d) => { delete byKind(d, 'Table').spec.widgetData.columns })
    failsAt(await run(draft), 'builder-lint', /Table\/pod-sizing-table\): \/spec\/widgetData must have required property 'columns'/)
  })
  it('a duplicate object', async () => {
    const draft = mutate((d) => { d.push(structuredClone(byKind(d, 'Table'))) })
    failsAt(await run(draft), 'builder-lint', /duplicate draft — tables\/pod-sizing-table appears twice/)
  })
  it('no page-<slug> root Flex', async () => {
    const draft = mutate((d) => { byKind(d, 'Flex').metadata.name = 'pod-sizing' })
    failsAt(await run(draft), 'builder-lint', /no page-<slug> root Flex/)
  })
  it('an entry that is not a CR object', async () => {
    failsAt(await run([...example(), 'Flex' as unknown as Record<string, unknown>]), 'builder-lint', /widgets\[4\]: not a CR object/)
  })
})

describe('references', () => {
  it('a root child that is in neither the draft nor (offline) checked in the cluster', async () => {
    const draft = mutate((d) => { byKind(d, 'Flex').spec.resourcesRefs.items[1].name = 'pod-sizing-tabel' })
    failsAt(await run(draft), 'references', /spec.resourcesRefs.items\[1\]: notChecked: not in the draft/)
  })
  it('a root child outside the draft with no namespace', async () => {
    const draft = mutate((d) => {
      const item = byKind(d, 'Flex').spec.resourcesRefs.items[1]
      item.name = 'elsewhere'
      delete item.namespace
    })
    failsAt(await run(draft), 'references', /must name the namespace it exists in/)
  })
  it('a root child that is not a widget', async () => {
    const draft = mutate((d) => { Object.assign(byKind(d, 'Flex').spec.resourcesRefs.items[1], { apiVersion: 'v1', resource: 'configmaps', name: 'x' }) })
    failsAt(await run(draft), 'references', /a page root's children are widgets/)
  })
  it('an apiRef to a RESTAction in neither the draft nor the cluster', async () => {
    const draft = mutate((d) => { byKind(d, 'Table').spec.apiRef.name = 'pod-sizzling' })
    const { transport } = recorder(() => json(404, { kind: 'Status', reason: 'NotFound', code: 404 }))
    failsAt(await run(draft, liveCtx(transport)), 'references', /Table\/pod-sizing-table\): spec.apiRef: restactions\/pod-sizzling is in neither the draft nor namespace krateo-system/)
  })
  it('an apiRef to an EXISTING RESTAction resolves (read-only get as the gate)', async () => {
    const draft = mutate((d) => {
      byKind(d, 'Table').spec.apiRef = { name: 'compositions-list', namespace: 'krateo-system' }
    })
    const { transport, requests } = recorder((req) => (req.url.endsWith('/restactions/compositions-list') ? json(200, {}) : json(201, {})))
    const envelope = await run(draft, liveCtx(transport, { callerToken: null }))
    expect(envelope.steps.find((s) => s.name === 'references')?.ok).toBe(true)
    expect(requests[0]).toMatchObject({ method: 'GET', url: 'https://apiserver.test/apis/templates.krateo.io/v1/namespaces/krateo-system/restactions/compositions-list' })
  })
})

describe('jq-compile (snowplow\'s gojq fork and modules)', () => {
  it('a RESTAction filter that does not parse', async () => {
    const draft = mutate((d) => { byKind(d, 'RESTAction').spec.filter = '{ pods: [ .pods.items[] ' })
    failsAt(await run(draft), 'jq-compile', /RESTAction\/pod-sizing\): spec.filter: invalid jq query/)
  })
  it('a function no snowplow module defines', async () => {
    const draft = mutate((d) => { byKind(d, 'RESTAction').spec.filter = 'include "quantity"; .pods.items | map(.x | kilocores)' })
    failsAt(await run(draft), 'jq-compile', /function not defined: kilocores\/0/)
  })
  it('a per-api filter that does not compile', async () => {
    const draft = mutate((d) => { byKind(d, 'RESTAction').spec.api[0].filter = '.pods.items | mapp(.metadata)' })
    failsAt(await run(draft), 'jq-compile', /spec.api\[0\] \(pods\).filter: unable to compile jq query: function not defined: mapp\/1/)
  })
  it('a widgetDataTemplate expression that does not compile', async () => {
    const draft = mutate((d) => { byKind(d, 'PieChart').spec.widgetDataTemplate[0].expression = '${ [ .pods[]? | .phase ] | group_by(.) | map({ phase: .[0], count: lenght }) }' })
    failsAt(await run(draft), 'jq-compile', /widgetDataTemplate\[0\] \(data\).expression: unable to compile jq query: function not defined: lenght\/0/)
  })
  it('a widgetDataTemplate "${" that never closes', async () => {
    const draft = mutate((d) => { byKind(d, 'Table').spec.widgetDataTemplate[0].expression = '${ [ .pods[]? ' })
    failsAt(await run(draft), 'jq-compile', /is never closed/)
  })
  it('the quantity module resolves exactly as in snowplow', async () => {
    const envelope = await run(example())
    expect(envelope.steps.find((s) => s.name === 'jq-compile')?.ok).toBe(true)
  })
})
