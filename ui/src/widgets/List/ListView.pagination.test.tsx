// @vitest-environment jsdom
/**
 * UX-audit #21: the Marketplace grid rendered ~400 cards as ONE unpaginated wall. Listy now
 * mirrors antd List `pagination` ({pageSize, position?}): presence enables client-side paging
 * of the delivered dataSource; absent keeps the antd default (no pagination) so every existing
 * list is untouched. Facet/search filters shrink the array server-side BEFORE it reaches the
 * widget, so paging must compose with them: antd clamps the current page into the filtered
 * range, and a single-page result hides the pager (hideOnSinglePage — chrome is exception-only).
 */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { App } from 'antd'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

// antd Pagination is responsive — it probes matchMedia, which jsdom lacks.
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

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }),
}))

import { ListView } from './ListView'

afterEach(() => {
  cleanup()
})

const makeItems = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `item-${index + 1}` }))

const view = (items: unknown[], pagination?: { pageSize: number; position?: 'top' | 'bottom' | 'both' }): ReactElement => (
  <MemoryRouter>
    <App>
      <ListView
        itemTemplate={{ primaryText: '{name}' }}
        items={items}
        pagination={pagination}
        rowKey='listy-test'
      />
    </App>
  </MemoryRouter>
)

const rowTexts = (container: HTMLElement) =>
  [...container.querySelectorAll('.ant-list-item')].map((row) => row.textContent)

describe('ListView — antd List pagination pass-through (UX-audit #21)', () => {
  it('pageSize pages the delivered items and renders the pager', () => {
    const { container } = render(view(makeItems(30), { pageSize: 10 }))
    expect(container.querySelectorAll('.ant-list-item')).toHaveLength(10)
    expect(container.querySelector('.ant-pagination')).not.toBeNull()
    expect(container.querySelectorAll('.ant-pagination-item')).toHaveLength(3)
  })

  it('no pagination prop keeps the antd default: every item, no pager (existing lists untouched)', () => {
    const { container } = render(view(makeItems(30)))
    expect(container.querySelectorAll('.ant-list-item')).toHaveLength(30)
    expect(container.querySelector('.ant-pagination')).toBeNull()
  })

  it('a single-page result hides the pager (hideOnSinglePage — exception-only chrome)', () => {
    const { container } = render(view(makeItems(8), { pageSize: 24 }))
    expect(container.querySelectorAll('.ant-list-item')).toHaveLength(8)
    expect(container.querySelector('.ant-pagination')).toBeNull()
  })

  it('clamps the current page into range when a facet/search filter shrinks the items', () => {
    const { container, rerender } = render(view(makeItems(30), { pageSize: 10 }))
    fireEvent.click(container.querySelector('.ant-pagination-item-3')!)
    expect(rowTexts(container)[0]).toContain('item-21')

    // A facet click refetches: the server-filtered array shrinks to 12 (2 pages) while the
    // pager sat on page 3 — antd clamps to the last page instead of showing an empty one.
    rerender(view(makeItems(12), { pageSize: 10 }))
    expect(rowTexts(container)).toEqual(['item-11', 'item-12'])
  })

  // PAG-1 (UX audit, 2026-11-25): the pager showed page numbers only.
  it('the pager says which rows these are and how many there are', () => {
    const { container } = render(view(makeItems(94), { pageSize: 15 }))
    expect(container.querySelector('.ant-pagination-total-text')?.textContent).toBe('1–15 of 94')
    fireEvent.click(container.querySelector('.ant-pagination-item-2')!)
    expect(container.querySelector('.ant-pagination-total-text')?.textContent).toBe('16–30 of 94')
  })
})
