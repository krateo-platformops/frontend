// @vitest-environment jsdom
/**
 * The `span` cell and the `indent` cell field (approved charts mockup, 2026-11-25; audit OBS-4). The trace page
 * listed its spans as a table of offsets, so nothing showed where the time went. A `span` cell is a waterfall bar:
 * it starts `offsetPercent` along the cell and is `widthPercent` long, with the duration after it; `indent`, on any
 * cell, puts a span's name under the span that called it.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from 'antd'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getColorCode } from '../../theme/palette'

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
import { getCellSortValue } from './tableSorting'

type Cell = NonNullable<TableWidgetData['dataSource']>[number][number]

/** One trace: the root, its child, and a grandchild that started late; `timeline` cells as the trace page sends them. */
const waterfall = (timeline: Partial<Cell>[], names: Partial<Cell>[] = []) => ({
  columns: [{ title: 'Span', valueKey: 'span' }, { title: '0 … 5.81 s', valueKey: 'timeline' }],
  dataSource: timeline.map((cell, index) => [
    { kind: 'jsonSchemaType', stringValue: `span ${index}`, type: 'string', valueKey: 'span', ...names[index] },
    { kind: 'span', valueKey: 'timeline', ...cell },
  ]),
}) as unknown as TableWidgetData

const renderTable = (widgetData: TableWidgetData) => render(
  <MemoryRouter>
    <App>
      <Table resourcesRefs={{ items: [] }} uid='trace' widget={{} as never} widgetData={widgetData} />
    </App>
  </MemoryRouter>,
)
const bars = () => [...document.querySelectorAll<HTMLElement>('td [aria-hidden] > span[style*="inset-inline-start"]')]

/** jsdom writes an inline colour back as rgb(); compare in that form. */
const hex = (colour: string): string => {
  const element = document.createElement('i')
  element.style.background = colour
  return element.style.background
}

afterEach(() => { cleanup() })

describe('Table — a `span` cell', () => {
  it('draws a bar that starts at the offset and is as long as the width, with the duration after it', () => {
    renderTable(waterfall([
      { offsetPercent: 0, stringValue: '5.81 s', widthPercent: 100 },
      { offsetPercent: 37.18, stringValue: '1.40 s', widthPercent: 24.1 },
    ]))
    expect(bars().map((bar) => [bar.style.insetInlineStart, bar.style.width])).toEqual([
      ['min(0%, calc(100% - 2px))', '100%'],
      ['min(37.18%, calc(100% - 2px))', '24.1%'],
    ])
    expect(screen.getByText('1.40 s')).toBeTruthy()
  })

  it('in the cell’s colour, else the column’s, else the neutral grey', () => {
    renderTable({
      ...waterfall([{ color: 'red', offsetPercent: 0, widthPercent: 50 }, { offsetPercent: 0, widthPercent: 50 }]),
      columns: [{ title: 'Span', valueKey: 'span' }, { color: 'blue', title: 'Timeline', valueKey: 'timeline' }],
    } as unknown as TableWidgetData)
    const [red, columnColour] = bars()
    expect(red.style.background).toBe(hex(getColorCode('red')))
    expect(columnColour.style.background).toBe(hex(getColorCode('blue')))
    cleanup()
    renderTable(waterfall([{ offsetPercent: 0, widthPercent: 50 }]))
    expect(bars()[0].style.background).toBe(hex(getColorCode('gray')))
  })

  it('stays inside its cell: out-of-range values are clamped and the length is cut at the end', () => {
    renderTable(waterfall([{ offsetPercent: 90, widthPercent: 40 }, { offsetPercent: -5, widthPercent: 250 }, {}]))
    expect(bars().map((bar) => [bar.style.insetInlineStart, bar.style.width])).toEqual([
      ['min(90%, calc(100% - 2px))', '10%'],
      ['min(0%, calc(100% - 2px))', '100%'],
      ['min(0%, calc(100% - 2px))', '0%'],
    ])
  })

  it('its tooltip is the cell’s own, on the whole cell', async () => {
    renderTable(waterfall([{ offsetPercent: 10, stringValue: '2.10 s', tooltip: 'starts at 31 ms, lasts 2.10 s', widthPercent: 36 }]))
    const group = screen.getByRole('group', { name: 'starts at 31 ms, lasts 2.10 s' })
    fireEvent.mouseEnter(group)
    expect((await screen.findByRole('tooltip')).textContent).toBe('starts at 31 ms, lasts 2.10 s')
  })

  it('sorts by where it starts', () => {
    expect(getCellSortValue({ kind: 'span', offsetPercent: 37.18, stringValue: '1.40 s', valueKey: 't' })).toBe(37.18)
    expect(getCellSortValue({ kind: 'span', valueKey: 't' })).toBeUndefined()
  })
})

describe('Table — `indent` on any cell', () => {
  const tdOf = (text: string) => screen.getByText(text).closest('td') as HTMLElement

  it('starts the content that many levels (16px each) in, past the cell’s own padding', () => {
    renderTable(waterfall([{}, {}, {}], [{}, { indent: 1 }, { indent: 3 }]))
    const base = tdOf('span 1').style.paddingInlineStart
    expect(tdOf('span 0').style.paddingInlineStart).toBe('')
    const padding = (text: string) => Number.parseFloat(tdOf(text).style.paddingInlineStart)
    expect(padding('span 2') - padding('span 1')).toBe(32)
    expect(base).toMatch(/px$/)
  })

  it('on another kind too, and the content is not wrapped (a truncating table still titles it in full)', () => {
    renderTable({ ...waterfall([{ indent: 2, offsetPercent: 0, stringValue: '9 ms', widthPercent: 5 }]), fitContent: true })
    expect(Number.parseFloat(screen.getByText('9 ms').closest('td')!.style.paddingInlineStart)).toBeGreaterThan(32)
    cleanup()
    renderTable({ ...waterfall([{}], [{ indent: 2, stringValue: 'message/send' }]), fitContent: true })
    expect(screen.getByText('message/send').closest('[title]')?.getAttribute('title')).toBe('message/send')
  })
})
