/**
 * NAMED SLOTS — the third containment shape, which the composer could not see.
 *
 * A container holds an ordered `items[]`. A Card ALSO has `cover` and `extraRefId`; a Layout holds
 * its children entirely through `content`, `header` and `footer`. Each is one property carrying one
 * `resourceRefId`. So a Card with a cover was drawn as a Card with nothing in it — a view whose
 * stated rule is that it derives everything from the draft's bytes, omitting a whole containment
 * shape.
 */
import { describe, expect, it } from 'vitest'

import { buildObjectTree, flattenTree } from './objectTree'
import { WIDGET_KINDS } from './widgetKinds.generated'

const cardWithCover = () => ({
  'templates/card.panel.yaml': [
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    'kind: Card',
    'metadata:\n  name: panel\n  namespace: krateo-system',
    'spec:\n  widgetData:',
    '    allowedResources: []',
    '    cover: hero',
    '    items:\n      - resourceRefId: body',
    '  resourcesRefs:',
    '    items:',
    '      - id: hero\n        name: hero-image\n        resource: images\n        namespace: krateo-system',
    '      - id: body\n        name: body-text\n        resource: paragraphs\n        namespace: krateo-system',
  ].join('\n'),
})

describe('the generated slot table', () => {
  it('finds exactly the five single-reference slots the CRDs describe', () => {
    const withSlots = Object.entries(WIDGET_KINDS)
      .filter(([, kind]) => kind.slots.length)
      .map(([name, kind]) => `${name}:${[...kind.slots].join('+')}`)
      .sort()
    expect(withSlots).toEqual(['Card:cover+extraRefId', 'Layout:content+footer+header'])
  })

  it('does not mistake an ordinary string for a slot', () => {
    // The marker is a description naming `resourceRefId`, so a Card's `title` — a plain string —
    // must not be offered as somewhere to put a widget.
    expect(WIDGET_KINDS.Card.slots).not.toContain('title')
    expect(WIDGET_KINDS.Table.slots).toHaveLength(0)
  })
})

describe('a slot child in the tree', () => {
  const nodes = () => flattenTree(buildObjectTree(cardWithCover()))

  it('APPEARS — it did not, and the projection was incomplete', () => {
    expect(nodes().map((node) => node.name)).toContain('hero-image')
  })

  it('says which slot it fills, because that decides how it behaves', () => {
    const hero = nodes().find((node) => node.name === 'hero-image')
    expect(hero?.slot).toBe('cover')
    // …and an ordered child is still an ordered child.
    expect(nodes().find((node) => node.name === 'body-text')?.slot).toBeNull()
  })

  it('resolves its name and plural through resourcesRefs like any other child', () => {
    const hero = nodes().find((node) => node.name === 'hero-image')
    expect(hero?.resource).toBe('images')
    expect(hero?.namespace).toBe('krateo-system')
  })

  it('carries a position that does NOT address it in items — which is why edits must refuse', () => {
    /*
     * The trap this whole shape creates. A slot child has a `position` because it is among its
     * parent's children in the TREE; it is not in `widgetData.items` at all. Removing or reordering
     * by that index would edit whichever ordered child sits there — here, the body text.
     */
    const hero = nodes().find((node) => node.name === 'hero-image')
    const body = nodes().find((node) => node.name === 'body-text')
    expect(hero?.position).toBe(0)
    // The ordered child at items[0] is the BODY, not the cover.
    expect(body?.slot).toBeNull()
    expect(hero?.slot).toBe('cover')
  })
})
