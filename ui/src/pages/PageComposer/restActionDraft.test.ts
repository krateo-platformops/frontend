/**
 * The RESTAction as an ordinary authored artifact.
 *
 * What is pinned here is the boundary this module draws: it refuses what the APISERVER or the
 * REFERENCE GRAPH will reject, and has no opinion at all about the jq. The filter is a program and
 * the server is the only thing that can judge one — it answers a bad filter by quoting the query
 * and naming the token, and the preview already shows that message.
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { generateRestAction, setApiRef, validateRestAction } from './restActionDraft'
import type { RestActionInput } from './restActionDraft'

/** Just enough of the emitted CR for the assertions — `any` would switch off the checking here. */
interface RestActionDoc {
  apiVersion: string
  kind: string
  spec: { api: { name: string; path: string; verb?: string; headers?: string[]; dependsOn?: { name: string } }[]; filter: string }
}
interface WidgetDoc { spec: { apiRef?: { name: string; namespace: string } } }

const input = (over: Partial<RestActionInput> = {}): RestActionInput => ({
  filter: '{ items: [ .pods.items[] | { name: .metadata.name } ] }',
  name: 'pod-sizing',
  namespace: 'krateo-system',
  steps: [{ name: 'pods', path: '/api/v1/namespaces/krateo-system/pods' }],
  ...over,
})

describe('validateRestAction', () => {
  it('accepts the two-source join that bind-data could never express', () => {
    // The shape the whole exercise is about: a second call that depends on the first, and a filter
    // that reads both back by step name.
    expect(validateRestAction(input({
      filter: 'include "quantity"; { items: [ .pods.items[] | { u: (.x | sum_quantities) } ] }',
      steps: [
        { name: 'pods', path: '/api/v1/namespaces/krateo-system/pods' },
        { dependsOn: 'pods', name: 'metrics', path: '/apis/metrics.k8s.io/v1beta1/namespaces/krateo-system/pods' },
      ],
    }))).toBeNull()
  })

  it('has NO opinion about the jq — that is the server’s job', () => {
    // Nonsense to jq, accepted here on purpose. Refusing it would mean re-implementing jq in the
    // browser to produce a worse answer than the one already on the wire.
    expect(validateRestAction(input({ filter: 'this is not jq at all ][' }))).toBeNull()
  })

  it('refuses an EMPTY filter — the widget would receive the raw responses', () => {
    expect(validateRestAction(input({ filter: '   ' }))).toContain('add a filter')
  })

  it('refuses a dependsOn that names no EARLIER step', () => {
    // Forward and self references both land here. The CRD takes the string either way and the call
    // simply never resolves — the silent failure this check exists to make loud.
    expect(validateRestAction(input({
      steps: [
        { dependsOn: 'metrics', name: 'pods', path: '/api/v1/pods' },
        { name: 'metrics', path: '/apis/metrics.k8s.io/v1beta1/pods' },
      ],
    }))).toContain('not an EARLIER step')
    expect(validateRestAction(input({
      steps: [{ dependsOn: 'pods', name: 'pods', path: '/api/v1/pods' }],
    }))).toContain('not an EARLIER step')
  })

  it('refuses a duplicate step name — the second would overwrite the first', () => {
    expect(validateRestAction(input({
      steps: [
        { name: 'pods', path: '/api/v1/pods' },
        { name: 'pods', path: '/apis/metrics.k8s.io/v1beta1/pods' },
      ],
    }))).toContain('already the name of an earlier step')
  })

  it('refuses a step name the FILTER could not read back', () => {
    // The step name becomes a jq key, so it has to be addressable as one.
    expect(validateRestAction(input({ steps: [{ name: 'my pods', path: '/api/v1/pods' }] })))
      .toContain('lower-case letters')
  })

  it('refuses a URL where a path belongs — the #1 external-RA bug', () => {
    expect(validateRestAction(input({ steps: [{ name: 'gh', path: 'https://api.github.com/x' }] })))
      .toContain('apiserver path, not a URL')
  })

  it('refuses no steps at all', () => {
    expect(validateRestAction(input({ steps: [] }))).toContain('at least one API step')
  })
})

describe('generateRestAction', () => {
  const doc = (over: Partial<RestActionInput> = {}) => {
    const result = generateRestAction(input(over))
    if (!result.ok) {
      throw new Error(result.error)
    }
    return { content: load(result.file.content) as RestActionDoc, path: result.file.path }
  }

  it('emits a RESTAction at the chart-relative key the draft addresses it by', () => {
    const { content, path } = doc()
    expect(path).toBe('templates/restaction.pod-sizing.yaml')
    expect(content.apiVersion).toBe('templates.krateo.io/v1')
    expect(content.kind).toBe('RESTAction')
  })

  it('writes dependsOn as the OBJECT the CRD declares, not a bare string', () => {
    const { content } = doc({
      steps: [
        { name: 'pods', path: '/api/v1/pods' },
        { dependsOn: 'pods', name: 'metrics', path: '/apis/metrics.k8s.io/v1beta1/pods' },
      ],
    })
    expect(content.spec.api[1].dependsOn).toEqual({ name: 'pods' })
    expect(content.spec.api[0].dependsOn).toBeUndefined()
  })

  it('gives every step a verb and an Accept header rather than relying on a default', () => {
    const { content } = doc()
    expect(content.spec.api[0].verb).toBe('GET')
    expect(content.spec.api[0].headers).toEqual(['Accept: application/json'])
  })

  it('carries the filter through BYTE FOR BYTE — it is the author’s program', () => {
    const filter = 'include "quantity";\n{ items: [ .pods.items[] | { a: 1 } ] }'
    expect(doc({ filter }).content.spec.filter).toBe(filter)
  })

  it('refuses rather than emitting, so a caller that skips validate cannot write a broken CR', () => {
    expect(generateRestAction(input({ steps: [] })).ok).toBe(false)
  })
})

describe('setApiRef', () => {
  const widget = [
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    'kind: Table',
    'metadata:',
    '  name: pods',
    '  namespace: krateo-system',
    'spec:',
    '  widgetData:',
    '    columns: []',
    '',
  ].join('\n')

  it('points a widget at a RESTAction', () => {
    const out = load(setApiRef(widget, { name: 'pod-sizing', namespace: 'krateo-system' })) as WidgetDoc
    expect(out.spec.apiRef).toEqual({ name: 'pod-sizing', namespace: 'krateo-system' })
  })

  it('keeps the widget’s own bytes — it does not round-trip the YAML', () => {
    // The held file is the author's, and re-emitting it would reorder keys and drop any comment
    // they added in the Files tab.
    const out = setApiRef(widget, { name: 'x', namespace: 'krateo-system' })
    expect(out).toContain('widgetData:')
    expect(out).toContain('columns: []')
  })

  it('REPLACES an existing apiRef rather than writing a second one', () => {
    const once = setApiRef(widget, { name: 'first', namespace: 'krateo-system' })
    const twice = setApiRef(once, { name: 'second', namespace: 'krateo-system' })
    const out = load(twice) as WidgetDoc
    expect(out.spec.apiRef).toEqual({ name: 'second', namespace: 'krateo-system' })
    expect(twice.match(/apiRef:/g)).toHaveLength(1)
  })

  it('keeps the RESTAction’s OWN namespace — a picked one lives where the listing found it', () => {
    const out = load(setApiRef(widget, { name: 'shared', namespace: 'krateo-observability' })) as WidgetDoc
    expect(out.spec.apiRef?.namespace).toBe('krateo-observability')
  })
})
