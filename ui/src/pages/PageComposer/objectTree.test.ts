/**
 * The tree is the thing the flat builder could never express, so these tests are mostly about
 * NESTING and about the cases a real page hits: children that are not in the draft, a file being
 * edited into invalidity, and a cycle a hand-edit can create.
 */
import { describe, expect, it } from 'vitest'

import { buildObjectTree, draftNamespace, flattenTree } from './objectTree'

const cr = (kind: string, name: string, opts: {
  apiRef?: boolean
  // [refId, crName]
  children?: [string, string][]
} = {}) => {
  const items = (opts.children ?? []).map(([id]) => `      - resourceRefId: ${id}`).join('\n')
  const refs = (opts.children ?? []).map(([id, crName]) =>
    `      - id: ${id}\n        name: ${crName}\n        resource: widgets`).join('\n')
  return [
    `kind: ${kind}`,
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    `metadata:\n  name: ${name}`,
    'spec:',
    opts.apiRef ? '  apiRef:\n    name: some-restaction' : null,
    '  widgetData:',
    items ? `    items:\n${items}` : '    items: []',
    '  resourcesRefs:',
    refs ? `    items:\n${refs}` : '    items: []',
  ].filter(Boolean).join('\n')
}

describe('buildObjectTree', () => {
  it('nests — the thing a flat page could never express', () => {
    const tree = buildObjectTree({
      'a/flex.page-x.yaml': cr('Flex', 'page-x', { children: [['row', 'row-top']] }),
      'a/row.row-top.yaml': cr('Row', 'row-top', { children: [['stat', 'stat-ready']] }),
      'a/statistic.stat-ready.yaml': cr('Statistic', 'stat-ready'),
    })

    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('page-x')
    expect(tree[0].children[0].name).toBe('row-top')
    expect(tree[0].children[0].children[0].name).toBe('stat-ready')
    expect(tree[0].children[0].children[0].kind).toBe('Statistic')
  })

  it('keeps the author’s order, which IS the rendered order', () => {
    const tree = buildObjectTree({
      'p.yaml': cr('Flex', 'page-x', { children: [['c', 'third'], ['a', 'first'], ['b', 'second']] }),
    })

    expect(tree[0].children.map((child) => child.name)).toEqual(['third', 'first', 'second'])
  })

  it('resolves a refId that differs from the CR name', () => {
    // id and name usually coincide and nothing requires it. Assuming they match would flatten
    // any page that names them differently.
    const tree = buildObjectTree({
      'p.yaml': cr('Flex', 'page-x', { children: [['left-slot', 'compositions-table']] }),
      't.yaml': cr('Table', 'compositions-table'),
    })

    expect(tree[0].children[0].name).toBe('compositions-table')
    expect(tree[0].children[0].kind).toBe('Table')
  })

  it('shows a PLACED widget that is not in the draft', () => {
    // "Compose a page" places widgets that already exist on the cluster. Dropping them would hide
    // most of a composed page — you could not reorder or remove what you cannot see.
    const tree = buildObjectTree({
      'p.yaml': cr('Flex', 'page-x', { children: [['t', 'existing-table']] }),
    })

    expect(tree[0].children[0]).toMatchObject({ drafted: false, kind: null, name: 'existing-table', path: null })
  })

  it('marks data-bound objects, which is the half the builder could not reach', () => {
    const tree = buildObjectTree({
      'p.yaml': cr('Flex', 'page-x', { children: [['t', 'bound-table'], ['p2', 'static-para']] }),
      'para.yaml': cr('Paragraph', 'static-para'),
      't.yaml': cr('Table', 'bound-table', { apiRef: true }),
    })

    const [bound, statik] = tree[0].children
    expect(bound.bound).toBe(true)
    expect(statik.bound).toBe(false)
  })

  it('omits a file that is mid-edit rather than throwing', () => {
    // The Files tab lets you type invalid YAML. The panel must not take the page down with it.
    const tree = buildObjectTree({
      'broken.yaml': 'kind: Flex\n  bad indent: [',
      'p.yaml': cr('Flex', 'page-x'),
    })

    expect(tree.map((node) => node.name)).toEqual(['page-x'])
  })

  it('survives a cycle a hand-edit can create', () => {
    // The cycle must be REACHABLE FROM A ROOT or the guard is never reached. The earlier version
    // of this test was a bare a↔b pair: both are referenced, so neither is a root, the forest came
    // back empty without `toNode` ever being called, and the recursion guard it was named after
    // went untested. `page-x` is the root that actually walks into the loop.
    const tree = buildObjectTree({
      'a.yaml': cr('Flex', 'a', { children: [['b', 'b']] }),
      'b.yaml': cr('Flex', 'b', { children: [['a', 'a']] }),
      'p.yaml': cr('Flex', 'page-x', { children: [['a', 'a']] }),
    })

    // Terminated, and stopped at the repeat rather than dropping the branch: page-x → a → b → a,
    // where the second `a` is rendered as a leaf. A cycle used to be the one input that could
    // freeze the panel.
    expect(tree.map((node) => node.name)).toEqual(['page-x'])
    const [first] = tree[0].children
    expect(first.name).toBe('a')
    expect(first.children.map((node) => node.name)).toEqual(['b'])
    expect(first.children[0].children.map((node) => node.name)).toEqual(['a'])
    expect(first.children[0].children[0].children).toEqual([])
  })

  it('carries the refId the parent addresses a child by, not just the resolved name', () => {
    // resourcesRefs maps an id to a CR name and nothing requires them to match. A structural edit
    // matched on the NAME refused every edit on a page that names them apart.
    const tree = buildObjectTree({
      'p.yaml': cr('Flex', 'page-x', { children: [['slot-1', 'fleet-table']] }),
      't.yaml': cr('Table', 'fleet-table'),
    })
    const [child] = tree[0].children

    expect(child.name).toBe('fleet-table')
    expect(child.refId).toBe('slot-1')
    expect(child.position).toBe(0)
  })

  it('gives each placement its own position, so a repeated widget is addressable', () => {
    const tree = buildObjectTree({
      'p.yaml': cr('Flex', 'page-x', { children: [['a', 'divider'], ['b', 'divider']] }),
    })

    expect(tree[0].children.map((child) => child.position)).toEqual([0, 1])
    expect(tree[0].children.map((child) => child.refId)).toEqual(['a', 'b'])
  })

  it('surfaces an orphan rather than hiding it', () => {
    const tree = buildObjectTree({
      'orphan.yaml': cr('Card', 'left-over'),
      'p.yaml': cr('Flex', 'page-x'),
    })

    // A half-finished edit leaves objects nothing references. Seeing them is how you notice.
    expect(tree.map((node) => node.name).sort()).toEqual(['left-over', 'page-x'])
  })

  it('places the same existing widget twice when a page does', () => {
    const tree = buildObjectTree({
      'p.yaml': cr('Flex', 'page-x', { children: [['a', 'divider'], ['b', 'divider']] }),
    })

    expect(tree[0].children.map((child) => child.name)).toEqual(['divider', 'divider'])
  })

  it('flattens depth-first for counting and selection', () => {
    const tree = buildObjectTree({
      'p.yaml': cr('Flex', 'page-x', { children: [['r', 'row-top']] }),
      'r.yaml': cr('Row', 'row-top', { children: [['s', 'stat']] }),
      's.yaml': cr('Statistic', 'stat'),
    })

    expect(flattenTree(tree).map((node) => node.name)).toEqual(['page-x', 'row-top', 'stat'])
  })

  it('returns nothing for an empty draft', () => {
    expect(buildObjectTree({})).toEqual([])
  })
})

