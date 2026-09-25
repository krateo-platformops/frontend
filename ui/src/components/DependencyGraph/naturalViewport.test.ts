/**
 * The true-size placement, against a fake viewport: a graph's content box in canvas coordinates, the
 * box it is drawn in, and a camera that only translates (zoom is pinned at 1 by the first call). The
 * real G6 behaviour — cards measured at 156×72 in Chromium — is what this arithmetic was checked
 * against; this pins the arithmetic.
 */
import { describe, expect, it } from 'vitest'

import { NATURAL_PADDING, placeAtNaturalSize, revealOffset, type NaturalViewportGraph } from './naturalViewport'

/** A camera over content spanning [x0, x1] × [y0, y1], in a box of `size`, centred by fitCenter. */
const viewport = (content: [number, number, number, number], size: [number, number]) => {
  const [x0, y0, x1, y1] = content
  const calls: string[] = []
  let shift: [number, number] = [0, 0]
  const graph = {
    fitCenter: () => {
      calls.push('fitCenter')
      shift = [size[0] / 2 - (x0 + x1) / 2, size[1] / 2 - (y0 + y1) / 2]
      return Promise.resolve()
    },
    getCanvas: () => ({ getBounds: () => ({ max: [x1, y1, 0], min: [x0, y0, 0] }) }),
    getSize: () => size,
    getViewportByCanvas: ([x, y]: number[]) => [x + shift[0], y + shift[1]],
    translateBy: ([dx, dy]: number[]) => {
      calls.push(`translateBy ${dx},${dy}`)
      shift = [shift[0] + dx, shift[1] + dy]
      return Promise.resolve()
    },
    zoomTo: (zoom: number) => {
      calls.push(`zoomTo ${zoom}`)
      return Promise.resolve()
    },
  }
  return { calls, graph: graph as unknown as NaturalViewportGraph, left: () => x0 + shift[0], top: () => y0 + shift[1] }
}

describe('placeAtNaturalSize — cards at the size they were designed at', () => {
  it('never scales: zoom 1, whatever the box — one small card is not blown up to fill it', async () => {
    const { calls, graph } = viewport([0, 0, 156, 72], [780, 360])
    await placeAtNaturalSize(graph)
    expect(calls.filter((call) => call.startsWith('zoomTo'))).toEqual(['zoomTo 1'])
  })

  it('a graph that fits is centred, and nothing else moves it', async () => {
    const { calls, graph, left } = viewport([0, 0, 472, 176], [914, 360])
    await placeAtNaturalSize(graph)
    expect(calls).toEqual(['zoomTo 1', 'fitCenter'])
    expect(left()).toBe((914 - 472) / 2)
  })

  it('a graph WIDER than its box keeps its first column in view: left edge pinned, not both ends cut', async () => {
    // builder-publish at 1:1 — four columns of 156 with 160 between them — in an 826px box.
    const { calls, graph, left, top } = viewport([0, 0, 1104, 176], [826, 360])
    await placeAtNaturalSize(graph)
    expect(left()).toBe(NATURAL_PADDING)
    expect(top()).toBe((360 - 176) / 2)
    expect(calls).toHaveLength(3)
  })

  it('a graph TALLER than its box keeps its top row in view', async () => {
    const { graph, top } = viewport([0, 0, 300, 900], [914, 360])
    await placeAtNaturalSize(graph)
    expect(top()).toBe(NATURAL_PADDING)
  })
})

describe('revealOffset — a focused card, panned fully into its box', () => {
  const box = { bottom: 360, left: 0, right: 826, top: 0 }
  it('past the right edge: left, by the overshoot and the margin', () => {
    expect(revealOffset({ bottom: 170, left: 758, right: 914, top: 98 }, box)).toEqual([826 - NATURAL_PADDING - 914, 0])
  })
  it('past the LEFT edge — where no scroll can reach — right', () => {
    expect(revealOffset({ bottom: 170, left: -190, right: -34, top: 98 }, box)).toEqual([190 + NATURAL_PADDING, 0])
  })
  it('in view: nothing moves', () => {
    expect(revealOffset({ bottom: 170, left: 300, right: 456, top: 98 }, box)).toEqual([0, 0])
  })
})
