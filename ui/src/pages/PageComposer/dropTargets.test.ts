/**
 * The legality kernel. These tests build REAL trees through `buildObjectTree` rather than
 * hand-rolled TreeNodes, because the properties that decide legality — `drafted`, `kind`, the
 * parent/child shape — are derived there, and a hand-built node could assert a shape the builder
 * never produces.
 */
import { describe, expect, it } from 'vitest'

import { canAccept, legalTargets } from './dropTargets'
import { buildObjectTree, flattenTree } from './objectTree'

const cr = (kind: string, name: string, children: [string, string][] = []) => {
  const items = children.map(([id]) => `      - resourceRefId: ${id}`).join('\n')
  const refs = children.map(([id, crName]) =>
    `      - id: ${id}\n        name: ${crName}\n        resource: widgets`).join('\n')
  return [
    `kind: ${kind}`,
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    `metadata:\n  name: ${name}`,
    'spec:',
    '  widgetData:',
    items ? `    items:\n${items}` : '    items: []',
    '  resourcesRefs:',
    refs ? `    items:\n${refs}` : '    items: []',
  ].join('\n')
}

/** root Flex > [ Row > [ Card ], Paragraph ] */
const page = () => buildObjectTree({
  'templates/card.inner.yaml': cr('Card', 'inner'),
  'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['r', 'row-one'], ['p', 'para-one']]),
  'templates/paragraph.para-one.yaml': cr('Paragraph', 'para-one'),
  'templates/row.row-one.yaml': cr('Row', 'row-one', [['c', 'inner']]),
})

const named = (nodes: readonly { name: string }[]) => nodes.map((node) => node.name).sort()
const find = (name: string) => flattenTree(page()).find((node) => node.name === name)!

describe('canAccept — type legality and editability', () => {
  it('a container kind accepts; a leaf kind never does', () => {
    expect(canAccept(find('page-demo'), 'cards')).toBe(true)
    expect(canAccept(find('row-one'), 'cards')).toBe(true)
    // Paragraph holds no items and has no allowedResources — it can never take a child.
    expect(canAccept(find('para-one'), 'cards')).toBe(false)
  })

  it('Card is a container too — it is in LAYOUT_KINDS, despite reading like a leaf', () => {
    expect(canAccept(find('inner'), 'paragraphs')).toBe(true)
  })

  it('refuses a node the draft does not carry — there is no file to rewrite', () => {
    // 'ghost' is REFERENCED by the root but no file defines it: an existing cluster widget.
    // Placing a child rewrites the PARENT's file, so a parent with no file cannot take one.
    const tree = buildObjectTree({
      'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['g', 'ghost']]),
    })
    const ghost = flattenTree(tree).find((node) => node.name === 'ghost')!
    expect(ghost.drafted).toBe(false)
    expect(canAccept(ghost, 'cards')).toBe(false)
  })

  it('an empty plural is never acceptable', () => {
    expect(canAccept(find('page-demo'), '')).toBe(false)
  })
})

describe('canAccept — the CRD allowedResources enum', () => {
  it('honours a declared enum: a plural outside it is refused', () => {
    const permitted = { Flex: ['cards', 'rows'] }
    expect(canAccept(find('page-demo'), 'cards', permitted)).toBe(true)
    // the case PageSearch.tsx is blocked on: `inputs` is not in the Flex enum
    expect(canAccept(find('page-demo'), 'inputs', permitted)).toBe(false)
  })

  it('a DECLARED but empty enum means holds nothing — not unknown', () => {
    expect(canAccept(find('page-demo'), 'cards', { Flex: [] })).toBe(false)
  })

  it('an UNKNOWN enum permits — a canvas with no legal target is indistinguishable from broken', () => {
    // Before CRD discovery the caller supplies nothing; downstream validation still rejects a
    // genuinely bad placement, so this errs toward a usable canvas rather than a dead one.
    expect(canAccept(find('page-demo'), 'anything-at-all')).toBe(true)
    expect(canAccept(find('page-demo'), 'cards', { Row: ['cards'] })).toBe(true)
  })
})

describe('legalTargets — cycles and reparenting', () => {
  it('lists every container and no leaf', () => {
    expect(named(legalTargets(page(), { plural: 'cards' }))).toEqual(['inner', 'page-demo', 'row-one'])
  })

  it('a node may not be dropped into ITSELF', () => {
    const tree = page()
    const row = flattenTree(tree).find((node) => node.name === 'row-one')!
    expect(named(legalTargets(tree, { node: row, plural: 'rows' }))).not.toContain('row-one')
  })

  it('a node may not be dropped into its own DESCENDANT — that stops being a tree', () => {
    const tree = page()
    const row = flattenTree(tree).find((node) => node.name === 'row-one')!
    const targets = named(legalTargets(tree, { node: row, plural: 'rows' }))
    // inner is under row-one
    expect(targets).not.toContain('inner')
    expect(targets).toEqual(['page-demo'])
  })

  it('a node MAY be dropped into its current parent — that is a reorder, not a cycle', () => {
    const tree = page()
    const row = flattenTree(tree).find((node) => node.name === 'row-one')!
    expect(named(legalTargets(tree, { node: row, plural: 'rows' }))).toContain('page-demo')
  })

  it('a NEW widget from the palette excludes nothing — it is under no parent yet', () => {
    expect(named(legalTargets(page(), { plural: 'cards' }))).toEqual(['inner', 'page-demo', 'row-one'])
  })

  it('applies the enum while walking, not only per node', () => {
    const targets = named(legalTargets(page(), { plural: 'cards' }, { Card: [], Flex: ['cards'], Row: ['cards'] }))
    expect(targets).toEqual(['page-demo', 'row-one'])
  })
})
