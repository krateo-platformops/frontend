/**
 * planMove is the one place a drop is decided, so these tests are mostly about what it REFUSES.
 *
 * Accepting a bad move corrupts the draft silently — a widget placed under a container that cannot
 * render it publishes clean and comes up as a hole — so each refusal below is a real failure mode
 * rather than defensive noise.
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { buildObjectTree } from './objectTree'
import type { TreeNode } from './objectTree'
import { planMove } from './planMove'

const cr = (kind: string, name: string, children: readonly [string, string, string?][] = []) => {
  const lines = [
    `kind: ${kind}`,
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    'metadata:',
    `  name: ${name}`,
    '  namespace: krateo-system',
    'spec:',
    '  widgetData:',
  ]
  lines.push(children.length ? '    items:' : '    items: []')
  children.forEach(([refId]) => lines.push(`      - resourceRefId: ${refId}`))
  lines.push('  resourcesRefs:')
  lines.push(children.length ? '    items:' : '    items: []')
  children.forEach(([refId, crName, resource]) => {
    lines.push(`      - id: ${refId}`)
    lines.push(`        name: ${crName}`)
    lines.push('        namespace: krateo-system')
    lines.push(`        resource: ${resource ?? 'cards'}`)
    lines.push('        verb: GET')
  })
  return lines.join('\n')
}

/** Flex page-demo > [ Row row-one > [ Card inner ], Card loose ] */
const draft = (): Record<string, string> => ({
  'templates/card.inner.yaml': cr('Card', 'inner'),
  'templates/card.loose.yaml': cr('Card', 'loose'),
  'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['r', 'row-one', 'rows'], ['l', 'loose']]),
  'templates/row.row-one.yaml': cr('Row', 'row-one', [['c', 'inner']]),
})

const find = (roots: readonly TreeNode[], name: string): TreeNode => {
  const walk = (nodes: readonly TreeNode[]): TreeNode | undefined => {
    for (const node of nodes) {
      if (node.name === name) { return node }
      const hit = walk(node.children)
      if (hit) { return hit }
    }
    return undefined
  }
  const found = walk(roots)
  if (!found) { throw new Error(`no node named ${name}`) }
  return found
}

const itemIds = (yaml: string): string[] => {
  const doc = load(yaml) as { spec?: { widgetData?: { items?: { resourceRefId?: string }[] } } }
  return (doc.spec?.widgetData?.items ?? []).map((item) => item.resourceRefId ?? '')
}

