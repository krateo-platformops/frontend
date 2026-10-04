// @vitest-environment jsdom
/**
 * Headers that read in full, numbers sized to their content, and alignment from the cell kind.
 *
 * Seen on Portal Builder previews (krateo-057, fe 1.6.91): a six-column virtual pods table in the
 * ~557px preview pane ellipsized its headers on one line, so the unit was the part cut ("CPU RE…" for
 * "CPU request (m)"); its three number columns took an equal share with the pod and namespace names,
 * which were cut hard; and one table's number columns came out left-aligned.
 *
 * A truncating (fitContent or virtual) table's header now wraps onto two lines. A numeric column gets
 * a fixed width from its widest value and its two-line header, as a tag column does; the text columns
 * share what is left. Numbers right-align and text left-aligns, decided by the cells' kind.
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
import { columnLayout, HEADER_GLYPH_EM, headerLineChars, headerWidth, isNumericColumn, NUM_GLYPH_EM, TAG_GLYPH_EM } from './tableColumnWidths'
import { VIRTUAL_ROW_THRESHOLD } from './tablePagination'

afterEach(cleanup)

type Columns = TableWidgetData['columns']
type Rows = NonNullable<TableWidgetData['dataSource']>

// antd's default tokens, as the jsdom render resolves them, and the 11px header.
const tokens = { cellFontSize: 14, cellPadding: 16, fontSize: 12, headerFontSize: 11, sorterWidth: 16, tagChrome: 16 }

const verdicts = ['Underprovisioned', 'Overprovisioned', 'Right-sized', 'Unknown']

/** The defect's table: a 30-character name, a namespace, three numbers titled with units, a verdict tag. */
const columns: Columns = [
  { title: 'Pod', valueKey: 'pod' },
  { title: 'Namespace', valueKey: 'ns' },
  { title: 'CPU request (m)', valueKey: 'req' },
  { title: 'CPU usage (m)', valueKey: 'use' },
  { title: 'Utilization (%)', valueKey: 'util' },
  { title: 'Verdict', valueKey: 'verdict' },
]

const podRows = (count: number): Rows => Array.from({ length: count }, (_, index) => [
  { kind: 'jsonSchemaType', stringValue: 'portalagents-v1-8-64-ctrl-5746', type: 'string', valueKey: 'pod' },
  { kind: 'jsonSchemaType', stringValue: 'krateo-system', type: 'string', valueKey: 'ns' },
  { kind: 'jsonSchemaType', numberValue: [50, 1000][index % 2], type: 'integer', valueKey: 'req' },
  { decimalValue: ['1241.2', '3875.6'][index % 2], kind: 'jsonSchemaType', type: 'decimal', valueKey: 'use' },
  { decimalValue: ['2482.5', '387.6'][index % 2], kind: 'jsonSchemaType', type: 'decimal', valueKey: 'util' },
  { color: 'red', kind: 'tag', stringValue: verdicts[index % verdicts.length], valueKey: 'verdict' },
]) as unknown as Rows

const header = (title: string) => headerWidth({ title, valueKey: 'x' }, tokens)

describe('headerLineChars', () => {
  it('wraps a title at word boundaries onto two lines, as narrow as that allows', () => {
    expect(headerLineChars('CPU request (m)')).toBe('CPU request'.length)
    expect(headerLineChars('CPU usage (m)')).toBe('CPU usage'.length)
    expect(headerLineChars('Namespace')).toBe('Namespace'.length)
    expect(headerLineChars('What it is for')).toBe('What it'.length)
  })

  it('a header width holds the widest line, the sorter and the cell padding', () => {
    expect(header('CPU request (m)')).toBe(Math.ceil(11 * 11 * HEADER_GLYPH_EM + 16 + 16))
  })
})

describe('isNumericColumn — decided by the cells\' kind', () => {
  const cell = (fields: object) => [[{ kind: 'jsonSchemaType', valueKey: 'v', ...fields }]] as unknown as Rows

  it('integer, number and decimal cells are numeric', () => {
    expect(isNumericColumn(cell({ numberValue: 5, type: 'integer' }), 'v')).toBe(true)
    expect(isNumericColumn(cell({ numberValue: 5.5, type: 'number' }), 'v')).toBe(true)
    expect(isNumericColumn(cell({ decimalValue: '5.5', type: 'decimal' }), 'v')).toBe(true)
  })

  it('a string column of plain numbers is numeric; a placeholder cell does not flip it', () => {
    const rows = [
      [{ kind: 'jsonSchemaType', stringValue: '50', type: 'string', valueKey: 'v' }],
      [{ kind: 'jsonSchemaType', stringValue: 'null', type: 'string', valueKey: 'v' }],
      [{ kind: 'jsonSchemaType', stringValue: '-', type: 'string', valueKey: 'v' }],
    ] as unknown as Rows
    expect(isNumericColumn(rows, 'v')).toBe(true)
  })

  it('names, tags and a column of placeholders only are not numeric', () => {
    expect(isNumericColumn(cell({ stringValue: 'krateo-system', type: 'string' }), 'v')).toBe(false)
    expect(isNumericColumn([[{ kind: 'tag', stringValue: '5', valueKey: 'v' }]] as unknown as Rows, 'v')).toBe(false)
    expect(isNumericColumn(cell({ stringValue: '-', type: 'string' }), 'v')).toBe(false)
  })
})

