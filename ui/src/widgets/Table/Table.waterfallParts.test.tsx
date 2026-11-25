// @vitest-environment jsdom
/**
 * The two remaining parts of the trace waterfall as approved (charts mockup, 2026-11-25; audit OBS-4):
 * - `secondaryText` on a string cell: the service on a second, muted line under the span's name;
 * - `rulerStart`/`rulerEnd` on a column: "0" and "5.81 s" at the two ends of the bars' track, in the header's face
 *   but not upper-cased, instead of the title, which stays the column's name for assistive tech.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
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
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../components/FiltesProvider/FiltersProvider', () => ({
  useFilter: () => ({ getFilteredData: (data: unknown) => data }),
}))

import Table from './Table'
import type { TableWidgetData } from './Table'

type Cell = NonNullable<TableWidgetData['dataSource']>[number][number]
type Column = TableWidgetData['columns'][number]

const trace = (name: Partial<Cell>, timeline: Partial<Column> = {}, extra: Partial<TableWidgetData> = {}): TableWidgetData => ({
  allowedResources: [],
  columns: [{ title: 'Span', valueKey: 'span' }, { title: 'Timeline', valueKey: 'timeline', ...timeline }],
  dataSource: [
    [
      { kind: 'jsonSchemaType', stringValue: 'message/send', type: 'string', valueKey: 'span', ...name },
      { kind: 'span', offsetPercent: 37, stringValue: '1.38 s', valueKey: 'timeline', widthPercent: 24 },
    ],
    [
      { kind: 'jsonSchemaType', stringValue: 'POST /', type: 'string', valueKey: 'span' },
      { kind: 'span', offsetPercent: 10, stringValue: '2.10 s', valueKey: 'timeline', widthPercent: 36 },
    ],
  ],
  ...extra,
})

const renderTable = (widgetData: TableWidgetData) => render(
  <MemoryRouter>
    <App>
      <Table resourcesRefs={{ items: [] }} uid='trace' widget={{} as never} widgetData={widgetData} />
    </App>
  </MemoryRouter>,
)

afterEach(() => { cleanup() })

describe('Table — `secondaryText` on a string cell', () => {
  it('writes a second line under the value, in its own element after the value', () => {
    renderTable(trace({ secondaryText: 'k8s-agent' }))
    const td = screen.getByText('message/send').closest('td')!
    expect(td.textContent).toBe('message/sendk8s-agent')
    const lines = within(td).getByText('k8s-agent').parentElement!
    expect([...lines.children].map((line) => line.textContent)).toEqual(['message/send', 'k8s-agent'])
  })

  it('in a truncating table each line carries its own full text on hover', () => {
    renderTable(trace({ secondaryText: 'krateo-agent-gateway-platform' }, {}, { fitContent: true }))
    expect(screen.getByText('krateo-agent-gateway-platform').getAttribute('title')).toBe('krateo-agent-gateway-platform')
    expect(screen.getByText('message/send').closest('[title]')?.getAttribute('title')).toBe('message/send')
  })

  it('a cell with its own tooltip keeps that as its only one', () => {
    renderTable(trace({ secondaryText: 'k8s-agent', tooltip: 'the k8s agent' }, {}, { fitContent: true }))
    expect(screen.getByText('k8s-agent').hasAttribute('title')).toBe(false)
  })

  it('without it the cell renders exactly as before: the value alone', () => {
    renderTable(trace({}))
    const td = screen.getByText('message/send').closest('td')!
    expect(td.innerHTML).toBe('<span>message/send</span>')
  })
})

describe('Table — a column ruler', () => {
  const header = () => screen.getAllByRole('columnheader')[1]

  it('shows the two ends of the scale, as written, and keeps the title for assistive tech', () => {
    renderTable(trace({}, { rulerEnd: '5.81 s', rulerStart: '0' }))
    const labels = [...header().querySelectorAll('[aria-hidden="true"]')].map((label) => label.textContent).filter((text) => text === '0' || text === '5.81 s')
    expect(labels).toEqual(['0', '5.81 s'])
    expect(within(header()).getByText('Timeline')).toBeTruthy()
  })

  it('a column with a ruler has no sorter; a column without one keeps its sorter', () => {
    renderTable(trace({}, { rulerEnd: '5.81 s', rulerStart: '0' }))
    expect(header().querySelector('.ant-table-column-sorters')).toBeNull()
    cleanup()
    renderTable(trace({}))
    expect(header().querySelector('.ant-table-column-sorters')).not.toBeNull()
    expect(within(header()).getByText('Timeline')).toBeTruthy()
  })
})
