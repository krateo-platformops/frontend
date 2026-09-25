/**
 * What a seeded draft must be for the rest of the machinery to accept it.
 *
 * Three separate contracts meet here, and none of them is visible from the shape of the object:
 * the apiserver's (required fields the widget CRDs do not default), previewPageV2's (a root named
 * `page-<slug>` or the sandbox refuses the whole set), and pageDraft's (the same name is how the
 * nav fragment learns its slug). Each has its own test, because each fails differently.
 */
import { describe, expect, it } from 'vitest'

import { canAccept } from './dropTargets'
import { startDraft, validateStartDraft } from './startDraft'

const seed = (over = {}) => {
  const result = startDraft({ namespace: 'krateo-system', slug: 'fleet-health', ...over })
  if (!result.ok) {
    throw new Error(`expected success, got: ${result.error}`)
  }
  return result.widgets as Record<string, never>[]
}

describe('startDraft — the seed the cluster accepts', () => {
  it('names the root page-<slug> EXACTLY, which is the page entry', () => {
    const [root] = seed()

    // previewPageV2 refuses a draft set with no `page-<slug>` root ("the page ENTRY is undefined")
    // and pageRootSlug reads the nav fragment's slug back out of this name. Rename it and the
    // sandbox preview and the sidebar entry both break, in unrelated-looking ways.
    expect(root.kind).toBe('Flex')
    expect((root.metadata as { name: string }).name).toBe('page-fleet-health')
  })

  it('gives the PageHeader a resourcesRefs, which the CRD requires of a widget with no children', () => {
    const [, header] = seed()

    // Caught by a server dry-run, not by this file: "The PageHeader ... is invalid:
    // spec.resourcesRefs: Required value". It holds nothing — the field's PRESENCE is the check.
    expect((header.spec as { resourcesRefs: { items: [] } }).resourcesRefs).toEqual({ items: [] })
  })

  it('places the header through all three places a child lives', () => {
    const [root] = seed()
    const spec = root.spec as {
      resourcesRefs: { items: { id: string; namespace: string }[] }
      widgetData: { allowedResources: string[]; items: { resourceRefId: string }[] }
    }

    // The ordered reference, the entry that resolves it, and the plural the container must declare.
    // Two out of three renders an empty slot; the CRD only catches the third.
    expect(spec.widgetData.items).toEqual([{ resourceRefId: 'page-fleet-health-header' }])
    expect(spec.resourcesRefs.items[0].id).toBe('page-fleet-health-header')
    // UNCONSTRAINED, not ['pageheaders']. Declaring the one child a new page ships with made
    // `canAccept` refuse every drop — the page accepted only its own header and the palette had
    // nowhere to go. `[]` is what every container a person creates starts at: the CRD requires the
    // key, and an empty list means the author has not said yet.
    expect(spec.widgetData.allowedResources).toEqual([])
  })

  it('a started page ACCEPTS a palette drop — the gesture the builder exists for', () => {
    const [root] = seed()
    const node = {
      allowedResources: (root.spec as { widgetData: { allowedResources: string[] } }).widgetData.allowedResources,
      children: [],
      drafted: true,
      kind: 'Flex',
      name: 'page-fleet-health',
      path: 'templates/flex.page-fleet-health.yaml',
    } as unknown as Parameters<typeof canAccept>[0]

    // The regression this pins: with ['pageheaders'] every one of these was false, so a brand-new
    // page was a canvas nothing could be dropped onto.
    expect(canAccept(node, 'rows')).toBe(true)
    expect(canAccept(node, 'cards')).toBe(true)
    expect(canAccept(node, 'tables')).toBe(true)
    expect(canAccept(node, 'pageheaders')).toBe(true)
  })

  it('namespaces BOTH objects and the ref entry — no defaulting exists for any of them', () => {
    const [root, header] = seed()
    const refs = (root.spec as { resourcesRefs: { items: { namespace: string }[] } }).resourcesRefs

    expect((root.metadata as { namespace: string }).namespace).toBe('krateo-system')
    expect((header.metadata as { namespace: string }).namespace).toBe('krateo-system')
    // snowplow's resolver puts this straight into the /call query; absent, the child never renders
    // and the page still publishes clean.
    expect(refs.items[0].namespace).toBe('krateo-system')
  })

  it('titles the header from the slug when none is given', () => {
    expect(((seed()[1].spec as { widgetData: { title: string } }).widgetData.title)).toBe('Fleet Health')
  })

  it('prefers the title the author typed', () => {
    const [, header] = seed({ title: 'Fleet health (EU)' })

    expect((header.spec as { widgetData: { title: string } }).widgetData.title).toBe('Fleet health (EU)')
  })

  it('seeds NOTHING else — what goes on the page is the next decision', () => {
    // A seeded chart or table would look chosen when it was guessed.
    expect(seed()).toHaveLength(2)
  })

  describe('nav discovery — the annotations that decide whether the page can be REACHED', () => {
    const annotations = () =>
      (seed()[0].metadata as { annotations: Record<string, string> }).annotations

    it('gives the page root a nav-path — without it the Menu cannot find the page AT ALL', () => {
      // restaction.sidebar-nav keeps only roots whose `krateo.io/nav-path` is set and non-empty
      // (`select($a["krateo.io/nav-path"] != null and != "")`). There are no static menu entries to
      // fall back on. A page missing this installs healthy, passes every check, and is unreachable —
      // no link, no error, nothing to notice. #275 removed the nav FRAGMENT that used to carry this
      // (portal#217 stopped globbing it); these annotations are what took its place.
      expect(annotations()['krateo.io/nav-path']).toBe('/fleet-health')
    })

    it('labels the entry with the page TITLE, not the slug', () => {
      expect(annotations()['krateo.io/nav-label']).toBe('Fleet Health')
    })

    it('writes the order out explicitly, at the RA default', () => {
      // `("krateo.io/nav-order" // "100") | tonumber` — so 100 changes nothing, and that is the
      // point: the knob is visible to whoever opens the CR instead of being an absent default.
      expect(annotations()['krateo.io/nav-order']).toBe('100')
    })

    it('guesses NO icon and NO group — the RA omits what is absent', () => {
      // Both are optional in the RA's jq. An invented icon or a section the page does not belong to
      // is worse than an unadorned top-level entry.
      //
      // Scoped to the NAV annotations rather than to every key: the root also carries the composer's
      // allowed-resources provenance marker, which is not a nav concern and is asserted below.
      expect(Object.keys(annotations()).filter((key) => key.startsWith('krateo.io/nav')).sort())
        .toEqual(['krateo.io/nav-label', 'krateo.io/nav-order', 'krateo.io/nav-path'])
    })

    it('marks its own allowedResources as DERIVED — the list it grows is not a declaration', () => {
      // The root starts `allowedResources: []` and `placeChild` must append each child's plural or
      // the child will not render. Without this marker the first Row dropped in leaves a one-entry
      // list that `canAccept` reads as intent, and the page silently accepts nothing else.
      expect(annotations()['krateo.io/allowed-resources']).toBe('derived')
    })
  })
})

