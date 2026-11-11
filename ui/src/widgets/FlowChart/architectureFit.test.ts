/**
 * ADAPT, NEVER CLIP — `architectureFit`, the decision the architecture graph is drawn with: in this
 * order, the rank gap, the compact card, a scale down to the type floor; past it, the fade. Pure, so
 * every box width is a row here.
 *
 * The chain is builder-publish's (V1B): four ranks, one card each — 1360px at true size, the graph
 * that lost its fourth card on every builder-publish composition (1179px of box at a 1456px window,
 * ~1000px at 1280).
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { NATURAL_PADDING } from '../../components/DependencyGraph'
import { textPx } from '../../theme/tokens'

import { V1B } from './__fixtures__/architecture'
import {
  ARCHITECTURE_COMPACT_SPACING,
  ARCHITECTURE_MIN_RANK_GAP,
  ARCHITECTURE_RANK_GAP_STEP,
  ARCHITECTURE_TEXT_ROLES,
  ARCHITECTURE_TYPE_FLOOR,
  architectureFit,
  architectureMinScale,
  architectureShape,
  toArchitectureGraphData,
  type ArchitectureFit,
  type ArchitectureShape,
} from './architectureVariant'

const graph = toArchitectureGraphData(V1B)
const CHAIN = architectureShape(graph.nodes, graph.edges)

/** The composition page's box is 360px tall; LR measures only its width. */
const lr = (width: number, density?: 'compact' | 'regular'): ArchitectureFit =>
  architectureFit(CHAIN, { box: [width, 360], density, direction: 'LR' })

/** The row of the decision table: [step, density, rank gap, scale, drawn width, fade]. */
const row = ({ density, overflows, rankGap, scale, size, step }: ArchitectureFit) => [step, density, rankGap, scale, size[0], overflows]

describe('the builder-publish chain', () => {
  it('is four ranks of one card', () => {
    expect(CHAIN).toEqual({ broadest: 1, ranks: 4 })
  })

  // The box width → what is drawn. "Fits" is the placement's: the drawing plus 16px either side.
  it.each([
    // 1360 + 32 ≤ 1400: as designed, C19's 160px gaps.
    [1400, ['none', 'regular', 160, 1, 1360, false]],
    // 1147px of room: 3 gaps of (1147 − 880) / 3 = 89px, stepped down to 88.
    [1179, ['gap', 'regular', 88, 1, 1144, false]],
    // 1016px of room: regular needs 880 + 3 × 56 = 1048 at the minimum gap. Compact at its own 32px:
    // 4 × 180 + 3 × 32 = 816.
    [1048, ['compact', 'compact', 32, 1, 816, false]],
    [1000, ['compact', 'compact', 32, 1, 816, false]],
    [900, ['compact', 'compact', 32, 1, 816, false]],
    // 728px of room under 816: step 3 would scale, but the compact card's detail line is 12px — the
    // floor — so it may not shrink at all. Compact, true size, left edge pinned, the fade.
    [760, ['overflow', 'compact', 32, 1, 816, true]],
    [600, ['overflow', 'compact', 32, 1, 816, true]],
    [400, ['overflow', 'compact', 32, 1, 816, true]],
  ] as const)('in a %ipx box: %j', (width, expected) => {
    expect(row(lr(width))).toEqual(expected)
  })

  it('CONTROL: without the adaptation (true size, C19 gaps) every one of those boxes but 1400 clips', () => {
    for (const width of [1179, 1048, 1000, 900, 760, 600, 400]) {
      expect(1360 + NATURAL_PADDING > width).toBe(true)
    }
  })

  it('never makes the LR graph taller: the box height holds what it held', () => {
    const [, designed] = lr(1400).size
    for (let width = 200; width <= 2000; width += 1) {
      expect(lr(width).size[1]).toBeLessThanOrEqual(designed)
    }
  })
})

describe('the order, at every width', () => {
  const ORDER = ['none', 'gap', 'compact', 'scale', 'overflow']

  it.each([
    ['the builder-publish chain', CHAIN],
    ['one card', { broadest: 1, ranks: 1 }],
    ['two ranks', { broadest: 1, ranks: 2 }],
    ['six ranks, three wide', { broadest: 3, ranks: 6 }],
  ])('%s: narrowing the box only ever moves to a later step, and what is not past the floor fits', (_name, shape: ArchitectureShape) => {
    let reached = 0
    for (let width = 2400; width >= 120; width -= 1) {
      const fit = architectureFit(shape, { box: [width, 360], direction: 'LR' })
      const at = ORDER.indexOf(fit.step)
      expect(at).toBeGreaterThanOrEqual(reached)
      reached = at
      if (fit.step === 'overflow') {
        continue
      }
      expect(fit.size[0] + 2 * NATURAL_PADDING).toBeLessThanOrEqual(width)
      expect(fit.overflows).toBe(false)
      expect(fit.rankGap).toBeGreaterThanOrEqual(Math.min(fit.density === 'compact' ? 32 : 160, ARCHITECTURE_MIN_RANK_GAP))
    }
  })

  it('a shrunk gap is a multiple of the step, never under the minimum, never over the density\'s own', () => {
    for (let width = 1400; width >= 1000; width -= 1) {
      const fit = lr(width)
      if (fit.step === 'gap') {
        expect(fit.rankGap % ARCHITECTURE_RANK_GAP_STEP).toBe(0)
        expect(fit.rankGap).toBeGreaterThanOrEqual(ARCHITECTURE_MIN_RANK_GAP)
        expect(fit.rankGap).toBeLessThan(160)
      }
    }
  })

  it('takes the WIDEST gap that fits: one step wider would not', () => {
    const fit = lr(1179)
    expect(4 * 220 + 3 * (fit.rankGap + ARCHITECTURE_RANK_GAP_STEP) + 2 * NATURAL_PADDING).toBeGreaterThan(1179)
  })
})