describe('columnLayout — numeric and text columns', () => {
  const rows = podRows(4)
  const tag = Math.max(Math.ceil('Underprovisioned'.length * 12 * TAG_GLYPH_EM + 16 + 16), header('Verdict'))
  // Each number column is as wide as its two-line header here: the values are shorter.
  const numbers = [header('CPU request (m)'), header('CPU usage (m)'), header('Utilization (%)')]
  const fixed = numbers.reduce((sum, width) => sum + width, 0) + tag

  it('sizes a numeric column to the wider of its widest value and its two-line header', () => {
    const { numeric, widths } = columnLayout(columns, rows, tokens)

    expect(numeric).toEqual([false, false, true, true, true, false])
    expect(widths).toEqual([undefined, undefined, ...numbers, tag])
  })

  it('a long number sizes its column past its header', () => {
    const wide = podRows(1).map((row) => row.map((cell) => (cell.valueKey === 'req' ? { ...cell, numberValue: 123456789012345 } : cell)))
    const { widths } = columnLayout(columns, wide, tokens)

    expect(widths[2]).toBe(Math.ceil(15 * 14 * NUM_GLYPH_EM + 16))
  })

  it('the text columns share what is left: each its header, the rest by how much more its content asks', () => {
    const containerWidth = 760
    const { widths } = columnLayout(columns, rows, tokens, { containerWidth, virtual: true })
    const [pod, ns] = widths as number[]

    expect(widths.slice(2)).toEqual([...numbers, tag])
    expect(pod + ns + fixed).toBe(containerWidth)
    expect(ns).toBeGreaterThanOrEqual(header('Namespace'))
    // The 30-character pod name asks for more than the namespace, so it gets more of the rest.
    expect(pod).toBeGreaterThan(ns)
  })

  it('a virtual table too narrow for every header squeezes its text columns rather than scroll', () => {
    const containerWidth = fixed + 60
    const { scrollX, widths } = columnLayout(columns, rows, tokens, { containerWidth, virtual: true })

    expect(scrollX).toBeUndefined()
    expect((widths[0] ?? 0) + (widths[1] ?? 0)).toBeLessThanOrEqual(60)
  })

  it('a fitContent table too narrow for every header keeps their floors and scrolls', () => {
    const containerWidth = fixed + 60
    const { scrollX, widths } = columnLayout(columns, rows, tokens, { containerWidth })

    expect(widths.slice(0, 2)).toEqual([undefined, undefined])
    expect(scrollX).toBe(fixed + header('Pod') + header('Namespace'))
  })
})

const renderTable = (widgetData: Partial<TableWidgetData>) => render(
  <div style={{ width: 557 }}>
    <MemoryRouter>
      <Table resourcesRefs={{ items: [] }} uid='t' widgetData={{ columns, ...widgetData } as TableWidgetData} />
    </MemoryRouter>
  </div>,
)

const alignOf = (cell: Element | null | undefined) => (cell as HTMLElement | null)?.style.textAlign ?? ''

describe('Table — headers, widths and alignment', () => {
  it('virtual: headers wrap with their full title, numbers are sized and right-aligned, text left', () => {
    const { container } = renderTable({ dataSource: podRows(VIRTUAL_ROW_THRESHOLD) })

    const titles = [...container.querySelectorAll('.ant-table-thead th [title]')]
    expect(titles.map((title) => title.getAttribute('title'))).toEqual(columns.map((column) => column.title))
    expect(titles.every((title) => title.className.includes('headerWrap'))).toBe(true)
    expect(container.querySelector('.ant-table-thead [class*="headerEllipsis"]')).toBeNull()

    const cols = [...container.querySelectorAll('.ant-table-header col')].map((col) => (col as HTMLElement).style.width)
    expect(cols.slice(2, 5)).toEqual([header('CPU request (m)'), header('CPU usage (m)'), header('Utilization (%)')].map((width) => `${width}px`))

    const row = container.querySelector('.ant-table-tbody .ant-table-row')
    expect([...row?.children ?? []].map(alignOf)).toEqual(['', '', 'right', 'right', 'right', ''])
  })

  it('fitContent: the same headers, widths and alignment', () => {
    const { container } = renderTable({ dataSource: podRows(8), fitContent: true })

    expect(container.querySelectorAll('.ant-table-thead [class*="headerWrap"]')).toHaveLength(columns.length)
    const row = container.querySelector('.ant-table-tbody .ant-table-row')
    expect([...row?.children ?? []].map(alignOf)).toEqual(['', '', 'right', 'right', 'right', ''])
  })

  it('a default (max-content) table keeps its one-line headers and no computed widths, but aligns by kind', () => {
    const { container } = renderTable({ dataSource: podRows(8) })

    expect(container.querySelector('.ant-table-thead [class*="headerWrap"]')).toBeNull()
    expect(container.querySelectorAll('.ant-table-thead [class*="headerEllipsis"]')).toHaveLength(columns.length)
    expect([...container.querySelectorAll('col')].every((col) => !(col as HTMLElement).style.width)).toBe(true)
    const row = container.querySelector('.ant-table-tbody .ant-table-row')
    expect([...row?.children ?? []].map(alignOf)).toEqual(['', '', 'right', 'right', 'right', ''])
  })

  it('a numeric column with a placeholder cell still right-aligns', () => {
    const rows = podRows(8).map((row, index) => row.map((cell) => (cell.valueKey === 'req'
      ? { kind: 'jsonSchemaType' as const, stringValue: index === 3 ? 'null' : '50', type: 'string' as const, valueKey: 'req' }
      : cell)))
    const { container } = renderTable({ dataSource: rows, fitContent: true })

    const row = container.querySelector('.ant-table-tbody .ant-table-row')
    expect(alignOf(row?.children[2])).toBe('right')
  })
})
