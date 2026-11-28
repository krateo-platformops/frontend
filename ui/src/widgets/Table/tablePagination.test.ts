/**
 * tablePagination — paginate + virtualize decision logic (spec 2026-07-10).
 *
 * Pure-logic coverage (no antd render): pins the two decisions that keep the
 * 60K-row `/compositions` Table from wedging the browser —
 *   (1) WHEN to virtualize (bound the mounted DOM to the viewport), and
 *   (2) WHAT pagination prop to hand antd (controlled server-side classic pager
 *       vs the CR's own config vs none), so `dataSource` only ever holds one
 *       bounded page instead of the whole set.
 */

import { describe, it, expect, vi } from 'vitest'

import type { ServerPagination } from '../../types/Widget'
import { pagerRange } from '../../utils/pagerRange'

import { computeTablePagination, shouldVirtualize, usesServerPagination, VIRTUAL_ROW_THRESHOLD, VIRTUAL_SCROLL_Y } from './tablePagination'

describe('shouldVirtualize — bound the DOM at scale', () => {
  it('does NOT virtualize small tables (normal antd layout path)', () => {
    expect(shouldVirtualize(0)).toBe(false)
    expect(shouldVirtualize(10)).toBe(false)
    expect(shouldVirtualize(VIRTUAL_ROW_THRESHOLD - 1)).toBe(false)
  })

  it('virtualizes at/above the threshold (windowed DOM regardless of size)', () => {
    expect(shouldVirtualize(VIRTUAL_ROW_THRESHOLD)).toBe(true)
    expect(shouldVirtualize(60_026)).toBe(true)
  })

  it('exposes a fixed scroll height (antd `virtual` requires a numeric scroll.y)', () => {
    expect(typeof VIRTUAL_SCROLL_Y).toBe('number')
    expect(VIRTUAL_SCROLL_Y).toBeGreaterThan(0)
  })
})

const makeServer = (over: Partial<ServerPagination> = {}): ServerPagination => ({
  page: 1,
  pageSize: 50,
  setPage: vi.fn(),
  ...over,
})

describe('usesServerPagination — engages only when the template signals a sliced window', () => {
  it('engages when both the pager controls AND `pagination.total` are present', () => {
    // `total` is the server's signal that dataSource holds ONE window (only a
    // Table whose template slices on `.slice` emits it — e.g. compositions-table).
    expect(usesServerPagination({ total: 60_026 }, makeServer())).toBe(true)
  })

  it('does NOT engage for a Table that received the pager controls but did not slice', () => {
    // The other 6 chart Tables get `perPage` on their request (inert) but emit no
    // `total`, so they keep their prior client-side behaviour — no dead pager.
    expect(usesServerPagination(undefined, makeServer())).toBe(false)
    expect(usesServerPagination({ pageSize: 50 }, makeServer())).toBe(false)
  })

  it('does NOT engage without pager controls even if total is present', () => {
    expect(usesServerPagination({ total: 100 }, undefined)).toBe(false)
  })
})

describe('computeTablePagination — server-side classic pager', () => {
  it('produces a CONTROLLED pager driven by serverPagination + template total', () => {
    const server = makeServer({ page: 3 })
    const config = computeTablePagination({
      crPagination: { total: 60_026 },
      rowCount: 50,
      serverPagination: server,
    })
    expect(config).not.toBe(false)
    if (config === false) { throw new Error('expected pagination config') }
    expect(config.current).toBe(3)
    expect(config.pageSize).toBe(50)
    // TOTAL is the full filtered length from the widgetDataTemplate — NOT the
    // 50-row window — so the pager shows all pages while holding one page.
    expect(config.total).toBe(60_026)
    expect(config.showSizeChanger).toBe(false)
  })

  it('onChange jumps pages via setPage (refetch, not DOM growth)', () => {
    const server = makeServer()
    const config = computeTablePagination({ crPagination: { total: 200 }, rowCount: 50, serverPagination: server })
    if (config === false) { throw new Error('expected pagination config') }
    config.onChange?.(7, 50)
    expect(server.setPage).toHaveBeenCalledWith(7)
  })

  it('CR `current` overrides the client page when authored', () => {
    const config = computeTablePagination({ crPagination: { current: 9, total: 500 }, rowCount: 50, serverPagination: makeServer({ page: 1 }) })
    if (config === false) { throw new Error('expected pagination config') }
    expect(config.current).toBe(9)
  })
})

describe('computeTablePagination — non-server tables unchanged', () => {
  it('uses the CR pagination config when the pager is not engaged, with the range and total', () => {
    const cr = { defaultPageSize: 20, hideOnSinglePage: true }
    expect(computeTablePagination({ crPagination: cr, rowCount: 5, serverPagination: undefined })).toEqual({ ...cr, showTotal: pagerRange })
  })

  it('a Table with pager controls but no `total` keeps client-side pagination (no dead server pager)', () => {
    // Received `serverPagination` (all `tables` do) but the template did not slice
    // (no `total`) → falls back to the CR pagination, exactly as before this fix.
    const cr = { defaultPageSize: 20 }
    expect(computeTablePagination({ crPagination: cr, rowCount: 300, serverPagination: makeServer() })).toEqual({ ...cr, hideOnSinglePage: true, showTotal: pagerRange })
  })

  it('returns false (no pager) when neither an engaged server pager nor CR pagination is set', () => {
    expect(computeTablePagination({ crPagination: undefined, rowCount: 5, serverPagination: undefined })).toBe(false)
    expect(computeTablePagination({ crPagination: undefined, rowCount: 999, serverPagination: undefined })).toBe(false)
    // pager controls present but no total → still no controlled pager
    expect(computeTablePagination({ crPagination: undefined, rowCount: 999, serverPagination: makeServer() })).toBe(false)
  })
})

// PAG-1 (UX audit, 2026-11-25): a pager showed page numbers only, and a lone "1" under one page.
describe('every pager says how much there is, and is hidden on a single page', () => {
  it('the range and total read "1–15 of 94", grouped past a thousand', () => {
    expect(pagerRange(94, [1, 15])).toBe('1–15 of 94')
    expect(pagerRange(60_026, [1_001, 1_050])).toBe('1,001–1,050 of 60,026')
  })

  it('a client-side pager hides on one page and shows the total; an author\'s explicit false is kept', () => {
    const config = computeTablePagination({ crPagination: { pageSize: 15 }, rowCount: 5, serverPagination: undefined })
    if (config === false) { throw new Error('expected pagination config') }
    expect(config.hideOnSinglePage).toBe(true)
    expect(config.showTotal?.(94, [1, 15])).toBe('1–15 of 94')
    const kept = computeTablePagination({ crPagination: { hideOnSinglePage: false, pageSize: 15 } as never, rowCount: 5, serverPagination: undefined })
    expect(kept !== false && kept.hideOnSinglePage).toBe(false)
  })

  it('the server pager does the same', () => {
    const config = computeTablePagination({ crPagination: { total: 94 }, rowCount: 15, serverPagination: makeServer({ pageSize: 15 }) })
    if (config === false) { throw new Error('expected pagination config') }
    expect(config.hideOnSinglePage).toBe(true)
    expect(config.showTotal?.(94, [16, 30])).toBe('16–30 of 94')
  })
})
