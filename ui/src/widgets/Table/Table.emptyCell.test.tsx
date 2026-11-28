// @vitest-environment jsdom
/**
 * One empty mark (UX audit TBL-4, 2026-11-25). The Table drew a hyphen for a cell with no value, and
 * the RESTActions and the rest of the portal draw an em dash, so one row showed "—" in one empty
 * column and "-" in the next. Every empty cell kind now draws EMPTY_CELL, the em dash.
 *
 * A decimal cell with no value drew the text "undefined": `String(undefined) ?? '-'` never falls back.
 */
import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})
vi.stubGlobal('matchMedia', (query: string) => ({
  addEventListener: vi.fn(), addListener: vi.fn(), dispatchEvent: vi.fn(() => false), matches: false, media: query, onchange: null, removeEventListener: vi.fn(), removeListener: vi.fn(),
}))
vi.mock('../../components/FiltesProvider/FiltersProvider', () => ({
  useFilter: () => ({ getFilteredData: (data: unknown) => data }),
}))

import Table from './Table'
import type { TableWidgetData } from './Table'
import { EMPTY_CELL } from './tableSorting'

const EMPTY_CELLS: Record<string, Record<string, unknown>> = {
  array: { kind: 'jsonSchemaType', type: 'array' },
  boolean: { kind: 'jsonSchemaType', type: 'boolean' },
  conditions: { kind: 'conditions', stringValue: '[]' },
  decimal: { kind: 'jsonSchemaType', type: 'decimal' },
  null: { kind: 'jsonSchemaType', type: 'null' },
  number: { kind: 'jsonSchemaType', type: 'number' },
  string: { kind: 'jsonSchemaType', stringValue: '', type: 'string' },
  tag: { kind: 'tag' },
}

const renderEmptyRow = () => render(
  <MemoryRouter>
    <App>
      <Table
        resourcesRefs={{ items: [] }}
        uid='empties'
        widget={{} as never}
        widgetData={{
          columns: Object.keys(EMPTY_CELLS).map((key) => ({ title: key, valueKey: key })),
          dataSource: [Object.entries(EMPTY_CELLS).map(([key, cell]) => ({ ...cell, valueKey: key }))],
        } as unknown as TableWidgetData}
      />
    </App>
  </MemoryRouter>,
)

afterEach(cleanup)

describe('Table — one empty mark', () => {
  it('the mark is the em dash', () => {
    expect(EMPTY_CELL).toBe('—')
  })

  it('every empty cell kind draws it, and no cell draws a hyphen or "undefined"', () => {
    const { container } = renderEmptyRow()
    const cells = [...container.querySelectorAll('tbody tr.ant-table-row td')].map((cell) => cell.textContent)
    expect(cells).toEqual(Object.keys(EMPTY_CELLS).map(() => '—'))
  })
})
