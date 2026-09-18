/**
 * planAdd decides what a palette drop means. The tests centre on the one difference that matters:
 * a container is CREATED (a file joins the draft) while an existing widget is only PLACED — getting
 * that backwards writes files that should not exist.
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { buildObjectTree } from './objectTree'
import type { TreeNode } from './objectTree'
import { planAdd } from './planAdd'

const cr = (kind: string, name: string, children: readonly string[] = [], allowed?: readonly string[]) => {
  const lines = [
    `kind: ${kind}`, 'apiVersion: widgets.templates.krateo.io/v1beta1',
    'metadata:', `  name: ${name}`, '  namespace: krateo-system', 'spec:', '  widgetData:',
  ]
  if (allowed?.length) {
    lines.push('    allowedResources:')
    allowed.forEach((plural) => lines.push(`      - ${plural}`))
  }
  lines.push(children.length ? '    items:' : '    items: []')
  children.forEach((refId) => lines.push(`      - resourceRefId: ${refId}`))
  lines.push('  resourcesRefs:')
  lines.push(children.length ? '    items:' : '    items: []')
  children.forEach((refId) => {
    lines.push(`      - id: ${refId}`, `        name: ${refId}`, '        namespace: krateo-system', '        resource: cards', '        verb: GET')
  })
  return lines.join('\n')
}

const draft = () => ({
  'templates/card.a.yaml': cr('Card', 'a'),
  'templates/flex.page-x.yaml': cr('Flex', 'page-x', ['a']),
  'templates/paragraph.p.yaml': cr('Paragraph', 'p'),
})

const node = (files: Record<string, string>, name: string): TreeNode => {
  const walk = (nodes: readonly TreeNode[]): TreeNode | undefined => {
    for (const candidate of nodes) {
      if (candidate.name === name) { return candidate }
      const hit = walk(candidate.children)
      if (hit) { return hit }
    }
    return undefined
  }
  const found = walk(buildObjectTree(files))
  if (!found) { throw new Error(`no node ${name}`) }
  return found
}

const order = (yaml: string): string[] => {
  const doc = load(yaml) as { spec?: { widgetData?: { items?: { resourceRefId?: string }[] } } }
  return (doc.spec?.widgetData?.items ?? []).map((i) => i.resourceRefId ?? '')
}

describe('planAdd', () => {
  it('a CONTAINER pick creates a file and places a reference to it', () => {
    const files = draft()
    const plan = planAdd(files, node(files, 'page-x'), { kind: 'container', layout: 'Row', resource: 'rows' }, 'krateo-system')
    expect(plan.ok).toBe(true)
    if (!plan.ok) { return }
    expect(plan.created?.path).toBe('templates/row.page-x-row.yaml')
    expect(plan.created?.content).toContain('kind: Row')
    expect(order(plan.files['templates/flex.page-x.yaml'])).toEqual(['a', 'page-x-row'])
  })

  it('an EXISTING pick creates NOTHING — it references a CR already on the cluster', () => {
    const files = draft()
    const plan = planAdd(files, node(files, 'page-x'), { kind: 'existing', name: 'fleet-card', resource: 'cards' }, 'krateo-system')
    expect(plan.ok).toBe(true)
    if (!plan.ok) { return }
    expect(plan.created).toBeUndefined()
    expect(Object.keys(plan.files)).toEqual(['templates/flex.page-x.yaml'])
    expect(order(plan.files['templates/flex.page-x.yaml'])).toEqual(['a', 'fleet-card'])
  })

  it('places at the requested index', () => {
    const files = draft()
    const plan = planAdd(files, node(files, 'page-x'), { kind: 'existing', name: 'fleet-card', resource: 'cards' }, 'krateo-system', 0)
    expect(plan.ok).toBe(true)
    if (!plan.ok) { return }
    expect(order(plan.files['templates/flex.page-x.yaml'])).toEqual(['fleet-card', 'a'])
  })

  it('names around a collision rather than overwriting a file', () => {
    const files = { ...draft(), 'templates/row.page-x-row.yaml': cr('Row', 'page-x-row') }
    const plan = planAdd(files, node(files, 'page-x'), { kind: 'container', layout: 'Row', resource: 'rows' }, 'krateo-system')
    expect(plan.ok).toBe(true)
    if (!plan.ok) { return }
    expect(plan.created?.path).toBe('templates/row.page-x-row-2.yaml')
  })

  it('refuses a leaf target — a Paragraph holds nothing', () => {
    const files = draft()
    const plan = planAdd(files, node(files, 'p'), { kind: 'existing', name: 'fleet-card', resource: 'cards' }, 'krateo-system')
    expect(plan.ok).toBe(false)
  })

  it('honours what the container declares it holds', () => {
    const files = { ...draft(), 'templates/flex.page-x.yaml': cr('Flex', 'page-x', ['a'], ['rows']) }
    const plan = planAdd(files, node(files, 'page-x'), { kind: 'existing', name: 'fleet-card', resource: 'cards' }, 'krateo-system')
    expect(plan.ok).toBe(false)
    if (plan.ok) { return }
    expect(plan.reason).toMatch(/cannot hold a cards/i)
  })

  it('refuses without a namespace — a placement without one renders an empty slot', () => {
    const files = draft()
    const plan = planAdd(files, node(files, 'page-x'), { kind: 'existing', name: 'fleet-card', resource: 'cards' }, null)
    expect(plan.ok).toBe(false)
    if (plan.ok) { return }
    expect(plan.reason).toMatch(/no namespace/i)
  })

  it('refuses a target the draft does not carry — nothing to rewrite', () => {
    const files = { 'templates/flex.page-x.yaml': cr('Flex', 'page-x', ['ghost']) }
    const plan = planAdd(files, node(files, 'ghost'), { kind: 'existing', name: 'fleet-card', resource: 'cards' }, 'krateo-system')
    expect(plan.ok).toBe(false)
  })
})
