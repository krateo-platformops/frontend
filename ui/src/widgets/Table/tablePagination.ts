import type { TablePaginationConfig } from 'antd'

import type { ServerPagination } from '../../types/Widget'
import { pagerRange } from '../../utils/pagerRange'

/**
 * Height (px) of the Table's scroll viewport when virtualized. antd's `virtual`
 * list requires a fixed `scroll.y` to window rows; this bounds the mounted <tr>
 * count to what fits here (~viewport) regardless of dataSource size — the
 * load-bearing fix for the 60K-row `/compositions` wedge (spec 2026-07-10).
 */
export const VIRTUAL_SCROLL_Y = 640

/**
 * At/above this row count the Table renders virtualized (windowed DOM). Below it,
 * a plain (non-virtual) Table is fine and keeps antd's normal layout/measure path.
 */
export const VIRTUAL_ROW_THRESHOLD = 100

/** antd Table `pagination` config as authored on the widget CR (subset we read). */
export type CrPagination = {
  pageSize?: number
  defaultPageSize?: number
  total?: number
  current?: number
} | undefined

/**
 * Decide whether a Table renders virtualized. Virtualization is the load-bearing
 * fix: it bounds the mounted DOM to the viewport regardless of dataSource size.
 */
export const shouldVirtualize = (rowCount: number): boolean => rowCount >= VIRTUAL_ROW_THRESHOLD

/**
 * Whether the widget opted into CONTROLLED server-side pagination. The SPA
 * requests a bounded page for every `tables` widget, but only a Table whose
 * `widgetDataTemplate` actually slices (`.slice`) emits `pagination.total` (the
 * full filtered length). That `total` is the server's signal that `dataSource`
 * holds ONE window — so only then do we render the controlled pager. Tables that
 * ignore `.slice` (no `total`) keep their prior client-side behaviour; the
 * `perPage` on their request is inert (their template returns everything).
 */
export const usesServerPagination = (
  crPagination: CrPagination,
  serverPagination?: ServerPagination,
): boolean => !!serverPagination && typeof crPagination?.total === 'number'

/**
 * Compute the antd `pagination` prop for the Table, with this precedence:
 *   1. CONTROLLED server-side classic pager — when the widget both received the
 *      pager controls AND emitted `pagination.total` (see `usesServerPagination`).
 *      `dataSource` holds only the current page/window; the pager navigates by
 *      refetching (setPage), never by growing the DOM; `total` (from the template)
 *      gives the right page count.
 *   2. else the CR's own `pagination` config (author-controlled), or `false`.
 * Either pager shows the range and total ("1–15 of 94") and hides on a single page.
 *
 * (Note: a virtual Table renders its whole window in one scroll pane, so it does
 * not need — and should not get — a client-side pager that would re-slice the
 * window and defeat windowing. Server pagination above is the only pager a
 * virtualized compositions Table uses.)
 */
export const computeTablePagination = (args: {
  crPagination: CrPagination
  rowCount: number
  serverPagination?: ServerPagination
}): TablePaginationConfig | false => {
  const { crPagination, rowCount, serverPagination } = args

  if (usesServerPagination(crPagination, serverPagination)) {
    return {
      current: crPagination?.current ?? serverPagination!.page,
      hideOnSinglePage: true,
      onChange: (page: number) => { serverPagination!.setPage(page) },
      pageSize: serverPagination!.pageSize,
      showSizeChanger: false,
      showTotal: pagerRange,
      total: crPagination?.total ?? rowCount,
    }
  }

  // Every pager says "1–15 of 94" and is hidden when everything fits on one page (PAG-1). The CR's
  // own settings come last, so an author who sets `hideOnSinglePage: false` keeps a lone pager.
  return crPagination ? { hideOnSinglePage: true, showTotal: pagerRange, ...crPagination } : false
}
