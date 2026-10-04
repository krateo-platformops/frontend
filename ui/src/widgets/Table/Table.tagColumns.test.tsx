// @vitest-environment jsdom
/**
 * A tag in a truncating table is never cut mid-word.
 *
 * Seen on a Portal Builder preview (krateo-057, fe 1.6.89): a fitContent pods table with a "Verdict"
 * column of colored tags, narrowed by the Autopilot rail, showed "Underprovision" with the rest cut
 * off and no ellipsis. A Tag is an atomic inline-block, so the cell's ellipsis cannot reach inside it.
 * The tag column now gets a fixed width that fits its widest tag and the table a numeric scroll.x, so
 * a narrow container scrolls instead of clipping; the tag itself ellipsizes (title = full text) as a
 * backstop. A virtual table keeps the tag column's width but fits its container rather than scroll
 * (its scrollbar is hidden at rest). A table with no tag column must not change.
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
import { columnLayout, headerWidth, TAG_GLYPH_EM } from './tableColumnWidths'
import { VIRTUAL_ROW_THRESHOLD } from './tablePagination'

afterEach(cleanup)

const verdicts = ['Underprovisioned', 'Overprovisioned', 'Right-sized', 'Unknown']

const podsTable = (rows: number, extra: Partial<TableWidgetData> = {}) => ({
  columns: [
    { title: 'Namespace', valueKey: 'ns' },
    { title: 'Pod', valueKey: 'pod' },
    { title: 'Verdict', valueKey: 'verdict' },
  ],
  dataSource: Array.from({ length: rows }, (_, index) => [
    { kind: 'jsonSchemaType', stringValue: 'krateo-system', type: 'string', valueKey: 'ns' },
    { kind: 'jsonSchemaType', stringValue: `portals-v1-${index}`, type: 'string', valueKey: 'pod' },
    { color: 'red', kind: 'tag', stringValue: verdicts[index % verdicts.length], valueKey: 'verdict' },
  ]),
  ...extra,
}) as unknown as TableWidgetData

const renderTable = (widgetData: TableWidgetData, width = 320) => {
  const view = render(
    // The narrow container of the defect: the preview pane with the Autopilot rail open.
    <div style={{ width }}>
      <MemoryRouter>
        <Table resourcesRefs={{ items: [] }} uid='t' widgetData={widgetData} />
      </MemoryRouter>
    </div>,
  )
  const colWidths = [...view.container.querySelectorAll('col')].map((col) => col.style.width)
  const table = view.container.querySelector<HTMLTableElement>('.ant-table-content table')
  return { ...view, colWidths, table }
}

// antd's default tokens, which is what the jsdom render resolves: fontSize 14, fontSizeSM 12,
// paddingXS 8 per side (size middle), marginXXS 4, Tag padding 8 per side; the header is 11px.
const tokens = { cellFontSize: 14, cellPadding: 16, fontSize: 12, headerFontSize: 11, sorterWidth: 16, tagChrome: 16 }
const widestTag = Math.ceil('Underprovisioned'.length * 12 * TAG_GLYPH_EM + 16 + 16)
// The text columns' floors: each one's header on at most two lines.
const textFloors = headerWidth({ title: 'Namespace', valueKey: 'ns' }, tokens) + headerWidth({ title: 'Pod', valueKey: 'pod' }, tokens)

describe('columnLayout — tag columns', () => {
  const { columns, dataSource } = podsTable(4)

  it('sizes a tag column to its widest label and floors the rest, so scroll.x fits every column', () => {
    const { scrollX, widths } = columnLayout(columns, dataSource ?? [], tokens)

    expect(widths).toEqual([undefined, undefined, widestTag])
    expect(scrollX).toBe(widestTag + textFloors)
  })

  it('never shrinks below the author\'s own width/minWidth', () => {
    const sized = columns.map((column) => (column.valueKey === 'verdict' ? { ...column, minWidth: 400 } : { ...column, width: 150 }))
    const { scrollX, widths } = columnLayout(sized, dataSource ?? [], tokens)

    expect(widths[2]).toBe(400)
    expect(scrollX).toBe(400 + 150 + 150)
  })

  it('leaves a table without tag or numeric columns alone', () => {
    const { scrollX, widths } = columnLayout(columns.slice(0, 2), dataSource ?? [], tokens)

    expect(scrollX).toBeUndefined()
    expect(widths).toEqual([undefined, undefined])
  })
})

describe('Table — tag cells in a narrow container', () => {
  it('fitContent: the tag column is wide enough for its widest tag and the table scrolls rather than clip', () => {
    const { colWidths, container, table } = renderTable(podsTable(8, { fitContent: true }), 240)

    // Every label is present in full, with the full text on hover as the ellipsis backstop.
    const tags = [...container.querySelectorAll('.ant-tag')]
    expect(tags.map((tag) => tag.textContent)).toEqual(Array.from({ length: 8 }, (_, index) => verdicts[index % verdicts.length]))
    expect(tags.every((tag) => tag.getAttribute('title') === tag.textContent)).toBe(true)
    expect(tags.every((tag) => tag.className.includes('tagCell'))).toBe(true)

    // The table scrolls horizontally: its width is the numeric floor, wider than the 240px container.
    const width = Number.parseFloat(table?.style.width ?? '')
    expect(width).toBeGreaterThan(240)
    expect(container.querySelector('.ant-table-scroll-horizontal')).not.toBeNull()

    // Only the verdict column carries a fixed width, the one that fits "Underprovisioned".
    expect(colWidths).toEqual(['', '', `${widestTag}px`])
    expect(width).toBe(widestTag + textFloors)
  })

  it('virtual: the tag column is sized and the table fits its container instead of scrolling', () => {
    // A virtual table's horizontal scroll is the virtual list's own scrollbar: hidden at rest and drawn
    // at the foot of the 640px viewport. A scrolling virtual table read as clipped ("Underprovisio",
    // Portal Builder preview, 151 pods, Autopilot rail open), so it fits instead: the tag column keeps
    // its width and the other columns share the rest, ellipsized with the full text on hover.
    const { colWidths, container } = renderTable(podsTable(VIRTUAL_ROW_THRESHOLD))

    expect(container.querySelector('.ant-table-virtual')).not.toBeNull()
    // Only the tag column is sized (antd's virtual grid gives the others a 1px placeholder it then
    // stretches over the rest of the container).
    expect(colWidths[2]).toBe(`${widestTag}px`)
    expect(colWidths.slice(0, 2)).not.toContain(`${widestTag}px`)

    // Not the numeric floor (widestTag + the text columns' floors, wider than the 320px container):
    // the table is at least its container and no wider than its columns' own widths.
    const table = container.querySelector<HTMLTableElement>('.ant-table-header table')
    expect(table?.style.minWidth).toBe('100%')
    expect(Number.parseFloat(table?.style.width ?? '')).toBeLessThan(320)
    expect(Number.parseFloat(table?.style.width ?? '')).not.toBe(widestTag + textFloors)

    // Every tag in full; every other cell ellipsizes with its full text in a title.
    const tags = [...container.querySelectorAll('.ant-table-tbody .ant-tag')]
    expect(tags.length).toBeGreaterThan(0)
    expect(tags.every((tag) => verdicts.includes(tag.textContent ?? '') && tag.getAttribute('title') === tag.textContent)).toBe(true)
    const podCell = container.querySelector('.ant-table-tbody .ant-table-cell-ellipsis')
    expect(podCell?.querySelector('[title]')?.getAttribute('title') ?? podCell?.getAttribute('title')).toMatch(/^krateo-system$|^portals-v1-\d+$/)
  })

  it('a fitContent table with no tag column keeps fitting its container, with no horizontal scroll', () => {
    const data = podsTable(8, { fitContent: true })
    const { colWidths, container } = renderTable({ ...data, columns: data.columns.slice(0, 2) })

    expect(container.querySelector('.ant-table-scroll-horizontal')).toBeNull()
    expect(colWidths.every((width) => !width)).toBe(true)
  })

  it('a default (max-content) table is untouched: no fixed tag width, tags still in full', () => {
    const { colWidths, container } = renderTable(podsTable(8))

    expect(colWidths.every((width) => !width)).toBe(true)
    expect(container.querySelector('.ant-table-cell-ellipsis')).toBeNull()
    expect(container.querySelector('.ant-tag')?.textContent).toBe('Underprovisioned')
  })
})
