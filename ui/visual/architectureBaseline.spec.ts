/**
 * ONE BASELINE, ARCS ABOVE — the architecture FlowChart's left-to-right layout in a real browser.
 *
 * builder-publish's chain (V1B): Repository → Repo → LocalResource ×10 → PullRequest, and Repository
 * → LocalResource. Under dagre the Repo sat ~32px under the other three and the skip edge curved
 * round it, crossing its edges; the cards floated in a fixed 360px box. Now the chain is one row,
 * the skip edge arcs over it, and the box is as tall as the drawing. The rules are unit-tested in
 * baselineLayout.test.ts; what only a browser can show is where G6 actually puts the cards and what
 * it actually paints for each edge.
 *
 * Two fixtures (main.tsx): `architecture`, the FlowChart widget itself, for the cards and the box;
 * `architecture-graph`, DependencyGraph with the props FlowChart gives it, which hands the page its
 * G6 graph — the edges are painted on a canvas, so the paths are read from G6 and sampled.
 */
import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { height: 900, width: 1440 } })

type Rect = { bottom: number; left: number; right: number; top: number }

/** The FlowChart box and its cards, once two reads 100ms apart agree. */
const settledCards = async (page: Page): Promise<{ box: Rect; cards: Rect[] }> => {
  await expect(page.getByRole('group')).toHaveCount(4)
  let last = ''
  await expect.poll(async () => {
    const now = await page.evaluate(() => {
      const rect = (element: Element): Rect => {
        const { bottom, left, right, top } = element.getBoundingClientRect()
        return { bottom, left, right, top }
      }
      return JSON.stringify({
        box: rect(document.querySelector('[data-testid="architecture-graph-box"]')!),
        cards: [...document.querySelectorAll('[role="group"]')].map(rect),
      })
    })
    const still = now === last
    last = now
    return still
  }, { intervals: [100], timeout: 5000 }).toBe(true)
  return JSON.parse(last) as { box: Rect; cards: Rect[] }
}

/** The arc's headroom (one level: 24px rise + 2px stroke) and the placement's margins, as the layout computes them. */
const ARC_HEADROOM = 26
const PADDING = 16

// The regular card is as tall as V1B's tallest card needs — `publish-pod-sizing-v1b-source` takes a
// second line — and at least 84px (FlowChart measures it); the compact card is always 56px.
for (const [width, density] of [[1400, 'regular'], [1179, 'regular'], [1000, 'compact']] as const) {
  test(`in a ${width}px box the four cards share one baseline, and the box is as tall as the drawing`, async ({ page }) => {
    await page.goto(`/visual/index.html?fixture=architecture&box=${width}`)
    await page.evaluate(() => document.fonts.ready)
    const { box, cards } = await settledCards(page)
    const centres = cards.map(({ bottom, top }) => (top + bottom) / 2)
    for (const centre of centres) {
      expect(Math.abs(centre - centres[0]), `centres ${JSON.stringify(centres)}`).toBeLessThanOrEqual(1)
    }
    const heights = cards.map(({ bottom, top }) => Math.round(bottom - top))
    const [card] = heights
    expect(heights).toEqual([card, card, card, card])
    if (density === 'compact') {
      expect(card).toBe(56)
    } else {
      expect(card).toBeGreaterThanOrEqual(84)
    }
    // The content is the row plus the arc's headroom; the box is that and the margins — no more.
    const content = ARC_HEADROOM + card
    expect(box.bottom - box.top).toBeLessThanOrEqual(content + 2 * PADDING)
    // …and the drawing sits in it: the cards' top is the arc's headroom under the top margin.
    expect(Math.abs(cards[0].top - box.top - (PADDING + ARC_HEADROOM))).toBeLessThanOrEqual(1)
    expect(Math.abs(box.bottom - cards[0].bottom - PADDING)).toBeLessThanOrEqual(1)
  })
}

interface Drawn {
  /** Each node's centre as G6 holds it, and its rendered box (world coordinates). */
  nodes: { id: string; x: number; y: number; min: number[]; max: number[] }[]
  /** Each edge's ends, its rendered bounds, and 200 points along the path G6 painted. */
  edges: { id: string; source: string; target: string; min: number[]; max: number[]; points: [number, number][] }[]
}

