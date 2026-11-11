// @vitest-environment jsdom
/**
 * ADAPT, NEVER CLIP, mounted: the architecture FlowChart measures its box and hands G6 the gap, the
 * card and the zoom `architectureFit` decides — and paints portal#310's fade only when, past the type
 * floor, the graph still runs past the box. The decision itself is architectureFit.test.ts; this is
 * the wiring, on builder-publish's four-rank chain (V1B).
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'

import { V1B } from './__fixtures__/architecture'
import FlowChart from './FlowChart'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

const REFS = { items: [] }

type Drawn = { layout: { ranksep: number }; node: { style: { size: [number, number] } } }

let width = 0
/** jsdom lays nothing out: the box reports what the composition page gives it, 360px tall. */
const sizeTheBox = (to: number) => {
  width = to
}

/** Every ResizeObserver callback mounted, so a test can resize the box the way the browser does. */
const observers: (() => void)[] = []
const resize = (to: number) => {
  sizeTheBox(to)
  act(() => { observers.forEach((notify) => notify()) })
}

beforeEach(() => {
  graphDouble.reset()
  observers.length = 0
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
  vi.stubGlobal('ResizeObserver', class {
    constructor(notify: () => void) { observers.push(notify) }
    disconnect = vi.fn()
    observe = vi.fn()
    unobserve = vi.fn()
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  width = 0
})

const draw = (extra: Record<string, unknown> = {}) =>
  render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={{ data: V1B, variant: 'architecture', ...extra }} />)

const box = () => screen.getByTestId('architecture-graph-box')
const drawn = () => graphDouble.last() as unknown as Drawn
const cards = () => screen.getAllByRole('group').map((card) => card.dataset.density ?? 'regular')

describe('the fade is the last resort', () => {
  it('1179px (a 1456px window): the regular card with its gaps closed to 88px, and no fade', () => {
    sizeTheBox(1179)
    draw()
    expect(drawn().layout.ranksep).toBe(88)
    expect(drawn().node.style.size).toEqual([220, 84])
    expect(box().dataset.overflows).toBeUndefined()
  })

  it('1000px (a 1280px window): the compact card, and no fade', () => {
    sizeTheBox(1000)
    draw()
    expect(drawn().node.style.size).toEqual([180, 56])
    expect(new Set(cards())).toEqual(new Set(['compact']))
    expect(box().dataset.overflows).toBeUndefined()
  })

  it('760px: past the floor (the compact card cannot shrink under its 12px detail line), so the fade', () => {
    sizeTheBox(760)
    draw()
    expect(drawn().node.style.size).toEqual([180, 56])
    expect(box().dataset.overflows).toBe('true')
  })

  it('a box wide enough for the design draws it as designed: C19\'s gap, and no fade', () => {
    sizeTheBox(1400)
    draw()
    expect(drawn().layout.ranksep).toBe(160)
    expect(box().dataset.overflows).toBeUndefined()
  })

  it('CONTROL: an explicit regular is the author\'s floor — at 1000px it closes its gaps, stays regular, and fades', () => {
    sizeTheBox(1000)
    draw({ density: 'regular' })
    expect(drawn().node.style.size).toEqual([220, 84])
    expect(drawn().layout.ranksep).toBe(56)
    expect(box().dataset.overflows).toBe('true')
  })

  it('places at zoom 1: today\'s floor never scales a card', async () => {
    sizeTheBox(760)
    draw()
    await vi.waitFor(() => expect(graphDouble.viewport).toContain('fitCenter'))
    expect(graphDouble.viewport.filter((call) => call.startsWith('zoomTo'))).toEqual(['zoomTo 1'])
  })
})

describe('recomputed when the box is resized', () => {
  it('follows the box both ways: regular → compact → overflow → regular again', () => {
    sizeTheBox(1400)
    draw()
    expect(drawn().layout.ranksep).toBe(160)
    resize(1000)
    expect(drawn().node.style.size).toEqual([180, 56])
    expect(box().dataset.overflows).toBeUndefined()
    resize(700)
    expect(box().dataset.overflows).toBe('true')
    resize(1179)
    expect(drawn().node.style.size).toEqual([220, 84])
    expect(drawn().layout.ranksep).toBe(88)
    expect(box().dataset.overflows).toBeUndefined()
  })

  it('a resize that keeps the same gap hands G6 nothing new: no re-layout', () => {
    sizeTheBox(1179)
    draw()
    const renders = graphDouble.renders.length
    resize(1180)
    expect(graphDouble.renders.length).toBe(renders)
  })

  it('the graph is created once, already adapted — never at true size first', () => {
    sizeTheBox(1000)
    draw()
    expect(graphDouble.renders.map((options) => (options as unknown as Drawn).node.style.size)).toEqual([[180, 56]])
  })
})
