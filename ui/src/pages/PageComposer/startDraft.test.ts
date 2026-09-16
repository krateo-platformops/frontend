/**
 * What a seeded draft must be for the rest of the machinery to accept it.
 *
 * Three separate contracts meet here, and none of them is visible from the shape of the object:
 * the apiserver's (required fields the widget CRDs do not default), previewPageV2's (a root named
 * `page-<slug>` or the sandbox refuses the whole set), and pageDraft's (the same name is how the
 * nav fragment learns its slug). Each has its own test, because each fails differently.
 */
import { describe, expect, it } from 'vitest'

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
    expect(spec.widgetData.allowedResources).toEqual(['pageheaders'])
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
})
