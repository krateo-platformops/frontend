// @vitest-environment jsdom
/**
 * `itemTemplate.bar.tooltip`: the reason behind a default row's bar label.
 *
 * The Dashboard's reconciliation rail labels a composition with no readiness signal "No signal".
 * That label alone does not say why, so the row names the reason on hover or focus (e.g.
 * "Ready=Unknown · ZeroEvidence: none of its 5 managed children has a readiness signal"). Only the
 * card variant had a tooltip (`status.tooltip`, on its glyph); this is the same `{path}` shape on
 * the default row's bar label.
 *
 * Every stored List widget lacks the field, so the second half matters as much: without it the
 * label renders as it always has, with no tooltip and no extra tab stop.
 */
import { library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

// antd's Tooltip measures its popup; jsdom has no ResizeObserver.
vi.stubGlobal('ResizeObserver', class { disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn() })

// The card's status glyph is a Font Awesome name; the app registers the set in App.tsx.
library.add(fas)

const navigateSpy = vi.fn()
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => navigateSpy,
}))

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }),
}))

import type { ItemTemplate } from './itemTemplate'
import { ListView } from './ListView'

const REASON = 'Ready=Unknown · ZeroEvidence: none of its 5 managed children has a readiness signal'

// The rail row as portal's list.rail-list.yaml builds it, plus the new field.
const railTemplate = (tooltip?: string): ItemTemplate => ({
  bar: {
    color: { map: { notAssessable: 'gray' }, value: '{rail.state}' },
    label: '{rail.label}',
    percent: '{rail.percent}',
    variant: 'rail',
    ...(tooltip === undefined ? {} : { tooltip }),
  },
  navigateTo: '/compositions/{ns}/{name}',
  primaryText: '{name}',
  subPrimaryText: '{ns}',
})

const item = { name: 'event-health', ns: 'krateo-system', rail: { label: 'No signal', percent: 0, reason: REASON, state: 'notAssessable' } }

const renderList = (itemTemplate: ItemTemplate, items: unknown[] = [item]) => render(
  <MemoryRouter>
    <App>
      <ListView itemTemplate={itemTemplate} items={items} rowKey='rail' />
    </App>
  </MemoryRouter>,
)

afterEach(() => {
  cleanup()
  navigateSpy.mockClear()
  vi.restoreAllMocks()
})

const shown = () => document.querySelector('.ant-tooltip')?.classList.contains('ant-tooltip-hidden') === false

/**
 * Focus the label as Tab does (the browser marks it :focus-visible) or as a click does (it does
 * not). jsdom's heuristic answers false either way, so the test says which, as FlowChart's does.
 */
const focusLabel = (label: HTMLElement, by: 'click' | 'tab') => {
  const matches = label.matches.bind(label)
  vi.spyOn(label, 'matches').mockImplementation((selector) => (selector === ':focus-visible' ? by === 'tab' : matches(selector)))
  act(() => { label.focus() })
}

describe('ListView — bar.tooltip on a default row', () => {
  it('shows the reason when the bar label is hovered', async () => {
    renderList(railTemplate('{rail.reason}'))
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.mouseEnter(screen.getByText('No signal'))

    expect((await screen.findByRole('tooltip')).textContent).toBe(REASON)
  })

  it('shows the reason on keyboard focus, described to assistive tech, and Escape closes it where focus stays', async () => {
    renderList(railTemplate('{rail.reason}'))
    const label = screen.getByText('No signal')
    expect(label.getAttribute('tabindex')).toBe('0')

    focusLabel(label, 'tab')

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip.textContent).toBe(REASON)
    await waitFor(() => { expect(shown()).toBe(true) })
    expect(label.getAttribute('aria-describedby')).toBe(tooltip.id)

    fireEvent.keyDown(label, { key: 'Escape' })
    await waitFor(() => { expect(shown()).toBe(false) })
    expect(document.activeElement).toBe(label)
  })

  it('a click focuses the label without opening the tooltip, so it does not outlive the pointer', async () => {
    renderList(railTemplate('{rail.reason}'))
    focusLabel(screen.getByText('No signal'), 'click')

    await new Promise((resolve) => { setTimeout(resolve, 300) })
    expect(shown()).toBe(false)
  })

  it('Enter on the focused label does not navigate the row; Enter on the row still does', () => {
    renderList(railTemplate('{rail.reason}'))
    fireEvent.keyDown(screen.getByText('No signal'), { key: 'Enter' })
    expect(navigateSpy).not.toHaveBeenCalled()

    const row = document.querySelector('.ant-list-item') as HTMLElement
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(navigateSpy).toHaveBeenCalledWith('/compositions/krateo-system/event-health')
  })

  it('a tooltip that resolves empty leaves the label exactly as without the field', () => {
    const withEmpty = renderList(railTemplate('{rail.missing}')).container.innerHTML
    cleanup()
    const without = renderList(railTemplate()).container.innerHTML
    expect(withEmpty).toBe(without)
  })

  it('without the field: no tooltip on hover or focus, and no tab stop on the label', async () => {
    renderList(railTemplate())
    const label = screen.getByText('No signal')
    expect(label.hasAttribute('tabindex')).toBe(false)

    fireEvent.mouseEnter(label)
    focusLabel(label, 'tab')

    // antd opens a hover tooltip after a 100ms delay; wait past it before asserting absence.
    await new Promise((resolve) => { setTimeout(resolve, 300) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(document.querySelector('.ant-tooltip')).toBeNull()
  })
})

describe('ListView — the card variant keeps its own status.tooltip', () => {
  it('still shows status.tooltip on hover of the card status glyph', async () => {
    const { container } = renderList(
      { primaryText: '{name}', rowVariant: 'card', status: { color: '{c}', icon: '{i}', tooltip: '{why}' } },
      [{ c: 'green', i: 'fa-circle-check', name: 'aws-vpc-stack', why: 'Available' }],
    )
    const glyph = container.querySelector('svg') as SVGElement
    fireEvent.mouseEnter(glyph)

    expect((await screen.findByRole('tooltip')).textContent).toBe('Available')
  })
})
