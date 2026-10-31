/**
 * One mutation per rule: the example passes, and each mutation below breaks exactly one rule and
 * is refused at the step that owns it, with a problem line that names the object.
 */
/* eslint-disable no-template-curly-in-string -- the ${…} jq DSL is the subject under test */
import { describe, expect, it } from 'vitest'

import type { Envelope } from '../src/envelope'

import { byKind, type Draft, example, fakeSnowplow, json, liveCtx, objAt, rawReply, recorder, run } from './helpers'

const failsAt = (envelope: Envelope, stepName: string, pattern: RegExp): void => {
  expect(envelope.ok).toBe(false)
  expect(envelope.failedStep).toBe(stepName)
  const failed = envelope.steps.find((step) => step.name === stepName)!
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
    expect(envelope.steps.map((step) => step.name)).toEqual(['builder', 'builder-lint', 'references', 'jq-compile', 'live-dry-run', 'data', 'shape', 'coverage'])
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
    const draft = mutate((docs) => { objAt(byKind(docs, 'Flex'), 'metadata').annotations = { pad: 'x'.repeat(600_000) } })
    failsAt(await run(draft), 'builder', /holds at most 524288/)
  })
})

describe('builder-lint (the portal\'s own page lint)', () => {
  it('spec.allowedResources on a Flex (krateo-057, 2026-10-02) is refused', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'Flex'), 'spec').allowedResources = ['piecharts'] })
    failsAt(await run(draft), 'builder-lint', /widgets\[0\] \(Flex\/page-pod-sizing\): \/spec must NOT have additional properties/)
  })
  it('an unknown kind', async () => {
    const draft = mutate((docs) => { byKind(docs, 'PieChart').kind = 'DonutChart' })
    failsAt(await run(draft), 'builder-lint', /DonutChart\/pod-phase-pie\): unknown kind/)
  })
  it('a name that is not DNS-1123', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'Table'), 'metadata').name = 'Pod_Sizing' })
    failsAt(await run(draft), 'builder-lint', /metadata.name is required and must be a DNS-1123 name/)
  })
  it('a wrong apiVersion', async () => {
    const draft = mutate((docs) => { byKind(docs, 'Table').apiVersion = 'widgets.templates.krateo.io/v1' })
    failsAt(await run(draft), 'builder-lint', /apiVersion must be widgets.templates.krateo.io\/v1beta1/)
  })
  it('a missing spec', async () => {
    const draft = mutate((docs) => { delete byKind(docs, 'RESTAction').spec })
    failsAt(await run(draft), 'builder-lint', /RESTAction\/pod-sizing\): spec is required/)
  })
  it('a value outside the widget schema\'s enum', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'PieChart'), 'spec', 'widgetData').legendPosition = 'middle' })
    failsAt(await run(draft), 'builder-lint', /PieChart\/pod-phase-pie\): \/spec\/widgetData\/legendPosition must be equal to one of the allowed values/)
  })
  it('a required widgetData field missing', async () => {
    const draft = mutate((docs) => { delete objAt(byKind(docs, 'Table'), 'spec', 'widgetData')['columns'] })
    failsAt(await run(draft), 'builder-lint', /Table\/pod-sizing-table\): \/spec\/widgetData must have required property 'columns'/)
  })
  it('a duplicate object', async () => {
    const draft = mutate((docs) => { docs.push(structuredClone(byKind(docs, 'Table'))) })
    failsAt(await run(draft), 'builder-lint', /duplicate draft — tables\/pod-sizing-table appears twice/)
  })
  it('no page-<slug> root Flex', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'Flex'), 'metadata').name = 'pod-sizing' })
    failsAt(await run(draft), 'builder-lint', /no page-<slug> root Flex/)
  })
  it('an entry that is not a CR object', async () => {
    failsAt(await run([...example(), 'Flex' as unknown as Record<string, unknown>]), 'builder-lint', /widgets\[4\]: not a CR object/)
  })
})