describe('a single node', () => {
  const ONE = { broadest: 1, ranks: 1 }
  it.each([
    [1400, ['none', 'regular', 160, 1, 220, false]],
    // 220 + 32 > 240: the compact card (212) fits.
    [240, ['compact', 'compact', 32, 1, 180, false]],
    // Not even compact: the fade, at true size.
    [200, ['overflow', 'compact', 32, 1, 180, false]],
    [150, ['overflow', 'compact', 32, 1, 180, true]],
  ] as const)('in a %ipx box: %j', (width, expected) => {
    expect(row(architectureFit(ONE, { box: [width, 360], direction: 'LR' }))).toEqual(expected)
  })
})

describe('an explicit density is the author\'s floor', () => {
  it('regular never becomes compact: it closes its gaps, then overflows', () => {
    expect(row(lr(1400, 'regular'))).toEqual(['none', 'regular', 160, 1, 1360, false])
    expect(row(lr(1179, 'regular'))).toEqual(['gap', 'regular', 88, 1, 1144, false])
    // 880 + 3 × 56 = 1048 against 968px of room, and the regular card's 10px eyebrow is already under
    // the floor, so it does not scale either.
    expect(row(lr(1000, 'regular'))).toEqual(['overflow', 'regular', 56, 1, 1048, true])
  })

  it('compact stays compact, and its 32px gap is already under the minimum, so it has nothing to close', () => {
    expect(row(lr(1400, 'compact'))).toEqual(['none', 'compact', 32, 1, 816, false])
    expect(row(lr(760, 'compact'))).toEqual(['overflow', 'compact', 32, 1, 816, true])
  })

  it('CONTROL: not setting it is what lets the same box step down to compact', () => {
    expect(lr(1000).density).toBe('compact')
    expect(lr(1000, 'regular').density).toBe('regular')
  })
})

describe('TB: the gap runs down the box, so its height is measured, and the width against the broadest row', () => {
  // The trace page's services column: ~415 × 360.
  const tb = (shape: ArchitectureShape, box: [number, number], density?: 'compact' | 'regular') =>
    architectureFit(shape, { box, density, direction: 'TB' })

  it('four ranks, density not set: regular cannot fit 328px of height even at 56px gaps (504), compact does (320)', () => {
    const fit = tb({ broadest: 1, ranks: 4 }, [415, 360])
    expect([fit.step, fit.density, fit.rankGap, fit.size, fit.overflows, fit.overflowsBelow]).toEqual(['compact', 'compact', 32, [180, 320], false, false])
  })

  it('three ranks in a taller box: the regular card with its vertical gap closed to fit', () => {
    // 600 − 32 = 568px: 3 × 84 + 2 × g ≤ 568 → g ≤ 158, stepped to 152.
    const fit = tb({ broadest: 1, ranks: 3 }, [415, 600])
    expect([fit.step, fit.density, fit.rankGap, fit.size]).toEqual(['gap', 'regular', 152, [220, 556]])
  })

  it('explicit compact, six deep: past the floor it runs off the bottom, and says so there only', () => {
    const fit = tb({ broadest: 1, ranks: 6 }, [415, 360], 'compact')
    expect([fit.step, fit.size, fit.overflows, fit.overflowsBelow]).toEqual(['overflow', [180, 496], false, true])
  })

  it('a row wider than the box is the right-hand fade, whatever the gap', () => {
    const fit = tb({ broadest: 3, ranks: 2 }, [415, 360], 'compact')
    expect([fit.step, fit.overflows, fit.overflowsBelow]).toEqual(['overflow', true, false])
  })

  it('LR measures no height: a column taller than the box changes nothing', () => {
    const fit = architectureFit({ broadest: 5, ranks: 2 }, { box: [1200, 360], direction: 'LR' })
    expect([fit.step, fit.density, fit.overflowsBelow]).toEqual(['none', 'regular', false])
  })
})

