// @vitest-environment jsdom
/**
 * A string cell's `format` (approved design "Dates and ages", 2026-11-24; audit TIME-1). The RESTAction
 * sends the ISO time; the cell writes it as an age ("7 weeks"), an ago ("52 minutes ago"), a moment
 * ("4 Nov, 11:10") or a day, in the viewer's zone, full date on hover and focus. An age column used to read
 * "4w" beside "September 10, 2026": `relative` gave up and printed a date beyond 8 weeks.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { App } from 'antd'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('ResizeObserver', class { disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn() })
vi.stubGlobal('matchMedia', (query: string) => ({
  addEventListener: vi.fn(), addListener: vi.fn(), dispatchEvent: vi.fn(() => false), matches: false, media: query, onchange: null, removeEventListener: vi.fn(), removeListener: vi.fn(),
}))
vi.mock('react-router', async (importOriginal) => ({ ...(await importOriginal<typeof ReactRouter>()), useNavigate: () => vi.fn() }))
vi.mock('../../components/FiltesProvider/FiltersProvider', () => ({ useFilter: () => ({ getFilteredData: (data: unknown) => data }) }))

import { formatMoment } from '../../utils/dateFormat'

import Table from './Table'
import type { TableWidgetData } from './Table'
import { EMPTY_CELL } from './tableSorting'

type Cell = NonNullable<TableWidgetData['dataSource']>[number][number]

const NOW = Date.parse('2026-11-25T15:00:00Z')
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }) })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const renderCells = (cells: Partial<Cell>[]) => render(
  <MemoryRouter>
    <App>
      <Table
        resourcesRefs={{ items: [] }}
        uid='ages'
        widget={{} as never}
        widgetData={{
          columns: [{ title: 'Age', valueKey: 'age' }],
          dataSource: cells.map((cell) => [{ kind: 'jsonSchemaType', type: 'string', valueKey: 'age', ...cell }]),
          resizableColumns: false,
        } as unknown as TableWidgetData}
      />
    </App>
  </MemoryRouter>,
)

describe('Table cell format', () => {
  it('an age column reads as one: 7 weeks and 2 months, never "September 10, 2026" beside "4w"', () => {
    renderCells([{ format: 'age', stringValue: daysAgo(49) }, { format: 'relative', stringValue: daysAgo(76) }])
    expect(screen.getByText('7 weeks').tagName).toBe('TIME')
    expect(screen.getByText('2 months').tagName).toBe('TIME')
  })

  it('ago and moment', () => {
    renderCells([{ format: 'ago', stringValue: new Date(NOW - 52 * 60_000).toISOString() }, { format: 'datetime', stringValue: '2026-10-06T04:35:04.158732159Z' }])
    expect(screen.getByText('52 minutes ago')).toBeTruthy()
    expect(screen.getByText(formatMoment('2026-10-06T04:35:04.158732159Z')).getAttribute('dateTime')).toBe('2026-10-06T04:35:04.158Z')
  })

  it('a cell’s explicit tooltip stays its only one: the words, without a second tooltip', () => {
    const { container } = renderCells([{ format: 'age', stringValue: daysAgo(49), tooltip: 'Created by the installer' }])
    expect(screen.getByText('7 weeks').tagName).toBe('SPAN')
    expect(container.querySelectorAll('time')).toHaveLength(0)
  })

  it('without format, or with a value that is not a time, the value is shown as it came', () => {
    const { container } = renderCells([{ stringValue: daysAgo(49) }, { format: 'age', stringValue: '49d ago' }, { format: 'age', stringValue: '' }])
    expect(screen.getByText(daysAgo(49)).tagName).toBe('SPAN')
    expect(screen.getByText('49d ago').tagName).toBe('SPAN')
    expect(screen.getByText(EMPTY_CELL)).toBeTruthy()
    expect(container.querySelectorAll('time')).toHaveLength(0)
  })
})
