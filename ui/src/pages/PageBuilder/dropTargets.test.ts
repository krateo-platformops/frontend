/**
 * The legality kernel. These tests build REAL trees through `buildObjectTree` rather than
 * hand-rolled TreeNodes, because the properties that decide legality — `drafted`, `kind`, the
 * parent/child shape — are derived there, and a hand-built node could assert a shape the builder
 * never produces.
 */
import { describe, expect, it } from 'vitest'

import { canAccept, legalTargets } from './dropTargets'
import { buildObjectTree, flattenTree } from './objectTree'

/** The `allowedResources` block, or '' when the key should be absent entirely. */
const declaredBlock = (allowed?: readonly string[]): string => {
  if (allowed === undefined) {
    return ''
  }
  if (!allowed.length) {
    return '    allowedResources: []'
  }
  return `    allowedResources:\n${allowed.map((plural) => `      - ${plural}`).join('\n')}`
}

const cr = (kind: string, name: string, children: [string, string][] = [], allowed?: readonly string[]) => {
  const items = children.map(([id]) => `      - resourceRefId: ${id}`).join('\n')
  const refs = children.map(([id, crName]) =>
    `      - id: ${id}\n        name: ${crName}\n        resource: widgets`).join('\n')
  return [
    `kind: ${kind}`,
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    `metadata:\n  name: ${name}`,
    'spec:',
    '  widgetData:',
    // Omitted entirely when undefined, so a test can distinguish ABSENT from declared-and-empty.
    declaredBlock(allowed),
    items ? `    items:\n${items}` : '    items: []',
    '  resourcesRefs:',
    refs ? `    items:\n${refs}` : '    items: []',
  ].filter(Boolean).join('\n')
}

/** A one-container tree whose root declares exactly `allowed`. */
const declaring = (allowed?: readonly string[]) =>
  buildObjectTree({ 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [], allowed) })[0]

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

describe('canAccept — what the container declares it holds', () => {
  it('honours a NON-EMPTY declaration: a plural outside it is refused', () => {
    const flex = declaring(['cards', 'rows'])
    expect(canAccept(flex, 'cards')).toBe(true)
    expect(canAccept(flex, 'inputs')).toBe(false)
  })

  it('a DECLARED but EMPTY list means unconstrained — it is what every new container ships with', () => {
    // newContainerYaml writes `allowedResources: []` because the CRD requires the key. Reading
    // that as a closed set would make every container a person just created accept nothing.
    expect(canAccept(declaring([]), 'cards')).toBe(true)
  })

  it('an ABSENT declaration permits — the author has not said', () => {
    expect(canAccept(declaring(undefined), 'anything-at-all')).toBe(true)
  })

  it('reads the declaration PER CONTAINER, not per kind', () => {
    // The shape the injected kind -> plurals map could not express: two Flexes on one page, each
    // declaring a different slot. This is why the permission is read off the node.
    const roots = buildObjectTree({
      'templates/flex.cards-only.yaml': cr('Flex', 'cards-only', [], ['cards']),
      'templates/flex.rows-only.yaml': cr('Flex', 'rows-only', [], ['rows']),
    })
    const byName = (name: string) => flattenTree(roots).find((node) => node.name === name)!
    expect(canAccept(byName('cards-only'), 'cards')).toBe(true)
    expect(canAccept(byName('cards-only'), 'rows')).toBe(false)
    expect(canAccept(byName('rows-only'), 'rows')).toBe(true)
    expect(canAccept(byName('rows-only'), 'cards')).toBe(false)
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

  it('applies each container\'s own declaration while walking, not only at the top', () => {
    const roots = buildObjectTree({
      'templates/card.inner.yaml': cr('Card', 'inner', [], ['paragraphs']),
      'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['r', 'row-one']], ['rows', 'cards']),
      'templates/row.row-one.yaml': cr('Row', 'row-one', [['c', 'inner']], ['cards']),
    })
    // inner declares paragraphs only, so it drops out even though it is a container deep in the walk.
    expect(named(legalTargets(roots, { plural: 'cards' }))).toEqual(['page-demo', 'row-one'])
  })
})
