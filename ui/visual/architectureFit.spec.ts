/**
 * ADAPT, NEVER CLIP — the architecture FlowChart in a real browser.
 *
 * builder-publish's chain is four ranks: 4 × 240 + 3 × 160 = 1440px at true size. The composition
 * page gives the diagram ~1179px at a 1456px window and ~1000px at 1280, so the fourth card was cut
 * on every builder-publish composition (portal#310 only added a fade). FlowChart now closes the rank
 * gaps, then takes the compact card, then scales (never under the type floor) — `architectureFit`,
 * unit-tested to the pixel in architectureFit.test.ts. What jsdom cannot show is where G6 actually
 * puts the cards, so this measures them: every card's bounding box inside the box, with no fade.
 *
 * The fixture (main.tsx `?fixture=architecture&box=…`) mounts the FlowChart widget with the V1B
 * chain in a box that wide. `graph-zoom` mounts DependencyGraph at a zoom, the path a scale takes.
 */
import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { height: 900, width: 1440 } })

type Rect = { bottom: number; left: number; right: number; top: number; width: number }
type Geometry = { box: Rect; cards: Rect[]; overflows: string | null }

/** The box (FlowChart's, or the fixture's host) and every card, as the browser lays them out now. */
const geometry = (page: Page): Promise<string> => page.evaluate(() => {
  const rect = (element: Element): Rect => {
    const { bottom, left, right, top, width } = element.getBoundingClientRect()
    return { bottom, left, right, top, width }
  }
  const box = document.querySelector('[data-testid="architecture-graph-box"]') ?? document.querySelector('[data-testid="architecture-host"]')
  return JSON.stringify({
    box: rect(box!),
    cards: [...document.querySelectorAll('[role="group"]')].map(rect),
    overflows: box!.getAttribute('data-overflows'),
  })
})

/** …once the placement has settled: two reads 100ms apart with the same geometry. */
const settled = async (page: Page): Promise<Geometry> => {
  await expect(page.getByRole('group')).toHaveCount(4)
  let last = ''
  await expect.poll(async () => {
    const now = await geometry(page)
    const still = now === last
    last = now
    return still
  }, { intervals: [100], timeout: 5000 }).toBe(true)
  return JSON.parse(last) as Geometry
}

const inside = (card: Rect, box: Rect): boolean =>
  card.left >= box.left && card.right <= box.right && card.top >= box.top && card.bottom <= box.bottom

for (const [width, card] of [[1179, 240], [1000, 180]] as const) {
  test(`builder-publish's four ranks fit a ${width}px box: every card inside it, no fade`, async ({ page }) => {
    await page.goto(`/visual/index.html?fixture=architecture&box=${width}`)
    await page.evaluate(() => document.fonts.ready)
    const { box, cards, overflows } = await settled(page)
    expect(Math.round(box.right - box.left)).toBe(width)
    for (const each of cards) {
      expect(inside(each, box), `card ${JSON.stringify(each)} in box ${JSON.stringify(box)}`).toBe(true)
    }
    // 1179: the regular card with its gaps closed; 1000: the compact card.
    expect(cards.map((each) => Math.round(each.width))).toEqual([card, card, card, card])
    expect(overflows).toBeNull()
  })
}

test('CONTROL: an explicit regular density keeps its card at 1000px, and the fourth card runs past the box', async ({ page }) => {
  // The author's floor: gaps closed to 56px (960 + 168 = 1128px), no compact, and no scale — its
  // smallest text is already at the 12px floor. This is what the box would show without the compact step — and what the check
  // above would fail on.
  await page.goto('/visual/index.html?fixture=architecture&box=1000&density=regular')
  await page.evaluate(() => document.fonts.ready)
  const { box, cards, overflows } = await settled(page)
  expect(inside(cards[0], box)).toBe(true)
  expect(inside(cards[3], box)).toBe(false)
  expect(overflows).toBe('true')
})

test('a zoom under 1 is G6\'s camera: the cards are drawn at that size, inside the box', async ({ page }) => {
  await page.goto('/visual/index.html?fixture=graph-zoom&zoom=0.8')
  await page.evaluate(() => document.fonts.ready)
  const { box, cards } = await settled(page)
  for (const each of cards) {
    // 0.8 × the 240px card.
    expect(Math.round(each.width)).toBe(192)
    expect(inside(each, box)).toBe(true)
  }
})
