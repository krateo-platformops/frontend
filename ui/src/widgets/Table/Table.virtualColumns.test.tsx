// @vitest-environment jsdom
/**
 * A VIRTUAL table hands antd ONE set of column widths, and a scroll.x that is their sum.
 *
 * Seen on /reviews (krateo-057, fe 1.8.42, 116 open proposals, 1209px): the body cells did not line
 * up with their headers. antd draws a virtual table as a fixed-layout header table and a separate
 * virtual list of rows, lined up only by the column widths. Table passed `scroll.x: 'max-content'`
 * (antd reads anything but a number as 1) and squeezed the text columns below their `minWidth` to fit
 * the container while still passing that minWidth; the header drew the squeezed widths, the body
 * each column's minWidth, and every cell from the second column on started right of its header.
 *
 * jsdom lays nothing out, so this checks what Table passes antd; visual/tableVirtualAlignment.spec.ts
 * checks what the browser draws.
 */
import { cleanup, render } from '@testing-library/react'
import type { TableProps } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The width the stub ResizeObserver reports for the table, 0 for "never measured". */
let observedWidth = 0
vi.stubGlobal('ResizeObserver', class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect = vi.fn()
  observe = () => {
    if (observedWidth > 0) { this.callback([{ contentRect: { width: observedWidth } } as ResizeObserverEntry], this) }
  }
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

/** Every set of props Table rendered antd's Table with, latest last. */
const antdProps: TableProps[] = []
vi.mock('antd', async (importOriginal) => {
  const antd = await importOriginal<Record<string, unknown>>()
  const { createElement, forwardRef } = await import('react')
  const Spy = forwardRef<unknown, TableProps>((props, ref) => {
    antdProps.push(props)
    return createElement(antd.Table as never, { ...props, ref })
  })
  return { ...antd, Table: Spy }
})

import Table from './Table'
import type { TableWidgetData } from './Table'
import { columnWidthsStorageKey } from './tableColumnResize'
import { VIRTUAL_ROW_THRESHOLD } from './tablePagination'

const UID = 't-virtual-columns'

beforeEach(() => {
  antdProps.length = 0
  observedWidth = 0
  window.localStorage.clear()
})
afterEach(cleanup)

/** The open-proposals table: nine columns, most with a minWidth, two of tags, one of condition pills. */
const proposals = (rows: number, extra: Partial<TableWidgetData> = {}) => ({
  bordered: false,
  columns: [
    { minWidth: 300, title: 'Proposal', valueKey: 'title' },
    { minWidth: 180, title: 'Subject', valueKey: 'subject' },
    { title: 'Kind', valueKey: 'kind' },
    { minWidth: 150, title: 'Evidence sources', valueKey: 'sources' },
    { minWidth: 150, title: 'Checks', valueKey: 'checks' },
    { title: 'Status', valueKey: 'phase' },
    { title: 'Superseded', valueKey: 'superseded' },
    { minWidth: 110, title: 'Proposed', valueKey: 'created' },
    { minWidth: 180, title: 'Proposed target', valueKey: 'target' },
  ],
  dataSource: Array.from({ length: rows }, (_, index) => [
    { kind: 'jsonSchemaType', stringValue: `Raise the memory limit of payments-api-${index}`, type: 'string', valueKey: 'title' },
    { kind: 'jsonSchemaType', stringValue: `Deployment team-checkout/payments-api-${index}`, type: 'string', valueKey: 'subject' },
    { color: 'gray', kind: 'tag', stringValue: index % 2 ? 'yaml' : 'markdown', valueKey: 'kind' },
    { kind: 'jsonSchemaType', stringValue: 'Pods, events, container metrics', type: 'string', valueKey: 'sources' },
    { kind: 'conditions', stringValue: '[{"type":"Kind n/a","status":"True","color":"gray"}]', valueKey: 'checks' },
    { color: 'blue', kind: 'tag', stringValue: index % 3 ? 'Open' : 'Ready', valueKey: 'phase' },
    { kind: 'jsonSchemaType', stringValue: '-', type: 'string', valueKey: 'superseded' },
    { kind: 'jsonSchemaType', stringValue: '3 hours ago', type: 'string', valueKey: 'created' },
    { kind: 'jsonSchemaType', stringValue: `apps/v1 Deployment team-checkout/payments-api-${index}`, type: 'string', valueKey: 'target' },
  ]),
  fitContent: true,
  size: 'small',
  ...extra,
}) as unknown as TableWidgetData

const renderTable = (widgetData: TableWidgetData) => render(
  <MemoryRouter>
    <Table resourcesRefs={{ items: [] }} uid={UID} widgetData={widgetData} />
  </MemoryRouter>,
)

/** What Table last handed antd: the virtual flag, scroll.x, and each column's width and minWidth. */
const handed = () => {
  const props = antdProps.at(-1) as TableProps
  const columns = (props.columns ?? []) as { minWidth?: number; width?: number | string }[]
  return { minWidths: columns.map((column) => column.minWidth), scrollX: props.scroll?.x, virtual: props.virtual, widths: columns.map((column) => column.width) }
}

const sum = (widths: unknown[]) => widths.reduce<number>((total, width) => total + (width as number), 0)

describe('Table — a virtual table\'s scroll.x is the sum of the column widths it passes', () => {
  it('measured narrower than the columns ask for: every column sized, the sum fits the container, no minWidth', () => {
    observedWidth = 1209
    renderTable(proposals(116))
    const { minWidths, scrollX, virtual, widths } = handed()

    expect(virtual).toBe(true)
    expect(widths.every((width) => typeof width === 'number' && width > 0)).toBe(true)
    expect(typeof scrollX).toBe('number')
    expect(scrollX).toBe(sum(widths))
    // It fits its container, as a virtual table is meant to (its sideways scrollbar is hidden at rest).
    expect(scrollX).toBe(1209)
    // antd's virtual body would position a cell at max(width, minWidth) while the header draws width.
    expect(minWidths.every((minWidth) => minWidth === undefined)).toBe(true)
  })

  it('measured wider than the columns ask for: the columns share the room, and the sum is still scroll.x', () => {
    observedWidth = 1800
    renderTable(proposals(116))
    const { scrollX, widths } = handed()

    expect(widths.every((width) => typeof width === 'number')).toBe(true)
    expect(scrollX).toBe(sum(widths))
    expect(scrollX).toBe(1800)
  })

  it('before the container is measured: every column at its floor, and scroll.x their sum', () => {
    renderTable(proposals(116))
    const { scrollX, widths } = handed()

    expect(widths.every((width) => typeof width === 'number')).toBe(true)
    expect(typeof scrollX).toBe('number')
    expect(scrollX).toBe(sum(widths))
  })

  it('with no tag or numeric column, and no fitContent, the columns are still all sized', () => {
    observedWidth = 640
    const data = proposals(VIRTUAL_ROW_THRESHOLD)
    const textOnly = { ...data, columns: data.columns.filter(({ valueKey }) => valueKey === 'title' || valueKey === 'target'), fitContent: false }
    renderTable(textOnly)
    const { scrollX, virtual, widths } = handed()

    expect(virtual).toBe(true)
    expect(widths).toHaveLength(2)
    expect(widths.every((width) => typeof width === 'number')).toBe(true)
    expect(scrollX).toBe(sum(widths))
    expect(scrollX).toBe(640)
  })

  it('after a resize: the resized widths, and scroll.x their sum', () => {
    observedWidth = 1209
    const data = proposals(116)
    const kept = Object.fromEntries(data.columns.map(({ valueKey }, index) => [valueKey, 100 + 10 * index]))
    window.localStorage.setItem(columnWidthsStorageKey(UID), JSON.stringify(kept))
    renderTable(data)
    const { minWidths, scrollX, widths } = handed()

    expect(widths).toEqual(data.columns.map(({ valueKey }) => kept[valueKey]))
    expect(scrollX).toBe(sum(widths))
    // Proposal is kept at 100px under its 300px minWidth: the body must not stretch it back.
    expect(minWidths.every((minWidth) => minWidth === undefined)).toBe(true)
  })
})

describe('Table — a small (non-virtual) table is unchanged', () => {
  it('a default table keeps scroll.x max-content and its minWidths', () => {
    observedWidth = 1209
    renderTable(proposals(8, { fitContent: false }))
    const { minWidths, scrollX, virtual } = handed()

    expect(virtual).toBe(false)
    expect(scrollX).toBe('max-content')
    expect(minWidths[0]).toBe(300)
  })
})
