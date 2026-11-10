/**
 * A `window.matchMedia` that answers for a given viewport width, so a test can render a component
 * at 1440, 900 or 390 px and get antd's real responsive behaviour: `Grid.useBreakpoint()` asks
 * `(min-width: 768px)`-style queries, `Layout.Sider`'s `breakpoint` asks
 * `screen and (max-width: 991.98px)`. Every `min-width`/`max-width` clause in the query must hold;
 * a query with neither is answered `false`.
 *
 * jsdom has no matchMedia at all, and the stubs elsewhere in the suite answer `false` to every
 * query, which antd reads as the narrowest screen there is.
 */
const holds = (query: string, width: number) => {
  const clauses = [...query.matchAll(/\((min|max)-width:\s*([\d.]+)px\)/g)]
  return clauses.length > 0 && clauses.every(([, side, px]) => (side === 'min' ? width >= Number(px) : width <= Number(px)))
}

export const setViewportWidth = (width: number) => {
  const noop = () => undefined
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width, writable: true })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      addEventListener: noop,
      addListener: noop,
      dispatchEvent: () => false,
      matches: holds(query, width),
      media: query,
      onchange: null,
      removeEventListener: noop,
      removeListener: noop,
    }),
    writable: true,
  })
}