/** The graph as G6 holds and paints it. */
const drawn = (page: Page): Promise<Drawn> => page.evaluate(() => {
  type Bounds = { max: number[]; min: number[] }
  type PathShape = { getPoint: (ratio: number, inWorldSpace?: boolean) => { x: number; y: number } }
  type Graph = {
    context: { element: { getElement: (id: string) => { getShape: (key: string) => PathShape } } }
    getEdgeData: () => { id: string; source: string; target: string }[]
    getElementRenderBounds: (id: string) => Bounds
    getNodeData: () => { id: string; style: { x: number; y: number } }[]
  }
  const graph = (window as unknown as { __architectureGraph: Graph }).__architectureGraph
  return {
    edges: graph.getEdgeData().map(({ id, source, target }) => {
      const path = graph.context.element.getElement(id).getShape('key')
      const { max, min } = graph.getElementRenderBounds(id)
      const points = Array.from({ length: 201 }, (_, step) => {
        const { x, y } = path.getPoint(step / 200, true)
        return [x, y] as [number, number]
      })
      return { id, max, min, points, source, target }
    }),
    nodes: graph.getNodeData().map(({ id, style }) => {
      const { max, min } = graph.getElementRenderBounds(id)
      return { id, max, min, x: style.x, y: style.y }
    }),
  }
})

const settledGraph = async (page: Page): Promise<Drawn> => {
  await expect(page.getByRole('group')).toHaveCount(4)
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __architectureGraph?: unknown }).__architectureGraph)).toBe(true)
  let last = ''
  await expect.poll(async () => {
    const now = JSON.stringify(await drawn(page))
    const still = now === last
    last = now
    return still
  }, { intervals: [100], timeout: 5000 }).toBe(true)
  return JSON.parse(last) as Drawn
}

const within = ([x, y]: [number, number], { max, min }: { max: number[]; min: number[] }): boolean =>
  x > min[0] && x < max[0] && y > min[1] && y < max[1]

test('G6 holds every main-chain card on one y, and no painted edge passes through a card it does not connect', async ({ page }) => {
  await page.goto('/visual/index.html?fixture=architecture-graph')
  await page.evaluate(() => document.fonts.ready)
  const { edges, nodes } = await settledGraph(page)
  expect(nodes.map(({ id }) => id)).toEqual(['arch:repository', 'arch:repo', 'arch:localresources', 'arch:pullrequest'])
  for (const { y } of nodes) {
    expect(Math.abs(y - nodes[0].y)).toBeLessThanOrEqual(1)
  }
  // Each card's rendered box is the one the layout reserved: 240 wide, and as tall as the card the
  // page draws (the tallest card's height, at least 84px) — so a card's whole drawn box is what the
  // edges below are checked against.
  const drawnCard = await page.getByRole('group').first().boundingBox()
  expect(drawnCard!.height).toBeGreaterThanOrEqual(84)
  for (const { max, min } of nodes) {
    expect([Math.round(max[0] - min[0]), Math.round(max[1] - min[1])]).toEqual([240, Math.round(drawnCard!.height)])
  }
  const crossings: string[] = []
  for (const each of edges) {
    for (const node of nodes.filter(({ id }) => id !== each.source && id !== each.target)) {
      if (each.points.some((point) => within(point, node))) { crossings.push(`${each.id} through ${node.id}`) }
      // The straight edges' bounds too: the stroke's whole box clears every other card.
      if (each.min[1] > node.min[1] && each.max[1] < node.max[1]) {
        expect(each.max[0] <= node.min[0] || each.min[0] >= node.max[0], `${each.id} bounds over ${node.id}`).toBe(true)
      }
    }
  }
  expect(crossings).toEqual([])
  // The skip edge is the arc: every painted point above the row's top, rising clear of the Repo.
  const arc = edges.find(({ id }) => id === 'arch:repository→arch:localresources')!
  const [, top] = nodes[0].min
  expect(arc.points.every(([, y]) => y <= top + 1)).toBe(true)
  const repo = nodes.find(({ id }) => id === 'arch:repo')!
  const overRepo = arc.points.filter(([x]) => x >= repo.min[0] && x <= repo.max[0])
  expect(overRepo.length).toBeGreaterThan(0)
  expect(Math.max(...overRepo.map(([, y]) => y))).toBeLessThan(repo.min[1] - 16)
  // The neighbouring ranks' edges are straight: one y along their whole length.
  for (const id of ['arch:repository→arch:repo', 'arch:repo→arch:localresources', 'arch:localresources→arch:pullrequest']) {
    const { points } = edges.find((each) => each.id === id)!
    expect(Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y)), id).toBeLessThanOrEqual(0.5)
  }
})
