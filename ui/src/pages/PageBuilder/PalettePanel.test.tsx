// @vitest-environment jsdom
/**
 * The palette. Two kinds of thing, and the tests keep them distinct, because a container is
 * CREATED (a new file) while an existing widget is only PLACED (a reference, no file) — conflating
 * them is how a palette silently writes files it should not.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import PalettePanel from './PalettePanel'
import { LAYOUT_KINDS } from './structureEdit'
import { iconForResource, KNOWN_ICON_PLURALS } from './widgetIcons'
import { WIDGET_KINDS } from './widgetKinds.generated'

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

  it('EVERY kind the palette can offer has its own glyph, not just the seven it used to', () => {
    /*
     * The map covered eleven plurals while the palette offered five kinds and seven collections.
     * The palette now offers forty-four, so the fallback had stopped being an exception and become
     * the rule: thirty-three rows drew the SAME generic block, which is worse than no glyph column
     * at all — it implies a distinction it is not making.
     *
     * Asserted against the GENERATED kind set rather than a list written here, so a kind added to
     * the CRDs fails this test instead of quietly joining the identical rows.
     */
    for (const kind of Object.values(WIDGET_KINDS)) {
      expect(KNOWN_ICON_PLURALS, kind.plural).toContain(kind.plural)
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

  /**
   * INSTANCES ARE BEHIND A DISCLOSURE NOW, grouped by plural. Forty-four kinds move when the chart
   * does; two hundred and ninety-five instances move when anyone authors a widget, and showing
   * them all by default is what made a drag source and its target impossible to see together.
   * Filtering opens the groups, so these reach them the way a person would.
   */
  const reveal = (text: string) => {
    fireEvent.change(screen.getByLabelText('Filter the palette'), { target: { value: text } })
  }

  it('lists the existing widgets the caller may see, with their plural', async () => {
    harness.result = { ok: true, widgets: [{ name: 'fleet-card', resource: 'cards' }, { name: 'runs', resource: 'tables' }] }
    render(<PalettePanel namespace='krateo-system' snowplowBaseUrl='http://snowplow.test' />)
    await waitFor(() => expect(screen.getByText(/cards · 1/)).toBeTruthy())
    reveal('fleet-card')
    await waitFor(() => expect(screen.getByTestId('palette-item-fleet-card')).toBeTruthy())
    reveal('runs')
    await waitFor(() => expect(screen.getByTestId('palette-item-runs')).toBeTruthy())
    // Scoped to the instance's own row: `tables` now also appears as the plural of the Table KIND,
    // which the palette can create. A bare getByText would match either and assert neither.
    expect(screen.getByTestId('palette-item-runs').textContent).toContain('tables')
  })

  it('filters on the PLURAL as well as the name — people think in either', async () => {
    harness.result = { ok: true, widgets: [{ name: 'fleet-card', resource: 'cards' }] }
    render(<PalettePanel namespace='krateo-system' snowplowBaseUrl='http://snowplow.test' />)
    await waitFor(() => expect(screen.getByText(/cards · 1/)).toBeTruthy())
    reveal('cards')
    expect(screen.getByTestId('palette-item-fleet-card')).toBeTruthy()
    // …and it narrows the KIND lists at the same time, since they answer the same question.
    expect(screen.queryByTestId('palette-item-BarChart')).toBeNull()
    expect(screen.getByTestId('palette-item-Card')).toBeTruthy()
  })

  it('offers every CRD kind, not the five the old literal knew', () => {
    /*
     * The palette could CREATE five layout containers and REFERENCE widgets somebody had already
     * authored on the cluster. Nobody could make a new Statistic — which is why "support any widget
     * the frontend supports" was never a matter of lengthening the list.
     */
    harness.result = { ok: true, widgets: [] }
    render(<PalettePanel namespace={null} />)

    // A container the old literal missed, and which every draft already contains as a leaf.
    expect(screen.getByTestId('palette-item-PageHeader')).toBeTruthy()
    // A leaf kind that could not previously be created at all.
    expect(screen.getByTestId('palette-item-Statistic')).toBeTruthy()
    expect(screen.getByTestId('palette-item-BarChart')).toBeTruthy()
    // …and the five it did know are still there.
    for (const known of ['Flex', 'Row', 'Col', 'Card', 'Tabs']) {
      expect(screen.getByTestId(`palette-item-${known}`)).toBeTruthy()
    }
  })

  it('SHOWS WHY the list is missing rather than an empty picker', async () => {
    harness.result = { error: 'you may not list widgets in this namespace', ok: false }
    render(<PalettePanel namespace='krateo-system' snowplowBaseUrl='http://snowplow.test' />)
    await waitFor(() => expect(screen.getByText(/may not list widgets/)).toBeTruthy())
  })

  /*
   * WHAT A PICK MEANS is asserted in dndIds.test.ts now — the pick travels as a dnd-kit payload
   * rather than through an `onPick` callback, and `resolveDrop` is what turns it into a CREATE or a
   * PLACE. What belongs here is what the PANEL is responsible for: that each pick is rendered as a
   * control a person can actually operate.
   */
  it('renders every item as a KEYBOARD-REACHABLE control, not a bare draggable div', () => {
    // Every palette item used to be `<div draggable>` with role:null, tabindex:null and no label —
    // so not one of 80 tab stops landed in the palette.
    harness.result = { ok: true, widgets: [] }
    render(<PalettePanel namespace={null} />)
    const row = screen.getByTestId('palette-item-Row')
    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('tabindex')).toBe('0')
    expect(row.getAttribute('aria-roledescription')).toBe('draggable')
  })

  it('renders an existing widget as its own control, distinct from the container items', () => {
    harness.result = { ok: true, widgets: [{ name: 'fleet-card', resource: 'cards' }] }
    render(<PalettePanel namespace='krateo-system' snowplowBaseUrl='http://snowplow.test' />)
    return waitFor(() => screen.getByText(/cards · 1/)).then(() => {
      reveal('fleet-card')
      const item = screen.getByTestId('palette-item-fleet-card')
      expect(item.getAttribute('role')).toBe('button')
      // the plural badge is still shown, and no longer wraps mid-word
      expect(item.textContent).toContain('cards')
    })
  })

  it('does not call the cluster at all without a namespace or base url', () => {
    harness.result = { error: 'should never be read', ok: false }
    render(<PalettePanel namespace={null} />)
    expect(screen.queryByText(/should never be read/)).toBeNull()
  })
})