describe('parentPath — the file a move or remove has to rewrite', () => {
  it('points a child at the file that PLACES it, not its own', () => {
    // A child is a reference held by its parent, so reordering or removing it rewrites the PARENT.
    // Using the child's own path would edit the wrong file and leave the placement untouched.
    const tree = buildObjectTree({
      'a/flex.page-x.yaml': cr('Flex', 'page-x', { children: [['r', 'row-top']] }),
      'a/row.row-top.yaml': cr('Row', 'row-top', { children: [['s', 'stat']] }),
      'a/statistic.stat.yaml': cr('Statistic', 'stat'),
    })

    expect(tree[0].parentPath).toBeNull()
    expect(tree[0].children[0].parentPath).toBe('a/flex.page-x.yaml')
    expect(tree[0].children[0].children[0].parentPath).toBe('a/row.row-top.yaml')
  })

  it('gives a placed (undrafted) child a parent too, so it can still be removed', () => {
    const tree = buildObjectTree({
      'a/flex.page-x.yaml': cr('Flex', 'page-x', { children: [['t', 'existing']] }),
    })

    expect(tree[0].children[0]).toMatchObject({ drafted: false, parentPath: 'a/flex.page-x.yaml' })
  })
})

describe('draftNamespace', () => {
  const inNs = (name: string, namespace?: string) => [
    'kind: Flex',
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    `metadata:\n  name: ${name}${namespace ? `\n  namespace: ${namespace}` : ''}`,
    'spec:\n  widgetData:\n    items: []',
  ].join('\n')

  it('reads the namespace new objects must join from the draft itself', () => {
    expect(draftNamespace({ 'a.yaml': inNs('a', 'krateo-system') })).toBe('krateo-system')
  })

  it('takes the majority, so one stray object cannot move where new ones are created', () => {
    expect(draftNamespace({
      'a.yaml': inNs('a', 'krateo-system'),
      'b.yaml': inNs('b', 'krateo-system'),
      'c.yaml': inNs('c', 'somewhere-else'),
    })).toBe('krateo-system')
  })

  it('returns null when the draft declares none, so the caller refuses rather than guessing', () => {
    // A guessed namespace publishes clean and renders nothing — the most expensive failure here.
    expect(draftNamespace({ 'a.yaml': inNs('a') })).toBeNull()
  })
})
