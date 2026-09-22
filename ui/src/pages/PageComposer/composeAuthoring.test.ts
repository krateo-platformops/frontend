/**
 * THE TWO OPS THAT LET AN AGENT AUTHOR — and the gap whose absence caused a live bug.
 *
 * Before these existed the agent could create a layout container and nothing else, so a request for
 * "a table of pods" had no verb that fit. It answered with `addExisting` and placed a widget that
 * did not exist: the draft gained `resourcesRefs: [tables/pod-sizing]`, the agent reported success,
 * and the page published clean with a hole in it.
 *
 * These are pure, so the rules are asserted without a DOM. The wiring is covered in
 * PageComposer.agent.test.tsx, where the ops travel through the real handler.
 */
import { describe, expect, it } from 'vitest'

import { authorWidget, bindData } from './composeAuthoring'
import type { TreeNode } from './objectTree'
import { WIDGET_KINDS } from './widgetKinds.generated'

const free = () => false
const node = (over: Partial<TreeNode> = {}): TreeNode => ({
  allowedDerived: false,
  allowedResources: null,
  bound: false,
  children: [],
  drafted: true,
  kind: 'Table',
  name: 'pods',
  namespace: 'krateo-system',
  parentPath: null,
  path: 'templates/table.pods.yaml',
  position: null,
  refId: null,
  resource: 'tables',
  slot: null,
  ...over,
})

const TABLE_YAML = [
  'apiVersion: widgets.templates.krateo.io/v1beta1',
  'kind: Table',
  'metadata:',
  '  name: pods',
  '  namespace: krateo-system',
  'spec:',
  '  widgetData:',
  '    allowedResources: []',
  '    columns: []',
  '',
].join('\n')

describe('authorWidget', () => {
  it('creates a Table with the required LISTS defaulted, the way the drop form does for a person', () => {
    // The exact case #353 restored for people. If the agent had to supply `columns` it would be
    // hand-writing the field `widgetDataTemplate` is about to fill.
    const result = authorWidget({ kind: 'Table', name: 'pods' }, free)

    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (result.ok) {
      expect(result.resource).toBe('tables')
      expect(result.authored).toEqual({ allowedResources: [], columns: [] })
    }
  })

  it('accepts EVERY kind the CRDs define — the palette does, so the agent must', () => {
    // Asserted against the generated table: a kind added to the chart becomes authorable with no
    // code change, which is the property that stops this list going stale the way LAYOUT_KINDS did.
    const refused: string[] = []
    for (const kind of Object.keys(WIDGET_KINDS)) {
      const properties = (WIDGET_KINDS[kind].schema as { properties?: Record<string, { type?: string }> }).properties ?? {}
      // Supply the required SCALARS; lists are what the op is expected to default.
      const widgetData = Object.fromEntries(WIDGET_KINDS[kind].required
        .filter((field) => properties[field]?.type !== 'array')
        .map((field) => [field, 'x']))
      if (!authorWidget({ kind, name: 'a-widget', widgetData }, free).ok) { refused.push(kind) }
    }
    expect(refused).toEqual([])
  })

  it('matches the kind case-insensitively — a proposal is prose, not an enum', () => {
    expect(authorWidget({ kind: 'table', name: 'pods' }, free).ok).toBe(true)
  })

  it('refuses a kind the portal does not have, rather than inventing a plural', () => {
    const result = authorWidget({ kind: 'Spreadsheet', name: 'pods' }, free)
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.error).toContain('Spreadsheet') }
  })

  it('refuses a name the apiserver would reject', () => {
    const result = authorWidget({ kind: 'Table', name: 'Pods Table' }, free)
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.error).toContain('lower-case') }
  })

  it('refuses a name the draft already holds — two CRs cannot share one', () => {
    const result = authorWidget({ kind: 'Table', name: 'pods' }, (name) => name === 'pods')
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.error).toContain('already in this draft') }
  })

  it('still refuses a missing required SCALAR — an unanswered string is not an empty list', () => {
    const result = authorWidget({ kind: 'BarChart', name: 'throughput' }, free)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('xField')
      // `data` is the required LIST and is defaulted, so it must not be named as missing.
      expect(result.error).not.toContain('data,')
    }
  })
})

describe('bindData', () => {
  const op = { filter: '{ items: [ .pods.items[] ] }', name: 'pod-sizing', steps: [{ name: 'pods', path: '/api/v1/pods' }] }

  it('authors the RESTAction and points the widget at it', () => {
    const result = bindData({ action: op, widget: 'pods' }, node(), TABLE_YAML, 'krateo-system')

    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (result.ok) {
      expect(result.created?.content).toContain('kind: RESTAction')
      expect(result.created?.content).toContain('name: pod-sizing')
      expect(result.yaml).toContain('apiRef:')
      expect(result.yaml).toContain('name: pod-sizing')
      // The widget's own file is edited, and the RESTAction is a NEW file — two paths, not one.
      expect(result.path).toBe('templates/table.pods.yaml')
    }
  })

  it('fills the widget from the action result when a template is given', () => {
    const result = bindData(
      { action: op, dataTemplate: [{ expression: '.items', forPath: 'dataSource' }], widget: 'pods' },
      node(), TABLE_YAML, 'krateo-system',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.yaml).toContain('widgetDataTemplate')
      expect(result.yaml).toContain('dataSource')
    }
  })

  it('points at a RESTAction that already exists, without authoring one', () => {
    const result = bindData({ actionRef: { name: 'platform-alerts' }, widget: 'pods' }, node(), TABLE_YAML, 'krateo-system')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.created).toBeNull()
      expect(result.yaml).toContain('platform-alerts')
    }
  })

  it('refuses a widget the draft does not hold', () => {
    const result = bindData({ action: op, widget: 'ghost' }, undefined, undefined, 'krateo-system')
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.error).toContain('ghost') }
  })

  it('refuses a PLACED widget, which has no file to edit', () => {
    // A referenced cluster widget is a name in its parent, not bytes in the draft — there is
    // nothing here to give an apiRef to, and editing the parent would be a different operation.
    const result = bindData({ action: op, widget: 'pods' }, node({ path: null }), undefined, 'krateo-system')
    expect(result.ok).toBe(false)
  })

  it('refuses a bind that asks for nothing at all', () => {
    const result = bindData({ widget: 'pods' }, node(), TABLE_YAML, 'krateo-system')
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.error).toContain('nothing to bind') }
  })

  it('passes a bad action straight through the generator\'s own refusal', () => {
    const result = bindData(
      { action: { filter: '.', name: 'pod-sizing', steps: [{ dependsOn: 'nope', name: 'a', path: '/x' }] }, widget: 'pods' },
      node(), TABLE_YAML, 'krateo-system',
    )
    expect(result.ok).toBe(false)
  })
})
