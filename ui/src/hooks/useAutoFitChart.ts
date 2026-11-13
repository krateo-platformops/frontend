import { useCallback, useRef } from 'react'

import { useMeasuredWidth } from './useMeasuredWidth'

/**
 * The slice of an @ant-design/plots instance (what `onReady` hands back) this hook drives.
 * `triggerResize()` is the library's own "my container changed size" entry point: it calls G2's
 * `chart.forceFit()`, which re-reads the container and re-renders ONLY when the size differs from
 * the one last drawn — so calling it on every measurement is cheap when nothing moved.
 */
interface RefittablePlot { triggerResize?: () => void }

/**
 * An autoFit G2 chart that re-fits to its CONTAINER, not just to the window (issue #603: line
 * charts in a Tabs pane came back "cut in half" after switching tabs).
 *
 * WHY autoFit ALONE IS NOT ENOUGH. G2's `autoFit` listens to `window` 'resize' only — it has no
 * ResizeObserver — and it reads the container's size whenever the chart renders. An inactive antd
 * tab pane is display:none, so its container measures 0×0, and G2 then falls back to its 640×480
 * default (the height usually survives, because our container's height is inline and inherited).
 * Two everyday things make a hidden chart render: a data refresh (the widget re-polls and the
 * chart re-renders with the new data) and a window resize (G2's own listener fires forceFit for
 * every chart, hidden or not). Either one leaves the canvas at 640px, and when the tab is shown
 * again nothing tells G2 — no window resize happened — so the plot stays 640 wide inside a
 * container that may be twice that: cut in half, or cropped when the container is narrower.
 * Measured on the live Observability page: 532-wide container, canvas 640 after re-show.
 *
 * THE FIX, AT THE CHART. The container is already under a ResizeObserver (`useMeasuredWidth`,
 * which gates the FIRST paint on a real width). Every non-zero measurement now also asks the chart
 * to re-fit. Re-appearing from display:none is a 0 → N size change, so the observer fires exactly
 * when the tab comes back, and the chart redraws at the real size before the next paint. Zero
 * measurements are ignored, so a chart is never asked to fit a hidden container. This also covers
 * container resizes that never touch the window (a collapsing sidebar, a reflowing Flex row), which
 * autoFit missed for the same reason. It is fixed here rather than in Tabs (e.g. destroying
 * inactive panes) because the cause is any hidden container — Tabs, a collapsed panel, a drawer —
 * and destroying panes would re-fetch and re-render every widget on every tab switch.
 *
 * Usage: spread `ref` onto the chart's container div and pass `onReady` to the plots component.
 */
export function useAutoFitChart<T extends HTMLElement>(): { onReady: (plot: RefittablePlot) => void; ref: (el: T | null) => void; width: number } {
  const plot = useRef<RefittablePlot | null>(null)
  const onReady = useCallback((instance: RefittablePlot) => { plot.current = instance }, [])
  const { ref, width } = useMeasuredWidth<T>(() => { plot.current?.triggerResize?.() })
  return { onReady, ref, width }
}
