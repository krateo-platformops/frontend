// @vitest-environment jsdom
/**
 * A VIRTUAL table keeps its rows one line tall.
 *
 * The Portal Builder recordings showed the first row of a pods table half under its header. The
 * table was virtual (≥100 rows), a wrapped pod name made the first row ~60px taller than antd's row
 * estimate, and the virtual list's scroll-jump correction added that difference to scrollTop when
 * it measured the row: the list opened scrolled down. Truncating cells (full text on hover) keeps
 * every row within the estimate. A small, non-virtual table must not change.
 */
import { cleanup, render } from '@testing-library/react'
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
vi.mock('../../components/FiltesProvider/FiltersProvider', () => ({
  useFilter: () => ({ getFilteredData: (data: unknown) => data }),
}))

import Table from './Table'
import type { TableWidgetData } from './Table'
import { VIRTUAL_ROW_THRESHOLD } from './tablePagination'

afterEach(cleanup)

const widgetData = (rows: number) => ({
  columns: [{ title: 'Name', valueKey: 'name' }, { title: 'Node', valueKey: 'node' }],
  dataSource: Array.from({ length: rows }, (_, index) => [
    { kind: 'jsonSchemaType', stringValue: `deployment-opentelemetry-collector-${index}`, type: 'string', valueKey: 'name' },
    { kind: 'jsonSchemaType', stringValue: 'gke-krateo-057-default-pool-de5a016d-kdcn', type: 'string', valueKey: 'node' },
  ]),
}) as unknown as TableWidgetData

const renderTable = (rows: number) => render(
  <MemoryRouter>
    <Table resourcesRefs={{ items: [] }} uid='t' widgetData={widgetData(rows)} />
  </MemoryRouter>,
)

describe('Table — virtual rows stay one line', () => {
  it('a virtual table truncates its cells, so no row outgrows the virtual list\'s estimate', () => {
    const { container } = renderTable(VIRTUAL_ROW_THRESHOLD)

    expect(container.querySelector('.ant-table-virtual')).not.toBeNull()
    const headers = [...container.querySelectorAll('th')]
    expect(headers.length).toBeGreaterThan(0)
    expect(headers.every((th) => th.classList.contains('ant-table-cell-ellipsis'))).toBe(true)
  })

  it('a small table is untouched: it wraps as before, nothing is truncated', () => {
    const { container } = renderTable(5)

    expect(container.querySelector('.ant-table-virtual')).toBeNull()
    expect(container.querySelector('.ant-table-cell-ellipsis')).toBeNull()
  })
})
