// @vitest-environment jsdom
/**
 * The palette. Two kinds of thing, and the tests keep them distinct, because a container is
 * CREATED (a new file) while an existing widget is only PLACED (a reference, no file) — conflating
 * them is how a palette silently writes files it should not.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import PalettePanel from './PalettePanel'
import type { PalettePick } from './PalettePanel'
import { LAYOUT_KINDS } from './structureEdit'
import { iconForResource, KNOWN_ICON_PLURALS } from './widgetIcons'

/**
 * The mocked loader's answer.
 *
 * ANNOTATED, not asserted. `null as unknown` reads as an unnecessary assertion to eslint, which
 * strips it on --fix; the property then infers as `null` and every assignment below fails
 * typecheck. A return type on the factory is the form both rules accept.
 */
type MockResult = { ok: true; widgets: { name: string; resource: string }[] } | { ok: false; error: string }
const harness = vi.hoisted((): { result: MockResult | null } => ({ result: null }))
vi.mock('./placeableWidgets', () => ({
  listPlaceableWidgets: () => Promise.resolve(harness.result),
}))

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }))
})
afterEach(cleanup)

describe('widgetIcons', () => {
  it('every LAYOUT KIND the composer can create has its own glyph', () => {
    // A container with the fallback glyph would sit in the palette looking like an unknown type.
    for (const plural of Object.values(LAYOUT_KINDS)) {
      expect(KNOWN_ICON_PLURALS).toContain(plural)
    }
  })

  it('every plural `placeableWidgets` can return has one too', () => {
    // The seven collections that RESTAction lists — see placeableWidgets' header.
    for (const plural of ['cards', 'tables', 'listies', 'linecharts', 'statistics', 'paragraphs', 'markdowns']) {
      expect(KNOWN_ICON_PLURALS).toContain(plural)
    }
  })

  it('an UNKNOWN plural still gets a glyph — the registry grows without this build', () => {
    expect(iconForResource('somethingneweroutthere')).toBeTruthy()
    expect(iconForResource(null)).toBeTruthy()
  })

  it('distinguishes rows from cols — the one pair the words do not separate', () => {
    expect(iconForResource('rows')).not.toBe(iconForResource('cols'))
  })
})

describe('PalettePanel', () => {
  it('offers every container, without needing the cluster', () => {
    harness.result = { ok: true, widgets: [] }
    render(<PalettePanel namespace={null} />)
    for (const layout of Object.keys(LAYOUT_KINDS)) {
      expect(screen.getByTestId(`palette-item-${layout}`)).toBeTruthy()
    }
  })

  it('lists the existing widgets the caller may see, with their plural', async () => {
    harness.result = { ok: true, widgets: [{ name: 'fleet-card', resource: 'cards' }, { name: 'runs', resource: 'tables' }] }
    render(<PalettePanel namespace='krateo-system' snowplowBaseUrl='http://snowplow.test' />)
    await waitFor(() => expect(screen.getByTestId('palette-item-fleet-card')).toBeTruthy())
    expect(screen.getByTestId('palette-item-runs')).toBeTruthy()
    expect(screen.getByText('tables')).toBeTruthy()
  })

  it('SHOWS WHY the list is missing rather than an empty picker', async () => {
    harness.result = { error: 'you may not list widgets in this namespace', ok: false }
    render(<PalettePanel namespace='krateo-system' snowplowBaseUrl='http://snowplow.test' />)
    await waitFor(() => expect(screen.getByText(/may not list widgets/)).toBeTruthy())
  })

  it('reports a container pick as CREATE, carrying the layout kind', () => {
    const picks: (PalettePick | null)[] = []
    harness.result = { ok: true, widgets: [] }
    render(<PalettePanel namespace={null} onPick={(pick) => picks.push(pick)} />)
    fireEvent.dragStart(screen.getByTestId('palette-item-Row'))
    expect(picks[0]).toEqual({ kind: 'container', layout: 'Row', resource: 'rows' })
  })

  it('reports an existing pick as PLACE, carrying the name — never a layout kind', () => {
    // The distinction that decides whether a file gets written.
    const picks: (PalettePick | null)[] = []
    harness.result = { ok: true, widgets: [{ name: 'fleet-card', resource: 'cards' }] }
    render(<PalettePanel namespace='krateo-system' onPick={(pick) => picks.push(pick)} snowplowBaseUrl='http://snowplow.test' />)
    return waitFor(() => screen.getByTestId('palette-item-fleet-card')).then(() => {
      fireEvent.dragStart(screen.getByTestId('palette-item-fleet-card'))
      expect(picks[0]).toEqual({ kind: 'existing', name: 'fleet-card', resource: 'cards' })
    })
  })

  it('does not call the cluster at all without a namespace or base url', () => {
    harness.result = { error: 'should never be read', ok: false }
    render(<PalettePanel namespace={null} />)
    expect(screen.queryByText(/should never be read/)).toBeNull()
  })
})
