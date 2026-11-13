// @vitest-environment jsdom
/**
 * Collapse: antd Collapse with its panels from data — the root pages' groups (one per alert, per
 * repo, per day), each a count in the header and a body that is either a child widget or a capped
 * dataSource drawn through the shared ListView.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

const navigate = vi.fn()
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => navigate,
}))
vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }),
}))
// A child widget is fetched by reference; here it only has to say it was mounted.
vi.mock('../../components/RefChild', () => ({ default: ({ resourceRefId }: { resourceRefId: string }) => <span data-testid='child'>{resourceRefId}</span> }))

import Collapse, { cappedBody, openByDefault, panelKey, type CollapseWidgetData } from './Collapse'

const rows = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => ({ name: `${prefix}-${index + 1}` }))

const widgetData: CollapseWidgetData = {
  itemTemplate: { primaryText: '{name}' },
  items: [
    { cap: 3, count: 5, dataSource: rows(5, 'open'), extra: '5 alerts, largest first', footer: 'See all 5 →', footerNavigateTo: '/incidents?status=Open&view=table', key: 'open', label: 'Open', status: 'error' },
    { cap: 3, count: 2, dataSource: rows(2, 'warn'), footer: 'See all 2 →', key: 'warn', label: 'Analyzing', status: 'warning' },
    { count: 7, dataSource: rows(3, 'done'), footer: 'See all 7 →', footerNavigateTo: '/incidents?status=Resolved&view=table', key: 'done', label: 'Resolved' },
    { key: 'recent', label: 'Recent changes', resourceRefId: 'activity' },
  ],
}

const renderCollapse = (data: CollapseWidgetData = widgetData) => render(
  <MemoryRouter>
    <App>
      <Collapse resourcesRefs={{ items: [] }} uid='groups' widgetData={data} />
    </App>
  </MemoryRouter>,
)

/** The header button of the panel titled `title`. */
const header = (title: string) => screen.getByText(title).closest('[aria-expanded]') as HTMLElement
const panel = (title: string) => header(title).closest('.ant-collapse-item') as HTMLElement

afterEach(() => {
  cleanup()
  navigate.mockReset()
})

describe('Collapse', () => {
  it('draws one antd panel per item, in order', () => {
    renderCollapse()
    expect([...document.querySelectorAll('.ant-collapse-item')].map((item) => item.querySelector('.ant-collapse-title')?.textContent))
      .toEqual(['Open 5', 'Analyzing 2', 'Resolved 7', 'Recent changes'])
  })

  it('a data body draws the first `cap` items through the shared item template', () => {
    renderCollapse()
    const body = within(panel('Open'))
    expect(body.getByText('open-1')).toBeTruthy()
    expect(body.getByText('open-3')).toBeTruthy()
    expect(body.queryByText('open-4')).toBeNull()
  })

  it('a capped body ends with its footer as a real link to where "see all" goes', () => {
    renderCollapse()
    const link = within(panel('Open')).getByRole('link', { name: 'See all 5 →' })
    expect(link.getAttribute('href')).toBe('/incidents?status=Open&view=table')
    fireEvent.click(link)
    expect(navigate).toHaveBeenCalledWith('/incidents?status=Open&view=table')
  })

  it('with `cap`, the footer shows only when the cap left items out', () => {
    renderCollapse()
    expect(within(panel('Analyzing')).queryByText('See all 2 →')).toBeNull()
    expect(within(panel('Analyzing')).getByText('warn-2')).toBeTruthy()
  })

  it('without `cap`, the footer shows whenever it is set (the data was capped server-side)', () => {
    expect(cappedBody({ dataSource: rows(3, 'x'), footer: 'See all 7 →' })).toEqual({ footer: 'See all 7 →', items: rows(3, 'x') })
    expect(cappedBody({ cap: 3, dataSource: rows(3, 'x'), footer: 'See all 3 →' })).toEqual({ footer: undefined, items: rows(3, 'x') })
    expect(cappedBody({ cap: 2, dataSource: rows(3, 'x'), footer: 'More' })).toEqual({ footer: 'More', items: rows(2, 'x') })
  })

  it('opens the panels that carry a status, and folds the rest, when defaultActiveKey is absent', () => {
    renderCollapse()
    expect(header('Open').getAttribute('aria-expanded')).toBe('true')
    expect(header('Analyzing').getAttribute('aria-expanded')).toBe('true')
    expect(header('Resolved').getAttribute('aria-expanded')).toBe('false')
    expect(header('Recent changes').getAttribute('aria-expanded')).toBe('false')
    expect(openByDefault(widgetData.items, undefined)).toEqual(['open', 'warn'])
  })

  it('defaultActiveKey overrides that rule', () => {
    renderCollapse({ ...widgetData, defaultActiveKey: ['done'] })
    expect(header('Open').getAttribute('aria-expanded')).toBe('false')
    expect(header('Resolved').getAttribute('aria-expanded')).toBe('true')
    expect(openByDefault(widgetData.items, [])).toEqual([])
  })

  it('a static body is a child widget, mounted only once its panel opens', () => {
    renderCollapse()
    expect(screen.queryByTestId('child')).toBeNull()
    fireEvent.click(header('Recent changes'))
    expect(screen.getByTestId('child').textContent).toBe('activity')
  })

  it('the count badge is tinted only by an exception status; a settled panel\'s is neutral', () => {
    renderCollapse()
    const badge = (title: string) => header(title).querySelector('.ant-tag') as HTMLElement
    expect(badge('Open').className).toContain('ant-tag-error')
    expect(badge('Analyzing').className).toContain('ant-tag-warning')
    expect(badge('Resolved').className).not.toMatch(/ant-tag-(error|warning|success|processing)/)
    expect(header('Recent changes').querySelector('.ant-tag')).toBeNull()
  })

  it('draws `extra` as muted header meta', () => {
    renderCollapse()
    expect(within(header('Open')).getByText('5 alerts, largest first')).toBeTruthy()
  })

  it('a panel the Page Builder adds as `{ resourceRefId }` is a valid panel, keyed by its child', () => {
    // The builder adds a child to any container that way; key and label are optional for it.
    expect(panelKey({ resourceRefId: 'activity' }, 3)).toBe('activity')
    expect(panelKey({}, 3)).toBe('3')
    expect(panelKey({ key: 'open', resourceRefId: 'activity' }, 3)).toBe('open')
    renderCollapse({ defaultActiveKey: ['activity'], items: [{ resourceRefId: 'activity' }] })
    expect(screen.getByTestId('child').textContent).toBe('activity')
  })

  it('passes antd options through: accordion keeps one panel open', () => {
    renderCollapse({ ...widgetData, accordion: true, defaultActiveKey: ['open'] })
    fireEvent.click(header('Resolved'))
    expect(header('Resolved').getAttribute('aria-expanded')).toBe('true')
    expect(header('Open').getAttribute('aria-expanded')).toBe('false')
  })
})
