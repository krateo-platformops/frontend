/**
 * What a pager says beside its pages: the rows on this page and how many there are, "1–15 of 94"
 * (UX audit PAG-1). A pager showed only page numbers, so nobody could tell how much there was; a
 * table had no total at all. The Table and the List pass it to antd as `showTotal`, the pager's own
 * slot, and both hide the pager when everything fits on one page.
 */
export const pagerRange = (total: number, [from, to]: [number, number]): string =>
  `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`
