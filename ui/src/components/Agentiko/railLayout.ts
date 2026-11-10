import { Grid } from 'antd'

/**
 * How the open rail sits beside the page, by antd breakpoint (X4 audit R2, WCAG 1.4.10 Reflow):
 *
 * - `dock`  (≥ `lg`, 992 px): beside the page, which reflows narrower. Unchanged.
 * - `sheet` (`md`–`lg`, 768–991 px): over the page from the right at its own width. Docked here it
 *   left the page a sliver (148 px at 768 px), so the page stays whole behind it, dimmed and inert.
 * - `fill`  (< `md`, 768 px): the whole width, the page hidden behind it.
 *
 * `=== false`, not `!`: until antd's first media-query answer the screens are unknown, and an
 * unknown width docks, as it always did.
 */
export type RailLayout = 'dock' | 'fill' | 'sheet'

export const useRailLayout = (): RailLayout => {
  const screens = Grid.useBreakpoint()
  if (screens.md === false) {
    return 'fill'
  }
  return screens.lg === false ? 'sheet' : 'dock'
}
