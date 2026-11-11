// @vitest-environment jsdom
/**
 * A Table cell's explicit `tooltip`.
 *
 * First use: the trace page's red "500 · error" tag names the span's OTel StatusMessage
 * ("dial tcp 10.40.4.184:8081: i/o timeout"). The tooltip is a standard antd Tooltip, on every
 * cell kind, reachable by keyboard as well as by hover.
 *
 * Every stored Table widget lacks the field, so the second half matters as much: without it a
 * cell renders exactly as it always has, with no wrapper and no tab stop. And a truncating table's
 * cells already carry a full-text-on-hover title, so a cell with both must show ONE tooltip, the
 * explicit one.
 */
import { library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})
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

library.add(fas)

const navigateSpy = vi.fn()
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => navigateSpy,
}))
vi.mock('../../components/FiltesProvider/FiltersProvider', () => ({
  useFilter: () => ({ getFilteredData: (data: unknown) => data }),
}))

import Table from './Table'
import type { TableWidgetData } from './Table'

const STATUS_MESSAGE = 'dial tcp 10.40.4.184:8081: i/o timeout'
const LONG_URL = 'https://snowplow.krateo-system.svc.cluster.local:8081/call?apiVersion=templates.krateo.io/v1&resource=restactions&name=composition-events-and-traces-for-the-trace-page'

type Cell = NonNullable<TableWidgetData['dataSource']>[number][number]

// The trace page's spans table: a name, a long target, and the status tag.
const spansTable = (statusCell: Partial<Cell>, extra: Partial<TableWidgetData> = {}, urlCell: Partial<Cell> = {}) => ({
  columns: [
    { title: 'Span', valueKey: 'span' },
    { title: 'Target', valueKey: 'url' },
    { title: 'Status', valueKey: 'status' },
  ],
  dataSource: [[
    { kind: 'jsonSchemaType', stringValue: 'snowplow /call', type: 'string', valueKey: 'span' },
    { kind: 'jsonSchemaType', stringValue: LONG_URL, type: 'string', valueKey: 'url', ...urlCell },
    { color: 'red', kind: 'tag', stringValue: '500 · error', valueKey: 'status', ...statusCell },
  ]],
  ...extra,
}) as unknown as TableWidgetData

const renderTable = (widgetData: TableWidgetData) => render(
  <MemoryRouter>
    <App>
      <Table resourcesRefs={{ items: [] }} uid='spans' widget={{} as never} widgetData={widgetData} />
    </App>
  </MemoryRouter>,
)

afterEach(() => {
  cleanup()
  navigateSpy.mockClear()
  vi.restoreAllMocks()
})

const visibleTooltips = () => [...document.querySelectorAll('.ant-tooltip')].filter((node) => !node.classList.contains('ant-tooltip-hidden'))

/** Focus as Tab does (the browser marks it :focus-visible) or as a click does (it does not). */
const focusAs = (element: HTMLElement, by: 'click' | 'tab') => {
  const matches = element.matches.bind(element)
  vi.spyOn(element, 'matches').mockImplementation((selector) => (selector === ':focus-visible' ? by === 'tab' : matches(selector)))
  act(() => { element.focus() })
}

/** The element the status tag's tooltip is attached to: the focusable wrapper around the Tag. */
const statusWrapper = () => screen.getByText('500 · error').closest('[tabindex="0"]') as HTMLElement

