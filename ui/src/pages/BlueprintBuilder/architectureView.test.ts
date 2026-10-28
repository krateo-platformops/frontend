/**
 * The canvas's reading of the architecture file — every shape of it answered, none thrown — and
 * the element states one step of the machine lights. Pure; the component suites mount the page.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ARCHITECTURE_API_VERSION, serializeArchitecture, wrapAsConfigMapTemplate, type ResourceNode } from './architecture'
import { apiGroup, architectureView, counted, describeLeave, elementStates } from './architectureView'
import { formPreviewGap } from './formPreview'
import { stepperModel } from './stepperModel'

const FIXTURE = join(__dirname, '__fixtures__', 'builder-publish', 'expected.architecture.yaml')
const builderPublish = (): string => wrapAsConfigMapTemplate(readFileSync(FIXTURE, 'utf8'), 'builder-publish')

const native = (id: string, dependsOn?: ResourceNode['dependsOn']): ResourceNode =>
  ({ apiVersion: 'v1', class: 'native', dependsOn, id, kind: 'ConfigMap', template: `templates/${id}.yaml` })
const template = (resources: ResourceNode[]): string =>
  wrapAsConfigMapTemplate(serializeArchitecture({ apiVersion: ARCHITECTURE_API_VERSION, chart: 'demo', kind: 'ChartArchitecture', resources }), 'demo')

describe('architectureView — every shape of the file has an answer', () => {
  it('absent: no file at all', () => {
    expect(architectureView(undefined)).toEqual({ status: 'absent' })
  })

  it('unreadable: a ConfigMap template with no data.architecture block', () => {
    expect(architectureView('apiVersion: v1\nkind: ConfigMap\n')).toEqual({ status: 'unreadable' })
  })

  it('invalid: the kernel\'s problems, by path — including a descriptor that is not YAML', () => {
    const view = architectureView(template([native('web', [{ ref: 'nowhere' }])]))
    expect(view.status === 'invalid' && view.problems).toEqual([{ message: '"nowhere" is not a resource of this chart', path: 'resources[0].dependsOn[0]' }])
    const broken = architectureView('data:\n  architecture: |\n    resources: [\n')
    expect(broken.status).toBe('invalid')
  })

  it('cycle: the members and a graph to draw them on', () => {
    const view = architectureView(template([native('a', [{ ref: 'b' }]), native('b', [{ ref: 'a' }])]))
    expect(view.status).toBe('cycle')
    expect(view.status === 'cycle' && [...view.cycle].sort()).toEqual(['a', 'a', 'b'])
    expect(view.status === 'cycle' && view.graph.nodes.map((node) => node.data.inCycle)).toEqual([true, true])
  })

  it('ok: builder-publish\'s machine, four states deep', () => {
    const view = architectureView(builderPublish())
    expect(view.status).toBe('ok')
    expect(view.status === 'ok' && view.derived.states).toHaveLength(4)
    expect(view.status === 'ok' && view.graph.nodes).toHaveLength(5)
  })
})

describe('elementStates — one map for the whole graph, so an element that leaves a state is told', () => {
  const view = architectureView(builderPublish())
  if (view.status !== 'ok') { throw new Error('fixture') }
  const at = (level: number) => stepperModel(view.architecture, view.derived, level)

  it('S1: the repository enters; the rest wait; the shim is apart', () => {
    const states = elementStates(view.graph, at(0), null)
    expect(states.repository).toEqual(['frontier'])
    expect(states.repo).toEqual(['withheld'])
    expect(states.pullrequest).toEqual(['withheld'])
    expect(states['username-secret']).toEqual(['orthogonal'])
    expect(states['repo:dependsOn[0]']).toEqual(['withheld'])
  })

  it('S4: everything in the sequence renders; the edges inside it are lit; selection is its own state', () => {
    const states = elementStates(view.graph, at(3), 'repo')
    expect(states.pullrequest).toEqual(['frontier'])
    expect(states.repo).toEqual(['lit', 'selected'])
    expect(states['pullrequest:dependsOn[0]']).toEqual(['lit'])
    // Every node and edge has an entry — an empty list is "no state", said explicitly.
    expect(Object.keys(states)).toHaveLength(view.graph.nodes.length + view.graph.edges.length)
  })

  it('a cycle marks its members and nothing else', () => {
    const cyclic = architectureView(template([native('a', [{ ref: 'b' }]), native('b', [{ ref: 'a' }]), native('c')]))
    if (cyclic.status !== 'cycle') { throw new Error('fixture') }
    const states = elementStates(cyclic.graph, null, null, cyclic.cycle)
    expect(states).toMatchObject({ a: ['cycle'], b: ['cycle'], c: [] })
  })
})

describe('the words the panels use', () => {
  it('apiGroup: the unnamed group is core', () => {
    expect(apiGroup('v1')).toBe('core')
    expect(apiGroup('apps/v1')).toBe('apps')
    expect(apiGroup('github.krateo.io/v2022-11-28')).toBe('github.krateo.io')
  })

  it('counted', () => {
    expect(counted(1, 'file')).toBe('1 file')
    expect(counted(9, 'file')).toBe('9 files')
    expect(counted(0, 'resource')).toBe('0 resources')
  })

  it('describeLeave: declared, defaulted, missing, conditional', () => {
    expect(describeLeave({ all: true, from: 'localresources', predicate: '.status.targetCommitId', source: 'readyWhen', to: 'pullrequest' }))
      .toBe('every localresources has .status.targetCommitId')
    expect(describeLeave({ from: 'db', predicate: 'Ready=True and Synced=True', source: 'default', to: 'app' }))
      .toBe('db is ready by its class default (Ready=True and Synced=True)')
    expect(describeLeave({ from: 'repo', predicate: 'x', source: 'missing', to: 'pr' })).toMatch(/no readyWhen is declared/)
    expect(describeLeave({ from: 'repo', predicate: '.status.ok', source: 'readyWhen', to: 'pr', when: '.Values.source.url' }))
      .toBe('repo has .status.ok — only when .Values.source.url is set')
  })

  it('formPreviewGap names why there is no form, or null when there is one', () => {
    expect(formPreviewGap(undefined)).toMatch(/There is no values.schema.json/)
    expect(formPreviewGap('{ not json')).toMatch(/not valid JSON/)
    expect(formPreviewGap('{"type":"object","properties":{}}')).toBe('The form is empty because values.schema.json has no properties yet.')
    expect(formPreviewGap('{"type":"object","properties":{"a":{"type":"string"}}}')).toBeNull()
  })
})
