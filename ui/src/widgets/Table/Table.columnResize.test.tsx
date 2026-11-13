// @vitest-environment jsdom
/**
 * Columns a reader can widen (#556).
 *
 * "Whenever the content of an entry in a table is too long, my immediate reaction is to reach for
 * the border of the column to make it wider." Every header cell now carries a handle on its right
 * edge: dragged, or focused and moved with the arrow keys. A resize pins every column and turns the
 * table fixed-layout, so a column is exactly as wide as it was left; the widths are kept for the
 * viewer under the widget's uid. The handle sits inside the sortable th, so none of this may sort.
 *
 * jsdom lays nothing out (every element measures 0px), so a column the layout leaves to antd starts
 * a resize from DEFAULT_COLUMN_WIDTH here; in a browser it starts from its width on screen.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import {
  clampColumnWidth,
  columnWidthsStorageKey,
  DEFAULT_COLUMN_WIDTH,
  KEYBOARD_STEP,
  KEYBOARD_STEP_LARGE,
  MIN_COLUMN_WIDTH,
  readColumnWidths,
} from './tableColumnResize'
import { VIRTUAL_ROW_THRESHOLD } from './tablePagination'

const UID = 't-resize'

beforeEach(() => { window.localStorage.clear() })
afterEach(cleanup)

const widgetData = (rows = 3): TableWidgetData => ({
  columns: [{ title: 'Name', valueKey: 'name' }, { title: 'Node', valueKey: 'node' }],
  dataSource: Array.from({ length: rows }, (_, index) => [
    { kind: 'jsonSchemaType', stringValue: ['gamma', 'alpha', 'beta'][index % 3], type: 'string', valueKey: 'name' },
    { kind: 'jsonSchemaType', stringValue: 'gke-krateo-057-default-pool-de5a016d-kdcn', type: 'string', valueKey: 'node' },
  ]),
}) as unknown as TableWidgetData

const renderTable = (data: TableWidgetData = widgetData()) => render(
  <MemoryRouter>
    <Table resourcesRefs={{ items: [] }} uid={UID} widgetData={data} />
  </MemoryRouter>,
)

const handles = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.ant-table-thead [role="separator"]')]
/** The widths the colgroup gives each column: the first colgroup, the header's in a virtual table. */
const colWidths = (container: HTMLElement) => [...(container.querySelector('colgroup')?.querySelectorAll('col') ?? [])].map((col) => col.style.width)
const tableElement = (container: HTMLElement) => container.querySelector<HTMLElement>('.ant-table-content table, .ant-table-header table')
const rowNames = (container: HTMLElement) => [...container.querySelectorAll('tbody tr.ant-table-row td:first-child')].map((cell) => cell.textContent)

const drag = (handle: HTMLElement, from: number, to: number) => {
  fireEvent.pointerDown(handle, { button: 0, clientX: from, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: (from + to) / 2, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: to, pointerId: 1 })
  fireEvent.pointerUp(handle, { clientX: to, pointerId: 1 })
  fireEvent.click(handle)
}

describe('Table — every header carries a resize handle', () => {
  it('is a focusable vertical separator named after its column', () => {
    const { container } = renderTable()
    const [name, node] = handles(container)

    expect(handles(container)).toHaveLength(2)
    expect(name.getAttribute('aria-label')).toBe('Resize column Name')
    expect(node.getAttribute('aria-label')).toBe('Resize column Node')
    expect(name.getAttribute('aria-orientation')).toBe('vertical')
    expect(name.tabIndex).toBe(0)
    expect(name.getAttribute('aria-valuemin')).toBe(String(MIN_COLUMN_WIDTH))
  })

  it('an untouched table keeps the layout it had: no widths, auto layout', () => {
    const { container } = renderTable()

    expect(colWidths(container).every((width) => !width)).toBe(true)
    expect(tableElement(container)?.style.tableLayout).not.toBe('fixed')
  })
})

