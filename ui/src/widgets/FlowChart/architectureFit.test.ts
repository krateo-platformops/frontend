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
  ARCHITECTURE_DENSITY,
  ARCHITECTURE_NODE_SIZE,
  ARCHITECTURE_MIN_RANK_GAP,
  ARCHITECTURE_RANK_GAP_STEP,
  ARCHITECTURE_TEXT_ROLES,
  ARCHITECTURE_TYPE_FLOOR,
  architectureFit,
  architectureMinScale,
  architectureNodeSize,
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
  it('is four ranks of one card, on one baseline', () => {
    // One row (the baseline), and Repository → LocalResource arcs over the Repo: one arc level.
    expect(CHAIN).toEqual({ arcLevels: 1, broadest: 1, ranks: 4, rows: 1 })
  })

  // The box width → what is drawn. "Fits" is the placement's: the drawing plus 16px either side.
  // The regular card is 240px: four of them are 960px before any gap.
  it.each([
    // 960 + 3 × 160 = 1440, and 1440 + 32 ≤ 1472: as designed, C19's 160px gaps.
    [1472, ['none', 'regular', 160, 1, 1440, false]],
    // 1368px of room: 3 gaps of (1368 − 960) / 3 = 136px, already a multiple of 8. 960 + 408 = 1368.
    [1400, ['gap', 'regular', 136, 1, 1368, false]],
    // 1147px of room: (1147 − 960) / 3 = 62.3px, stepped down to 56 — the minimum. 960 + 168 = 1128.
    [1179, ['gap', 'regular', 56, 1, 1128, false]],
    // The edge of the regular card: 1128px of room is exactly 960 + 3 × 56; a pixel less is compact.
    [1160, ['gap', 'regular', 56, 1, 1128, false]],
    [1159, ['compact', 'compact', 32, 1, 816, false]],
    // 1016px of room: regular needs 1128 at the minimum gap. Compact at its own 32px:
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

  it('CONTROL: without the adaptation (true size, C19 gaps) every one of those boxes but 1472 clips', () => {
    expect(4 * ARCHITECTURE_NODE_SIZE[0] + 3 * 160).toBe(1440)
    expect(1440 + NATURAL_PADDING > 1472).toBe(false)
    for (const width of [1400, 1179, 1160, 1159, 1048, 1000, 900, 760, 600, 400]) {
      expect(1440 + NATURAL_PADDING > width).toBe(true)
    }
  })

  it('never makes the LR graph taller: the box height holds what it held', () => {
    const [, designed] = lr(1472).size
    for (let width = 200; width <= 2000; width += 1) {
      expect(lr(width).size[1]).toBeLessThanOrEqual(designed)
    }
  })
})

