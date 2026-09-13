// @vitest-environment jsdom
/**
 * PageHeader — the contract, not the pixels.
 *
 * This widget exists because five pages each hand-rolled the same chrome under three different
 * names, so what matters is that the shape it guarantees actually holds: one baseline row carrying
 * the title, its counter and its tags, with the page's actions right-aligned beside them.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as Utils from '../../utils/utils'

import PageHeader from './PageHeader'
import type { PageHeaderWidgetData } from './PageHeader'

// The actions render a nested WidgetRenderer (which would fetch); stub it — we assert composition.
vi.mock('../../components/WidgetRenderer', () => ({ default: () => <div data-testid='action' /> }))
vi.mock('../../utils/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof Utils>()),
  getEndpointUrl: (id: string) => (id === 'missing' ? undefined : 'http://example.test/endpoint'),
}))

const renderHeader = (widgetData: Partial<PageHeaderWidgetData>) => render(
  <PageHeader
    resourcesRefs={{ items: [] }}
    uid='ph'
    widgetData={{ allowedResources: ['buttons'], items: [], title: 'Compositions', ...widgetData }}
  />,
)

describe('PageHeader', () => {
  afterEach(() => { cleanup() })

  it('renders the title as the page heading', () => {
    renderHeader({})
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Compositions')
  })

  it('renders a counter in brackets INSIDE the heading, not as a separate fact', () => {
    renderHeader({ counter: 397 })
    // Inside the h1 is the whole point: a count belongs to the title's type step (P4), which is
    // what stops it drifting into its own Paragraph as it did on the Marketplace page.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('(397)')
  })

  it('omits the counter entirely when absent — never renders an empty bracket', () => {
    renderHeader({})
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toContain('(')
  })

  it('renders a counter of zero — 0 is a real answer, not a missing one', () => {
    renderHeader({ counter: 0 })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('(0)')
  })

  it('renders the counter with its noun inside the brackets', () => {
    // Inside, not after: the noun belongs to the number. "(23 blueprints)", never "(23) blueprints".
    renderHeader({ counter: 23, counterLabel: 'blueprints' })
    expect(screen.getByText('(23 blueprints)')).toBeTruthy()
  })

  it('renders a bare counter when no noun is given', () => {
    renderHeader({ counter: 7 })
    expect(screen.getByText('(7)')).toBeTruthy()
  })

  /*
   * The dashboard greeting shipped through this widget reading "Good {localTimeOfDay},
   * {displayName}" LITERALLY on screen. The chart emits those tokens on purpose and expects the
   * browser to substitute them — Paragraph did, PageHeader did not, and the migration assumed a
   * title rendered down the same path a Paragraph's text did.
   *
   * Nothing could have caught it but looking: the CR is valid, the CRD accepts it, the string is
   * present in the DOM, and only a human reading the page sees that it is the wrong string.
   */
  it('resolves client-side tokens in the title, the way Paragraph does', () => {
    renderHeader({ title: 'Good {localTimeOfDay}, {displayName}' })
    expect(screen.queryByText(/\{localTimeOfDay\}/)).toBeNull()
    expect(screen.queryByText(/\{displayName\}/)).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening), /)
  })

  it('resolves client-side tokens in the subtitle too', () => {
    renderHeader({ subtitle: 'Hello {displayName}', title: 'X' })
    expect(screen.queryByText(/\{displayName\}/)).toBeNull()
  })

  it('places tags on the title line', () => {
    renderHeader({ tags: [{ color: 'green', label: 'Healthy' }] })
    expect(screen.getByText('Healthy')).toBeTruthy()
  })

  /*
   * These two exist because the dot went missing and nothing noticed.
   *
   * `tags` originally rendered a bare antd Tag with the palette tint on it — same hex, same word,
   * no leading status dot — while the Tag WIDGET drew one for every coloured, labelled pill. On a
   * detail page the two sit inches apart, and they did not match. The test above passed the whole
   * time, because asserting the LABEL says nothing about the pill.
   *
   * It mattered beyond one page: `tags` is the route every detail page's status pill is migrating
   * onto, so all four would have lost their dot on the way in.
   */
  it('draws the leading status dot on a coloured, labelled tag — the same pill the Tag widget draws', () => {
    const { container } = renderHeader({ tags: [{ color: 'green', label: 'Healthy' }] })
    const dot = container.querySelector('.ant-tag span[style*="border-radius: 50%"]')
    expect(dot).toBeTruthy()
    expect((dot as HTMLElement).style.height).toBe('6px')
  })

  it('draws NO dot when the tag has no label — colour alone is not a status', () => {
    // A dot with no word carries its meaning by colour alone: invisible to a screen reader, to a
    // colourblind reader, and gone the moment the page is screenshotted into a ticket.
    const { container } = renderHeader({ tags: [{ color: 'green', label: '' }] })
    expect(container.querySelector('.ant-tag span[style*="border-radius: 50%"]')).toBeNull()
  })

  it('renders the subtitle when given, and nothing when not', () => {
    const { unmount } = renderHeader({ subtitle: 'Every composition on the cluster' })
    expect(screen.getByText('Every composition on the cluster')).toBeTruthy()
    unmount()

    renderHeader({})
    expect(screen.queryByText('Every composition on the cluster')).toBeNull()
  })

  it('renders each resolvable action', () => {
    renderHeader({ items: [{ resourceRefId: 'new-composition' }, { resourceRefId: 'export' }] })
    expect(screen.getAllByTestId('action')).toHaveLength(2)
  })

  it('skips an unresolvable action LOUDLY — a vanished button must not be silent', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { /* silenced */ })
    renderHeader({ items: [{ resourceRefId: 'missing' }, { resourceRefId: 'ok' }] })

    expect(screen.getAllByTestId('action')).toHaveLength(1)
    // The whole point: the author gets told which ref failed, by name.
    expect(spy.mock.calls.some((args) => String(args[0]).includes('missing'))).toBe(true)
    spy.mockRestore()
  })

  it('renders a header with no actions at all', () => {
    renderHeader({ items: [] })
    expect(screen.queryAllByTestId('action')).toHaveLength(0)
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
  })
})