describe('the type floor (step 3)', () => {
  it('is computed from the roles the card is set in: today 12px is the compact card\'s smallest, so it scales nothing', () => {
    expect(Math.min(...ARCHITECTURE_TEXT_ROLES.compact.map(textPx))).toBe(12)
    expect(architectureMinScale('compact')).toBe(1)
    // The regular card's eyebrow is 10px, under the floor at true size: it is never shrunk further.
    expect(Math.min(...ARCHITECTURE_TEXT_ROLES.regular.map(textPx))).toBe(10)
    expect(architectureMinScale('regular')).toBe(1)
    expect(ARCHITECTURE_TYPE_FLOOR).toBe(12)
  })

  // At a type scale whose smallest compact text is 15px, the floor is 12 / 15 = 0.8.
  const larger = () => 15
  const scaled = (width: number) => architectureFit(CHAIN, { box: [width, 360], direction: 'LR', roleSize: larger })

  it('scales down just enough to fit, rounded DOWN so the drawing never misses the box by a pixel', () => {
    expect(architectureMinScale('compact', larger)).toBe(0.8)
    // 728 / 816 = 0.892…
    const fit = scaled(760)
    expect([fit.step, fit.density, fit.rankGap, fit.scale, fit.overflows]).toEqual(['scale', 'compact', 32, 0.89, false])
    expect(fit.size[0] + 2 * NATURAL_PADDING).toBeLessThanOrEqual(760)
  })

  it('stops at the floor: as small as it may be, then the fade', () => {
    // 568 / 816 = 0.69, under 0.8.
    const fit = scaled(600)
    expect([fit.step, fit.scale, fit.size[0], fit.overflows]).toEqual(['overflow', 0.8, 816 * 0.8, true])
  })

  it('scales TB against both the height and the broadest row', () => {
    const fit = architectureFit({ broadest: 1, ranks: 6 }, { box: [415, 360], density: 'compact', direction: 'TB', roleSize: larger })
    // 328 / 496 = 0.661…, under 0.8: the floor.
    expect([fit.step, fit.scale, fit.overflowsBelow]).toEqual(['overflow', 0.8, true])
    const five = architectureFit({ broadest: 1, ranks: 5 }, { box: [415, 360], density: 'compact', direction: 'TB', roleSize: larger })
    // 5 × 56 + 4 × 32 = 408; 328 / 408 = 0.80…
    expect([five.step, five.scale, five.overflowsBelow]).toEqual(['scale', 0.8, false])
  })
})

describe('what DependencyGraph is handed', () => {
  it('a box not laid out yet decides nothing: the CR\'s card at its own gaps, C19\'s spacing left undefined', () => {
    const fit = architectureFit(CHAIN, { box: [0, 0], direction: 'LR' })
    expect([fit.step, fit.density, fit.rankGap, fit.scale, fit.spacing]).toEqual(['unmeasured', 'regular', 160, 1, undefined])
    expect(architectureFit(CHAIN, { box: [0, 0], density: 'compact', direction: 'TB' }).density).toBe('compact')
  })

  it('regular at its own gap is C19\'s, undefined, exactly what a CR that sets nothing always handed G6', () => {
    expect(lr(1400).spacing).toBeUndefined()
  })

  it('a shrunk gap keeps regular\'s 32px between siblings', () => {
    expect(lr(1179).spacing).toEqual({ nodesep: 32, ranksep: 88 })
  })

  it('compact is its module constant', () => {
    expect(lr(1000).spacing).toBe(ARCHITECTURE_COMPACT_SPACING)
  })

  it('the SAME object for the same gap, so a resize that keeps the gap is no re-layout', () => {
    expect(lr(1179).spacing).toBe(lr(1180).spacing)
    expect(lr(1179).spacing).not.toBe(lr(1300).spacing)
  })
})

describe('ARCHITECTURE_TEXT_ROLES is the stylesheet\'s', () => {
  const css = readFileSync(new URL('./ArchitectureStateNode/ArchitectureStateNode.module.css', import.meta.url), 'utf8')
  /** Each rule's selector → the type role of its `font-size`, for the rules that set one. */
  const roles = new Map(
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .map(([, selector, body]) => [selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(), /font-size:\s*var\(--krateo-text-([a-z-]+)\)/.exec(body)?.[1]] as const)
      .filter((rule): rule is readonly [string, string] => rule[1] !== undefined),
  )

  it('every font-size on the card is one of the four lines', () => {
    expect([...roles.keys()].sort()).toEqual(['.detail', '.exception', '.kind', '.name'])
  })

  it('regular renders all four; compact the name and the detail (no kind line, the exception a bare dot)', () => {
    const of = (classes: string[]) => [...new Set(classes.map((name) => roles.get(name)))].sort()
    expect(of(['.kind', '.name', '.detail', '.exception'])).toEqual([...ARCHITECTURE_TEXT_ROLES.regular].sort())
    expect(of(['.name', '.detail'])).toEqual([...ARCHITECTURE_TEXT_ROLES.compact].sort())
  })
})