describe('validateStartDraft', () => {
  it.each([
    ['upper case', 'Fleet-Health'],
    ['a space', 'fleet health'],
    ['a leading dash', '-fleet'],
    ['empty', ''],
  ])('refuses %s — it becomes a URL and two resource names', (_label, slug) => {
    expect(validateStartDraft({ namespace: 'krateo-system', slug })).toContain('lower-case')
  })

  it('refuses a missing namespace rather than defaulting one', () => {
    // A guessed namespace publishes clean and renders nothing — the most expensive failure here.
    expect(validateStartDraft({ namespace: '', slug: 'ok' })).toContain('namespace')
  })

  it('accepts the real shape', () => {
    expect(validateStartDraft({ namespace: 'krateo-system', slug: 'fleet-health' })).toBeNull()
  })

  it('refuses a slug the page set\'s chart could never register or publish — where it is typed', () => {
    // The slug names the page set's chart, the Kind its CompositionDefinition registers, and the
    // claim publish-<slug> — which core-provider refuses over 44 characters.
    expect(validateStartDraft({ namespace: 'krateo-system', slug: '9-lives' })).toContain('must start with a letter')
    expect(validateStartDraft({ namespace: 'krateo-system', slug: `a${'b'.repeat(35)}` })).toBeNull()
    expect(validateStartDraft({ namespace: 'krateo-system', slug: `a${'b'.repeat(36)}` })).toContain('at most 36 characters to publish')
  })
})