describe('planMove', () => {
  it('moves a child from one container to another, rewriting BOTH files', () => {
    const files = draft()
    const roots = buildObjectTree(files)
    const plan = planMove(files, roots, find(roots, 'inner'), find(roots, 'page-demo'))
    expect(plan.ok).toBe(true)
    if (!plan.ok) { return }
    // left the row…
    expect(itemIds(plan.files['templates/row.row-one.yaml'])).toEqual([])
    // …and joined the page
    expect(itemIds(plan.files['templates/flex.page-demo.yaml'])).toContain('inner')
    // only the two touched files come back
    expect(Object.keys(plan.files).sort()).toEqual(['templates/flex.page-demo.yaml', 'templates/row.row-one.yaml'])
  })

  it('reorders within the same parent — from and to being one file is a legitimate move', () => {
    const files = draft()
    const roots = buildObjectTree(files)
    const plan = planMove(files, roots, find(roots, 'loose'), find(roots, 'page-demo'))
    expect(plan.ok).toBe(true)
    if (!plan.ok) { return }
    // still there, and now last — dropping a child back on its own container means "move to the end"
    expect(itemIds(plan.files['templates/flex.page-demo.yaml'])).toEqual(['r', 'loose'])
  })

  it('refuses to drop a container into its own subtree', () => {
    const files = draft()
    const roots = buildObjectTree(files)
    // row-one holds inner; dropping row-one INTO inner would detach the branch from the page.
    const plan = planMove(files, roots, find(roots, 'row-one'), find(roots, 'inner'))
    expect(plan.ok).toBe(false)
    if (plan.ok) { return }
    expect(plan.reason).toMatch(/cannot hold|into itself/i)
  })

  it('refuses to drop a node onto itself', () => {
    const files = draft()
    const roots = buildObjectTree(files)
    const row = find(roots, 'row-one')
    const plan = planMove(files, roots, row, row)
    expect(plan.ok).toBe(false)
    if (plan.ok) { return }
    expect(plan.reason).toMatch(/into itself/i)
  })

  it('honours the CRD enum — a target that declares it cannot hold this plural refuses it', () => {
    const files = draft()
    const roots = buildObjectTree(files)
    const plan = planMove(files, roots, find(roots, 'inner'), find(roots, 'page-demo'), { Flex: ['rows'], Row: ['cards'] })
    expect(plan.ok).toBe(false)
    if (plan.ok) { return }
    expect(plan.reason).toMatch(/cannot hold a cards/i)
  })

  it('refuses a leaf as a target — a Card is not a container', () => {
    const files = { ...draft(), 'templates/paragraph.p.yaml': cr('Paragraph', 'p') }
    const roots = buildObjectTree(files)
    const plan = planMove(files, roots, find(roots, 'loose'), find(roots, 'p'))
    expect(plan.ok).toBe(false)
  })

  it('refuses a target the draft does not carry — there is no file to place a child in', () => {
    // `ghost` is referenced but has no file: an existing cluster widget.
    const files = { 'templates/card.loose.yaml': cr('Card', 'loose'), 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['g', 'ghost'], ['l', 'loose']]) }
    const roots = buildObjectTree(files)
    const plan = planMove(files, roots, find(roots, 'loose'), find(roots, 'ghost'))
    expect(plan.ok).toBe(false)
    if (plan.ok) { return }
    expect(plan.reason).toMatch(/not carried in this draft|cannot hold/i)
  })

  it('refuses to move a root — nothing places it, so there is no reference to move', () => {
    const files = draft()
    const roots = buildObjectTree(files)
    const plan = planMove(files, roots, find(roots, 'page-demo'), find(roots, 'row-one'))
    expect(plan.ok).toBe(false)
    if (plan.ok) { return }
    expect(plan.reason).toMatch(/page root/i)
  })

  it('refuses when the reference declares no resource — the draft cannot say what it is', () => {
    const files = draft()
    // strip the plural from the row's reference to `inner`
    files['templates/row.row-one.yaml'] = files['templates/row.row-one.yaml'].replace('        resource: cards\n', '')
    const roots = buildObjectTree(files)
    const plan = planMove(files, roots, find(roots, 'inner'), find(roots, 'page-demo'))
    expect(plan.ok).toBe(false)
    if (plan.ok) { return }
    expect(plan.reason).toMatch(/no resource declared/i)
  })

  it('refuses when the reference declares no namespace — re-placing it would render a hole', () => {
    const files = draft()
    files['templates/row.row-one.yaml'] = files['templates/row.row-one.yaml'].replace('        namespace: krateo-system\n', '')
    const roots = buildObjectTree(files)
    const plan = planMove(files, roots, find(roots, 'inner'), find(roots, 'page-demo'))
    expect(plan.ok).toBe(false)
    if (plan.ok) { return }
    expect(plan.reason).toMatch(/no namespace declared/i)
  })

  it('REFUSES A MOVE WHOSE PLACEMENT NO LONGER EXISTS — the reference was removed mid-drag', () => {
    // The staleness that actually corrupts a draft: the tree still believes `inner` sits at index 0
    // of row-one under id "c", but the Files tab has since emptied that container. Removing "index
    // 0" blindly would delete whatever moved into that slot. ChildAt pins the id to the index, so
    // the whole transaction is refused instead.
    const planned = draft()
    const roots = buildObjectTree(planned)
    const moving = find(roots, 'inner')
    const target = find(roots, 'page-demo')

    const newer = { ...planned, 'templates/row.row-one.yaml': cr('Row', 'row-one') }
    const plan = planMove(newer, roots, moving, target)
    expect(plan.ok).toBe(false)
    if (plan.ok) { return }
    expect(plan.reason).toMatch(/no longer placed|changed under/i)
  })

  it('REFUSES when a DIFFERENT widget now occupies the planned slot', () => {
    // Worse than an empty container and the reason the id is pinned rather than just the index:
    // row-one still has a child at index 0, but it is not the one that was dragged.
    const planned = draft()
    const roots = buildObjectTree(planned)
    const moving = find(roots, 'inner')
    const target = find(roots, 'page-demo')

    const newer = {
      ...planned,
      'templates/card.other.yaml': cr('Card', 'other'),
      'templates/row.row-one.yaml': cr('Row', 'row-one', [['z', 'other']]),
    }
    const plan = planMove(newer, roots, moving, target)
    expect(plan.ok).toBe(false)
    if (plan.ok) { return }
    expect(plan.reason).toMatch(/changed under|no longer placed/i)
  })
})
