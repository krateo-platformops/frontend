// @vitest-environment jsdom
/**
 * Issue #603: a line chart in a Tabs pane came back "cut in half" after switching tabs.
 *
 * G2's autoFit re-fits on WINDOW resize only. A chart that re-rendered while its tab pane was
 * display:none (a data refresh, or any window resize) read a 0×0 container, drew at G2's 640px
 * default, and nothing re-fitted it when the tab was shown again. The container's ResizeObserver
 * sees that re-appearance (0 → N), so it must ask the chart to re-fit then — EVEN WHEN N equals the
 * width it had before, which is the normal tab-switch case and the one the deduplicated `width`
 * state cannot see. A real canvas is unavailable in jsdom, so the chart is a stub that records
 * `triggerResize` calls (the @ant-design/plots entry point to G2's forceFit).
 */
import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAutoFitChart } from './useAutoFitChart'

type OnResize = (entries: { contentRect: { width: number } }[]) => void
interface Observed { onResize: OnResize; el?: Element; disconnected: boolean }
const observers: Observed[] = []

vi.stubGlobal('ResizeObserver', class {
  private rec: Observed
  constructor(onResize: OnResize) {
    this.rec = { disconnected: false, onResize }
    observers.push(this.rec)
  }
  observe(el: Element) { this.rec.el = el }
  disconnect() { this.rec.disconnected = true }
})

const resize = (width: number) => {
  const live = observers.filter((obs) => obs.el && !obs.disconnected)
  act(() => { live.forEach((obs) => obs.onResize([{ contentRect: { width } }])) })
}

const triggerResize = vi.fn()

/** Stands in for an @ant-design/plots component: hands its instance to `onReady` on mount. */
const FakePlot = ({ onReady }: { onReady: (plot: { triggerResize: () => void }) => void }) => {
  useEffect(() => { onReady({ triggerResize }) }, [onReady])
  return null
}

const Probe = () => {
  const { onReady, ref, width } = useAutoFitChart<HTMLDivElement>()
  return <div ref={ref}>{width > 0 ? <FakePlot onReady={onReady} /> : null}</div>
}

describe('useAutoFitChart', () => {
  afterEach(() => {
    cleanup()
    observers.length = 0
    triggerResize.mockClear()
  })

  it('re-fits the chart when its container comes back from display:none at the SAME width (#603)', () => {
    render(<Probe />)
    // First measurement: mounts the chart (the width gate opens) at 532.
    resize(532)
    triggerResize.mockClear()

    // The tab pane is hidden: nothing to fit to.
    resize(0)
    expect(triggerResize, 'a hidden (0-wide) container must not be fitted — G2 would fall back to 640px').not.toHaveBeenCalled()

    // The tab is shown again, at the same width as before.
    resize(532)
    expect(triggerResize, 'the chart was not re-fitted when its tab came back, so a canvas drawn while hidden stays at G2\'s 640px default').toHaveBeenCalledTimes(1)
  })

  it('re-fits on a container resize the window never saw', () => {
    render(<Probe />)
    resize(800)
    triggerResize.mockClear()
    // E.g. the sidebar expanded: the container shrank, the window did not resize.
    resize(560)
    expect(triggerResize).toHaveBeenCalledTimes(1)
  })
})
