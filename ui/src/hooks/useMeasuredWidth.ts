import { useCallback, useEffect, useState } from 'react'

/**
 * Measures a container's content-box width via ResizeObserver. Charts
 * (@ant-design/plots) read their canvas size at first paint; with `autoFit` they
 * race the flex/grid layout and can render against a 0/transient width — which
 * lays the plot out wrong (e.g. a donut's centre ends up off-canvas). Gating the
 * chart on a measured (>0) width and passing it explicitly removes that race and
 * keeps the chart responsive to later resizes.
 *
 * A CALLBACK REF, NOT A REF OBJECT. The observer used to attach in a mount-only effect that read
 * `ref.current` once. A chart that first rendered its empty state (PieChart and LineChart return
 * WidgetEmpty with no data) had no measured element at mount, so the observer never attached, width
 * stayed 0, and the chart stayed blank after its data arrived. Placing a chart and binding it
 * afterwards is exactly the Portal Builder's order (the pod-sizing demo, 2026-09-30). The callback
 * fires whenever the element appears or is replaced, so the observer follows the element.
 */
export function useMeasuredWidth<T extends HTMLElement>(): { ref: (el: T | null) => void; width: number } {
  const [el, setEl] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  const ref = useCallback((node: T | null) => { setEl(node) }, [])

  useEffect(() => {
    if (!el) { return }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0
      if (measured > 0) { setWidth((prev) => (Math.round(measured) === prev ? prev : Math.round(measured))) }
    })
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [el])

  return { ref, width }
}