describe('Table — dragging a header\'s edge', () => {
  it('widens the column by the distance dragged, pins the others and fixes the layout', () => {
    const { container } = renderTable()

    drag(handles(container)[0], 300, 420)

    expect(colWidths(container)).toEqual([`${DEFAULT_COLUMN_WIDTH + 120}px`, `${DEFAULT_COLUMN_WIDTH}px`])
    expect(tableElement(container)?.style.tableLayout).toBe('fixed')
    expect(handles(container)[0].getAttribute('aria-valuenow')).toBe(String(DEFAULT_COLUMN_WIDTH + 120))
  })

  it('narrows the column, but never below the minimum width', () => {
    const { container } = renderTable()

    drag(handles(container)[1], 500, 460)
    expect(colWidths(container)[1]).toBe(`${DEFAULT_COLUMN_WIDTH - 40}px`)

    drag(handles(container)[1], 500, 0)
    expect(colWidths(container)[1]).toBe(`${MIN_COLUMN_WIDTH}px`)
  })

  it('does not sort the column it sits in', () => {
    const { container } = renderTable()
    const before = rowNames(container)

    drag(handles(container)[0], 300, 340)

    expect(rowNames(container)).toEqual(before)
    expect(container.querySelector('thead th')?.getAttribute('aria-sort')).toBeNull()
    // The header itself still sorts.
    fireEvent.click(container.querySelector('thead th') as HTMLElement)
    expect(rowNames(container)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('remembers the widths for this viewer under the widget uid, and a new render starts from them', () => {
    const first = renderTable()
    drag(handles(first.container)[0], 300, 400)

    expect(readColumnWidths(UID)).toEqual({ name: DEFAULT_COLUMN_WIDTH + 100, node: DEFAULT_COLUMN_WIDTH })
    cleanup()

    const { container } = renderTable()
    expect(colWidths(container)).toEqual([`${DEFAULT_COLUMN_WIDTH + 100}px`, `${DEFAULT_COLUMN_WIDTH}px`])
  })

  it('a double-click hands the table back its own sizing and forgets the kept widths', () => {
    const { container } = renderTable()
    drag(handles(container)[0], 300, 400)

    fireEvent.doubleClick(handles(container)[0])

    expect(colWidths(container).every((width) => !width)).toBe(true)
    expect(window.localStorage.getItem(columnWidthsStorageKey(UID))).toBeNull()
  })
})

describe('Table — resizableColumns: false', () => {
  it('draws no handle and lays the table out as before', () => {
    const { container } = renderTable({ ...widgetData(), resizableColumns: false })

    expect(handles(container)).toHaveLength(0)
    expect(colWidths(container).every((width) => !width)).toBe(true)
    expect(tableElement(container)?.style.tableLayout).not.toBe('fixed')
  })

  it('ignores widths a reader kept while the table was resizable', () => {
    const first = renderTable()
    drag(handles(first.container)[0], 300, 400)
    expect(readColumnWidths(UID)).not.toEqual({})
    cleanup()

    const { container } = renderTable({ ...widgetData(), resizableColumns: false })
    expect(colWidths(container).every((width) => !width)).toBe(true)
    expect(tableElement(container)?.style.tableLayout).not.toBe('fixed')
  })
})

describe('Table — the handle from the keyboard', () => {
  it('ArrowRight widens and ArrowLeft narrows the column; Shift takes bigger steps', () => {
    const { container } = renderTable()
    const handle = () => handles(container)[0]

    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    expect(colWidths(container)[0]).toBe(`${DEFAULT_COLUMN_WIDTH + KEYBOARD_STEP}px`)

    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(colWidths(container)[0]).toBe(`${DEFAULT_COLUMN_WIDTH - KEYBOARD_STEP}px`)

    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true })
    expect(colWidths(container)[0]).toBe(`${DEFAULT_COLUMN_WIDTH - KEYBOARD_STEP + KEYBOARD_STEP_LARGE}px`)
    expect(readColumnWidths(UID).name).toBe(DEFAULT_COLUMN_WIDTH - KEYBOARD_STEP + KEYBOARD_STEP_LARGE)
  })

  it('Enter on the handle does not sort the column', () => {
    const { container } = renderTable()
    const before = rowNames(container)

    // antd's sorter listens for keyCode 13 on the th.
    fireEvent.keyDown(handles(container)[0], { code: 'Enter', key: 'Enter', keyCode: 13 })
    fireEvent.keyDown(handles(container)[0], { code: 'Space', key: ' ', keyCode: 32 })

    expect(rowNames(container)).toEqual(before)
    expect(container.querySelector('thead th')?.getAttribute('aria-sort')).toBeNull()
  })
})

describe('Table — resizing a virtual table', () => {
  it('keeps its one-line ellipsis cells and takes the new width', () => {
    const { container } = renderTable(widgetData(VIRTUAL_ROW_THRESHOLD))
    expect(container.querySelector('.ant-table-virtual')).not.toBeNull()

    fireEvent.keyDown(handles(container)[1], { key: 'ArrowRight' })

    expect(container.querySelector('.ant-table-virtual')).not.toBeNull()
    expect([...container.querySelectorAll('th')].every((th) => th.classList.contains('ant-table-cell-ellipsis'))).toBe(true)
    expect(colWidths(container)[1]).toBe(`${DEFAULT_COLUMN_WIDTH + KEYBOARD_STEP}px`)
  })
})

describe('clampColumnWidth', () => {
  it('keeps a resize between the floor and the ceiling', () => {
    expect(clampColumnWidth(10, 200)).toBe(MIN_COLUMN_WIDTH)
    expect(clampColumnWidth(10, 200, 120)).toBe(120)
    expect(clampColumnWidth(99999, 200)).toBe(2400)
    expect(clampColumnWidth(250.4, 200)).toBe(250)
  })

  it('does not push a column already narrower than the floor wider when it is shrunk', () => {
    expect(clampColumnWidth(24, 40)).toBe(40)
  })
})

describe('readColumnWidths', () => {
  it('reads nothing from storage that throws or holds junk', () => {
    window.localStorage.setItem(columnWidthsStorageKey(UID), '{not json')
    expect(readColumnWidths(UID)).toEqual({})

    window.localStorage.setItem(columnWidthsStorageKey(UID), JSON.stringify({ a: 120, b: 'wide', c: -4 }))
    expect(readColumnWidths(UID)).toEqual({ a: 120 })

    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(readColumnWidths(UID)).toEqual({})
    spy.mockRestore()
  })
})