describe('Table — a cell with `tooltip`', () => {
  it('shows the text on hover', async () => {
    renderTable(spansTable({ tooltip: STATUS_MESSAGE }))
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.mouseEnter(statusWrapper())

    expect((await screen.findByRole('tooltip')).textContent).toBe(STATUS_MESSAGE)
  })

  it('shows the text on keyboard focus, described to assistive tech, and Escape closes it where focus stays', async () => {
    renderTable(spansTable({ tooltip: STATUS_MESSAGE }))
    const wrapper = statusWrapper()
    expect(wrapper).toBeTruthy()

    focusAs(wrapper, 'tab')

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip.textContent).toBe(STATUS_MESSAGE)
    await waitFor(() => { expect(visibleTooltips()).toHaveLength(1) })
    expect(wrapper.getAttribute('aria-describedby')).toBe(tooltip.id)

    fireEvent.keyDown(wrapper, { key: 'Escape' })
    await waitFor(() => { expect(visibleTooltips()).toHaveLength(0) })
    expect(document.activeElement).toBe(wrapper)
  })

  it('a click focuses it without opening the tooltip, so it does not outlive the pointer', async () => {
    renderTable(spansTable({ tooltip: STATUS_MESSAGE }))
    focusAs(statusWrapper(), 'click')

    await new Promise((resolve) => { setTimeout(resolve, 300) })
    expect(visibleTooltips()).toHaveLength(0)
  })

  it('drops the tag\'s own title, so the tag has one tooltip', () => {
    renderTable(spansTable({ tooltip: STATUS_MESSAGE }))
    expect(screen.getByText('500 · error').closest('.ant-tag')?.hasAttribute('title')).toBe(false)
  })

  it.each([
    ['jsonSchemaType', { kind: 'jsonSchemaType', stringValue: 'error', type: 'string' }, 'error'],
    ['icon', { kind: 'icon', stringValue: 'fa-circle-xmark' }, undefined],
    ['bar', { kind: 'bar', stringValue: '40' }, undefined],
    ['conditions', { kind: 'conditions', stringValue: JSON.stringify([{ color: 'red', status: 'False', type: 'Ready' }]) }, 'Ready'],
    ['widget (no ref)', { kind: 'widget' }, '-'],
  ] as const)('wraps a %s cell, focusable and named', async (_kind, cell, text) => {
    renderTable(spansTable({ ...cell, tooltip: STATUS_MESSAGE }))
    const cellNode = document.querySelectorAll('tbody tr.ant-table-row td')[2] as HTMLElement
    const wrapper = cellNode.querySelector('[tabindex="0"]') as HTMLElement
    expect(wrapper).toBeTruthy()
    // Text content names itself; content without text (an icon, a gauge) is named by the tooltip.
    if (text === undefined) {
      expect(wrapper.getAttribute('aria-label')).toBe(STATUS_MESSAGE)
    } else {
      expect(wrapper.textContent).toBe(text)
    }

    focusAs(wrapper, 'tab')
    expect((await screen.findByRole('tooltip')).textContent).toBe(STATUS_MESSAGE)
  })

  it('leaves a dangling widget ref to its own error marker, so that cell has one tooltip', async () => {
    renderTable(spansTable({ kind: 'widget', resourceRefId: 'missing', tooltip: STATUS_MESSAGE }))
    const cellNode = document.querySelectorAll('tbody tr.ant-table-row td')[2] as HTMLElement
    expect(cellNode.querySelector('[tabindex="0"]')).toBeNull()

    fireEvent.mouseEnter(cellNode.querySelector('.anticon') as HTMLElement)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip.textContent).toContain('resourceRefId: missing')
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
  })

  it('Enter on the focused cell does not navigate the row; Enter on the row still does', () => {
    renderTable(spansTable(
      { tooltip: STATUS_MESSAGE },
      { rowNavigateTo: '/traces/{span}' },
    ))
    fireEvent.keyDown(statusWrapper(), { key: 'Enter' })
    expect(navigateSpy).not.toHaveBeenCalled()

    fireEvent.keyDown(document.querySelector('tbody tr[role="button"]') as HTMLElement, { key: 'Enter' })
    expect(navigateSpy).toHaveBeenCalledWith('/traces/snowplow%20%2Fcall')
  })
})

describe('Table — a cell without `tooltip`', () => {
  it('renders exactly as before: no wrapper, no tab stop, no tooltip on hover', async () => {
    renderTable(spansTable({}))
    const tag = screen.getByText('500 · error').closest('.ant-tag') as HTMLElement
    // The Tag is the cell's direct child, as it always was, and keeps its full-text title.
    expect(tag.parentElement?.tagName).toBe('TD')
    expect(tag.getAttribute('title')).toBe('500 · error')
    expect(document.querySelector('tbody [tabindex="0"]')).toBeNull()

    fireEvent.mouseEnter(tag)
    await new Promise((resolve) => { setTimeout(resolve, 300) })
    expect(document.querySelector('.ant-tooltip')).toBeNull()
  })

  it('a blank tooltip is the same as none', () => {
    const blank = renderTable(spansTable({ tooltip: '  ' })).container.innerHTML
    cleanup()
    const none = renderTable(spansTable({})).container.innerHTML
    expect(blank).toBe(none)
  })
})

describe('Table — `tooltip` on a long, ellipsized string', () => {
  it('shows exactly one tooltip, with the explicit text, not the cell\'s full-text title', async () => {
    renderTable(spansTable({}, { fitContent: true }, { tooltip: STATUS_MESSAGE }))
    const td = screen.getByText(LONG_URL).closest('td') as HTMLElement
    // The control: an ellipsis column whose cell has no tooltip still gets the native full-text title.
    expect(screen.getByText('snowplow /call').closest('td')?.getAttribute('title')).toBe('snowplow /call')
    expect(td.className).toContain('ant-table-cell-ellipsis')

    // With the explicit tooltip, no native title anywhere in the cell — a browser tooltip is a tooltip.
    expect(td.hasAttribute('title')).toBe(false)
    expect(td.querySelector('[title]')).toBeNull()

    const wrapper = td.querySelector('[tabindex="0"]') as HTMLElement
    fireEvent.mouseEnter(wrapper)

    expect((await screen.findByRole('tooltip')).textContent).toBe(STATUS_MESSAGE)
    await waitFor(() => { expect(visibleTooltips()).toHaveLength(1) })
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
  })
})