describe('the order, at every width', () => {
  const ORDER = ['none', 'gap', 'compact', 'scale', 'overflow']

  it.each([
    ['the builder-publish chain', CHAIN],
    ['one card', { arcLevels: 0, broadest: 1, ranks: 1, rows: 1 }],
    ['two ranks', { arcLevels: 0, broadest: 1, ranks: 2, rows: 1 }],
    ['six ranks, three wide', { arcLevels: 0, broadest: 3, ranks: 6, rows: 3 }],
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
    for (let width = 1472; width >= 1000; width -= 1) {
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
    expect(4 * ARCHITECTURE_NODE_SIZE[0] + 3 * (fit.rankGap + ARCHITECTURE_RANK_GAP_STEP) + 2 * NATURAL_PADDING).toBeGreaterThan(1179)
    const wide = lr(1400)
    expect(4 * ARCHITECTURE_NODE_SIZE[0] + 3 * (wide.rankGap + ARCHITECTURE_RANK_GAP_STEP) + 2 * NATURAL_PADDING).toBeGreaterThan(1400)
  })
})

describe('a single node', () => {
  const ONE = { arcLevels: 0, broadest: 1, ranks: 1, rows: 1 }
  it.each([
    [1400, ['none', 'regular', 160, 1, 240, false]],
    // 240 + 32 = 272 is the regular card's edge; under it the compact card (180 + 32 = 212) fits.
    [272, ['none', 'regular', 160, 1, 240, false]],
    [271, ['compact', 'compact', 32, 1, 180, false]],
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
    expect(row(lr(1472, 'regular'))).toEqual(['none', 'regular', 160, 1, 1440, false])
    expect(row(lr(1179, 'regular'))).toEqual(['gap', 'regular', 56, 1, 1128, false])
    // 960 + 3 × 56 = 1128 against 968px of room, and the regular card's smallest text (12px) is
    // already at the floor, so it does not scale either.
    expect(row(lr(1000, 'regular'))).toEqual(['overflow', 'regular', 56, 1, 1128, true])
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
    const fit = tb({ arcLevels: 0, broadest: 1, ranks: 4, rows: 1 }, [415, 360])
    expect([fit.step, fit.density, fit.rankGap, fit.size, fit.overflows, fit.overflowsBelow]).toEqual(['compact', 'compact', 32, [180, 320], false, false])
  })

  it('three ranks in a taller box: the regular card with its vertical gap closed to fit', () => {
    // 600 − 32 = 568px: 3 × 84 + 2 × g ≤ 568 → g ≤ 158, stepped to 152. One 240px card is the width.
    const fit = tb({ arcLevels: 0, broadest: 1, ranks: 3, rows: 1 }, [415, 600])
    expect([fit.step, fit.density, fit.rankGap, fit.size]).toEqual(['gap', 'regular', 152, [240, 556]])
  })

  it('explicit compact, six deep: past the floor it runs off the bottom, and says so there only', () => {
    const fit = tb({ arcLevels: 0, broadest: 1, ranks: 6, rows: 1 }, [415, 360], 'compact')
    expect([fit.step, fit.size, fit.overflows, fit.overflowsBelow]).toEqual(['overflow', [180, 496], false, true])
  })

  it('a row wider than the box is the right-hand fade, whatever the gap', () => {
    const fit = tb({ arcLevels: 0, broadest: 3, ranks: 2, rows: 3 }, [415, 360], 'compact')
    expect([fit.step, fit.overflows, fit.overflowsBelow]).toEqual(['overflow', true, false])
  })

  it('LR measures no height: a column taller than the box changes nothing', () => {
    const fit = architectureFit({ arcLevels: 0, broadest: 5, ranks: 2, rows: 5 }, { box: [1200, 360], direction: 'LR' })
    expect([fit.step, fit.density, fit.overflowsBelow]).toEqual(['none', 'regular', false])
  })
})

describe('the type floor (step 3)', () => {
  it('is computed from the roles the card is set in: today 12px is both cards\' smallest, so it scales nothing', () => {
    // Both densities' smallest text is `text-caption`, AT the floor: any scale under 1 would put it
    // under 12px, so the minimum scale is 1 and step 3 never applies to today's card.
    expect(Math.min(...ARCHITECTURE_TEXT_ROLES.compact.map(textPx))).toBe(12)
    expect(architectureMinScale('compact')).toBe(1)
    expect(Math.min(...ARCHITECTURE_TEXT_ROLES.regular.map(textPx))).toBe(12)
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
    const fit = architectureFit({ arcLevels: 0, broadest: 1, ranks: 6, rows: 1 }, { box: [415, 360], density: 'compact', direction: 'TB', roleSize: larger })
    // 328 / 496 = 0.661…, under 0.8: the floor.
    expect([fit.step, fit.scale, fit.overflowsBelow]).toEqual(['overflow', 0.8, true])
    const five = architectureFit({ arcLevels: 0, broadest: 1, ranks: 5, rows: 1 }, { box: [415, 360], density: 'compact', direction: 'TB', roleSize: larger })
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
    expect(lr(1472).spacing).toBeUndefined()
  })

  it('a shrunk gap keeps regular\'s 32px between siblings', () => {
    expect(lr(1179).spacing).toEqual({ nodesep: 32, ranksep: 56 })
    expect(lr(1400).spacing).toEqual({ nodesep: 32, ranksep: 136 })
  })

  it('compact is its module constant', () => {
    expect(lr(1000).spacing).toBe(ARCHITECTURE_COMPACT_SPACING)
  })

  it('the SAME object for the same gap, so a resize that keeps the gap is no re-layout', () => {
    expect(lr(1179).spacing).toBe(lr(1180).spacing)
    expect(lr(1179).spacing).not.toBe(lr(1300).spacing)
  })
})

describe('a card taller than 84px: every name in full', () => {
  // The regular card wraps its name, and FlowChart measures the tallest card. That height is every
  // regular card's box, so the layout makes room for it and no card runs into the one under it.
  it('is the box every regular card takes; 84px or less is ARCHITECTURE_NODE_SIZE itself, compact is fixed', () => {
    expect(architectureNodeSize('regular')).toBe(ARCHITECTURE_NODE_SIZE)
    expect(architectureNodeSize('regular', 84)).toBe(ARCHITECTURE_NODE_SIZE)
    expect(architectureNodeSize('regular', 100)).toEqual([240, 100])
    // One object per height: a new nodeSize is a re-layout in DependencyGraph.
    expect(architectureNodeSize('regular', 100)).toBe(architectureNodeSize('regular', 100))
    expect(architectureNodeSize('compact', 100)).toBe(ARCHITECTURE_DENSITY.compact.nodeSize)
  })

  it('LR: changes no width, so no step — only the drawing\'s height, and with it the box\'s', () => {
    const at84 = architectureFit(CHAIN, { box: [1179, 360], direction: 'LR' })
    const at100 = architectureFit(CHAIN, { box: [1179, 360], cardHeight: 100, direction: 'LR' })
    expect(row(at100)).toEqual(row(at84))
    // One row of cards under one arc level: the height grows by exactly the card's 16px.
    expect(at100.size[1] - at84.size[1]).toBe(16)
  })

  it('LR: eight branch rows (portal#427\'s eight LocalResources) grow by 16px each', () => {
    const shape = { arcLevels: 1, broadest: 8, ranks: 4, rows: 8 }
    const at84 = architectureFit(shape, { box: [1179, 360], direction: 'LR' })
    const at100 = architectureFit(shape, { box: [1179, 360], cardHeight: 100, direction: 'LR' })
    expect(at100.size[1] - at84.size[1]).toBe(8 * 16)
  })

  it('TB: the taller card is what is fitted down the box', () => {
    // 600 − 32 = 568px: 3 × 100 + 2 × g ≤ 568 → g ≤ 134, stepped to 128 (at 84px it was 152).
    const fit = architectureFit({ arcLevels: 0, broadest: 1, ranks: 3, rows: 1 }, { box: [415, 600], cardHeight: 100, direction: 'TB' })
    expect([fit.step, fit.density, fit.rankGap, fit.size]).toEqual(['gap', 'regular', 128, [240, 556]])
  })
})

describe('ARCHITECTURE_DENSITY is the stylesheet\'s box', () => {
  // The card's CSS box and the box dagre reserves are two spellings of one size: every width the fit
  // decision computes is ARCHITECTURE_DENSITY's, so a stylesheet that drew another would put cards
  // over their own edges (C19). Pinned here, so the two cannot drift.
  const css = readFileSync(new URL('./ArchitectureStateNode/ArchitectureStateNode.module.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const box = (selector: string): [number, number] => {
    const body = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, each]) => each.trim() === selector)?.[2] ?? ''
    const px = (property: string) => Number(new RegExp(`(?:^|[;\\s])${property}:\\s*(\\d+)px`).exec(body)?.[1])
    return [px('width'), px('height') || px('min-height')]
  }

  it('regular: .card is ARCHITECTURE_NODE_SIZE, 240 wide and at least 84 tall, border-box', () => {
    // A minimum: the card grows to show its name in full, and FlowChart reserves the tallest card's
    // height (architectureNodeSize, below).
    expect(box('.card')).toEqual(ARCHITECTURE_DENSITY.regular.nodeSize)
    expect(css).toMatch(/\.card \{[^}]*min-height: 84px/)
    expect(ARCHITECTURE_NODE_SIZE).toEqual([240, 84])
    expect(css).toMatch(/\.card \{[^}]*box-sizing: border-box/)
  })

  it('compact: .card[data-density=\'compact\'] is 180×56', () => {
    expect(box(".card[data-density='compact']")).toEqual(ARCHITECTURE_DENSITY.compact.nodeSize)
    expect(ARCHITECTURE_DENSITY.compact.nodeSize).toEqual([180, 56])
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

  it('no text on either card density is under the 12px type floor: every font-size is a role token at 12px or more', () => {
    // EVERY `font-size` declaration, not only the token ones the map above reads: a literal (or a
    // calc) would slip past a token-only match. Both densities share these rules — compact adds
    // none — so a role under the floor anywhere in the sheet is under it on some card.
    const declarations = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/font-size:\s*([^;}]+)/g)].map(([, value]) => value.trim())
    expect(declarations.length).toBeGreaterThan(0)
    for (const value of declarations) {
      const role = /^var\(--krateo-text-([a-z-]+)\)$/.exec(value)?.[1]
      expect(role, `font-size: ${value} is not a --krateo-text-* role`).toBeDefined()
      expect(textPx(role!), `font-size: ${value}`).toBeGreaterThanOrEqual(ARCHITECTURE_TYPE_FLOOR)
    }
    for (const density of ['compact', 'regular'] as const) {
      for (const role of ARCHITECTURE_TEXT_ROLES[density]) {
        expect(textPx(role), `${density}: ${role}`).toBeGreaterThanOrEqual(ARCHITECTURE_TYPE_FLOOR)
      }
    }
  })

  it('every font-size on the card is one of the four lines', () => {
    expect([...roles.keys()].sort()).toEqual(['.detail', '.exception', '.kind', '.name'])
  })

  it('regular renders all four; compact the name and the detail (no kind line, the exception a bare dot)', () => {
    const of = (classes: string[]) => [...new Set(classes.map((name) => roles.get(name)))].sort()
    expect(of(['.kind', '.name', '.detail', '.exception'])).toEqual([...ARCHITECTURE_TEXT_ROLES.regular].sort())
    expect(of(['.name', '.detail'])).toEqual([...ARCHITECTURE_TEXT_ROLES.compact].sort())
  })
})