describe('references', () => {
  it('a root child that is in neither the draft nor (offline) checked in the cluster', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'Flex'), 'spec', 'resourcesRefs', 'items', 1).name = 'pod-sizing-tabel' })
    failsAt(await run(draft), 'references', /spec.resourcesRefs.items\[1\]: notChecked: not in the draft/)
  })
  it('a NESTED widget\'s child is checked too, not only the root\'s (M2)', async () => {
    const draft = mutate((docs) => {
      objAt(byKind(docs, 'Table'), 'spec', 'resourcesRefs').items = [{ apiVersion: 'widgets.templates.krateo.io/v1beta1', id: 'x', name: 'nowhere', namespace: 'krateo-system', resource: 'buttons' }]
    })
    failsAt(await run(draft), 'references', /widgets\[2\] \(Table\/pod-sizing-table\): spec.resourcesRefs.items\[0\]: notChecked: not in the draft/)
  })
  it('a LITERAL resourcesRefsTemplate entry is checked; a templated one is left to render time', async () => {
    const literal = mutate((docs) => {
      objAt(byKind(docs, 'Table'), 'spec').resourcesRefsTemplate = [{ iterator: '${ .pods }', template: { apiVersion: 'widgets.templates.krateo.io/v1beta1', name: 'nowhere', namespace: 'krateo-system', resource: 'buttons' } }]
    })
    failsAt(await run(literal), 'references', /spec.resourcesRefsTemplate\[0\].template: notChecked: not in the draft/)
    const templated = mutate((docs) => {
      objAt(byKind(docs, 'Table'), 'spec').resourcesRefsTemplate = [{ iterator: '${ .pods }', template: { apiVersion: 'widgets.templates.krateo.io/v1beta1', name: '${ .name }', namespace: 'krateo-system', resource: 'buttons' } }]
    })
    const envelope = await run(templated)
    expect(envelope.ok).toBe(true)
    expect(envelope.steps.find((step) => step.name === 'references')?.notes[1]).toMatch(/1 templated resourcesRefsTemplate entry is filled from data at render time/)
  })
  it('a root child outside the draft with no namespace', async () => {
    const draft = mutate((docs) => {
      const item = objAt(byKind(docs, 'Flex'), 'spec', 'resourcesRefs', 'items', 1)
      item.name = 'elsewhere'
      delete item.namespace
    })
    failsAt(await run(draft), 'references', /must name the namespace it exists in/)
  })
  it('a root child that is not a widget', async () => {
    const draft = mutate((docs) => { Object.assign(objAt(byKind(docs, 'Flex'), 'spec', 'resourcesRefs', 'items', 1), { apiVersion: 'v1', name: 'x', resource: 'configmaps' }) })
    failsAt(await run(draft), 'references', /a widget's children are widgets/)
  })
  it('an apiRef to a RESTAction in neither the draft nor the cluster (read raw through snowplow as the caller)', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'Table'), 'spec', 'apiRef').name = 'pod-sizzling' })
    const { transport } = recorder(fakeSnowplow())
    failsAt(await run(draft, liveCtx(transport)), 'references', /Table\/pod-sizing-table\): spec.apiRef: restactions\/pod-sizzling is in neither the draft nor namespace krateo-system/)
  })
  it('an apiRef the caller cannot read is red', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'Table'), 'spec', 'apiRef').name = 'private-ra' })
    const { transport } = recorder(fakeSnowplow({ read: () => rawReply(403, { code: 403, kind: 'Status', message: 'forbidden' }) }))
    failsAt(await run(draft, liveCtx(transport)), 'references', /you cannot read krateo-system\/restactions\/private-ra/)
  })
  it('an apiRef to an EXISTING RESTAction resolves — read raw, never resolved', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'Table'), 'spec').apiRef = { name: 'compositions-list', namespace: 'krateo-system' } })
    const { requests, transport } = recorder(fakeSnowplow({ read: () => rawReply(200, { kind: 'RESTAction', spec: { api: [{ name: 'l', path: '/apis/composition.krateo.io' }] } }) }))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.steps.find((step) => step.name === 'references')?.ok).toBe(true)
    expect(requests.find((request) => new URL(request.url).pathname === '/call' && request.method === 'GET')).toMatchObject({
      headers: { Authorization: 'Bearer caller-jwt' },
      url: 'http://snowplow.test/call?apiVersion=templates.krateo.io%2Fv1&resource=restactions&namespace=krateo-system&name=compositions-list&raw=true',
    })
  })
  it('a raw read answered WITHOUT X-Snowplow-Raw: true is a failure — the object may have been resolved, not read', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'Table'), 'spec').apiRef = { name: 'compositions-list', namespace: 'krateo-system' } })
    const { transport } = recorder(fakeSnowplow({ read: () => json(200, { kind: 'RESTAction', status: { resolved: true } }) }))
    failsAt(await run(draft, liveCtx(transport)), 'references', /notChecked: reading krateo-system\/restactions\/compositions-list through snowplow failed \(snowplow answered 200 to a raw read without x-snowplow-raw: true/)
  })
  it('today\'s snowplow (no raw read): an out-of-draft reference is live verdict missing, red, and never resolved', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'Table'), 'spec').apiRef = { name: 'compositions-list', namespace: 'krateo-system' } })
    const { requests, transport } = recorder(fakeSnowplow({ capabilities: null }))
    failsAt(await run(draft, liveCtx(transport)), 'references', /live verdict missing: not in the draft, and this snowplow cannot yet read an object without resolving it \(call.raw/)
    expect(requests.some((request) => new URL(request.url).pathname === '/call')).toBe(false)
  })
})

describe('jq-compile (snowplow\'s gojq fork and modules)', () => {
  it('a RESTAction filter that does not parse', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'RESTAction'), 'spec').filter = '{ pods: [ .pods.items[] ' })
    failsAt(await run(draft), 'jq-compile', /RESTAction\/pod-sizing\): spec.filter: invalid jq query/)
  })
  it('a function no snowplow module defines', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'RESTAction'), 'spec').filter = 'include "quantity"; .pods.items | map(.x | kilocores)' })
    failsAt(await run(draft), 'jq-compile', /function not defined: kilocores\/0/)
  })
  it('a per-api filter that does not compile', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'RESTAction'), 'spec', 'api', 0).filter = '.pods.items | mapp(.metadata)' })
    failsAt(await run(draft), 'jq-compile', /spec.api\[0\] \(pods\).filter: unable to compile jq query: function not defined: mapp\/1/)
  })
  it('a widgetDataTemplate expression that does not compile', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'PieChart'), 'spec', 'widgetDataTemplate', 0).expression = '${ [ .pods[]? | .phase ] | group_by(.) | map({ phase: .[0], count: lenght }) }' })
    failsAt(await run(draft), 'jq-compile', /widgetDataTemplate\[0\] \(data\).expression: unable to compile jq query: function not defined: lenght\/0/)
  })
  it('a widgetDataTemplate "${" that never closes', async () => {
    const draft = mutate((docs) => { objAt(byKind(docs, 'Table'), 'spec', 'widgetDataTemplate', 0).expression = '${ [ .pods[]? ' })
    failsAt(await run(draft), 'jq-compile', /is never closed/)
  })
  it('the quantity module resolves exactly as in snowplow', async () => {
    const envelope = await run(example())
    expect(envelope.steps.find((step) => step.name === 'jq-compile')?.ok).toBe(true)
  })
})
