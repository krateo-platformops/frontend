// @vitest-environment jsdom
/**
 * The measured element may not exist at mount: a chart renders its empty state first and its canvas
 * container only once data arrives. The observer must attach then, or the chart stays blank.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useMeasuredWidth } from './useMeasuredWidth'

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

const Probe = ({ hasData }: { hasData: boolean }) => {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>()
  if (!hasData) { return <p>empty</p> }
  return <div data-testid='box' ref={ref}>{width}</div>
}

const resize = (width: number) => {
  const live = observers.filter((obs) => obs.el && !obs.disconnected)
  act(() => { live.forEach((obs) => obs.onResize([{ contentRect: { width } }])) })
}

describe('useMeasuredWidth', () => {
  afterEach(() => {
    cleanup()
    observers.length = 0
  })

  it('measures an element present at mount', () => {
    const { getByTestId } = render(<Probe hasData />)
    resize(640)
    expect(getByTestId('box').textContent).toBe('640')
  })

  it('measures an element that appears AFTER mount (empty state first, data later)', () => {
    const { getByTestId, rerender } = render(<Probe hasData={false} />)
    expect(observers.filter((obs) => obs.el)).toHaveLength(0)
    rerender(<Probe hasData />)
    resize(801)
    expect(getByTestId('box').textContent).toBe('801')
  })

  it('disconnects when the element goes away', () => {
    const { rerender } = render(<Probe hasData />)
    rerender(<Probe hasData={false} />)
    expect(observers.every((obs) => !obs.el || obs.disconnected)).toBe(true)
  })
})
