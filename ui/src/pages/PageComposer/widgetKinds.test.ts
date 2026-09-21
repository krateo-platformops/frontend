/**
 * What the generated kind table must be TRUE about, independent of how it was generated.
 *
 * The table replaces four hand-maintained facts that had each drifted from the CRDs. A generator
 * that silently produced an empty or wrong table would be a worse version of the same problem, so
 * these assert the properties that made the hand-maintained versions wrong in the first place.
 */
import { describe, expect, it } from 'vitest'

import { LAYOUT_KINDS } from './structureEdit'
import { WIDGET_KINDS } from './widgetKinds.generated'

const containers = Object.entries(WIDGET_KINDS).filter(([, kind]) => kind.container).map(([name]) => name)

describe('the widget kind table, derived from the CRDs', () => {
  it('covers every widget CRD, not the seven the palette could reach', () => {
    // The palette offered 7 placeable kinds and 5 creatable containers against 44 that exist.
    expect(Object.keys(WIDGET_KINDS)).toHaveLength(44)
  })

  it('finds ELEVEN containers, and the composer knew five of them', () => {
    expect(containers.sort()).toEqual([
      'ButtonGroup', 'Card', 'Col', 'Filters', 'Flex', 'Form', 'Menu', 'PageHeader', 'Row', 'Steps', 'Tabs',
    ])
    // Everything the old literal claimed is still a container — this widens, it does not reclassify.
    for (const known of Object.keys(LAYOUT_KINDS)) {
      expect(containers).toContain(known)
    }
  })

  it('does NOT count a kind that merely declares allowedResources', () => {
    /*
     * Table, Breadcrumb and Descriptions carry `allowedResources` while holding no child
     * references. A containment test that grepped for that field — the obvious one — would make
     * them drop targets that accept a drop, gain a resourcesRefs entry and render nothing: the
     * failure structureEdit calls the worst available, because the page publishes clean and comes
     * up with a hole in it.
     */
    for (const notAContainer of ['Table', 'Breadcrumb', 'Descriptions', 'Layout']) {
      expect(WIDGET_KINDS[notAContainer]?.container).toBe(false)
    }
  })

  it('PageHeader is a container — the composer has been treating it as a leaf', () => {
    // Every draft startDraft seeds contains one, and it could never take a child by any route.
    expect(WIDGET_KINDS.PageHeader.container).toBe(true)
  })

  it('carries the required fields a drop has to ask for before it can create one', () => {
    // 37 of 44 kinds require something, and they are not cosmetic. One skeleton cannot serve them.
    expect(WIDGET_KINDS.BarChart.required).toEqual(expect.arrayContaining(['data', 'xField', 'yField']))
    expect(WIDGET_KINDS.Button.required).toEqual(expect.arrayContaining(['actions', 'clickActionId']))
    expect(WIDGET_KINDS.Select.required).toEqual(expect.arrayContaining(['name', 'options']))

    const demanding = Object.values(WIDGET_KINDS).filter((kind) => kind.required.length > 0)
    expect(demanding.length).toBeGreaterThan(30)
  })

  it('carries a schema for every kind, because the drop form renders it', () => {
    for (const [name, kind] of Object.entries(WIDGET_KINDS)) {
      expect(kind.schema, name).toBeTruthy()
      expect(kind.plural, name).toMatch(/^[a-z]+$/)
    }
  })

  it('agrees with the old literal about the plurals it knew', () => {
    // A generated plural that disagreed with the hand-written one would be a silent re-route of
    // every existing drop; lowercase(kind)+"s" is wrong for a good number of kinds.
    for (const [kind, plural] of Object.entries(LAYOUT_KINDS)) {
      expect(WIDGET_KINDS[kind].plural).toBe(plural)
    }
  })
})
