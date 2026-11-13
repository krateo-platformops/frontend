/**
 * EVERY RESOURCE, COMPLETELY — the composition Topology's full names, in a real browser.
 *
 * portal#427 sends one node per resource with its full name (`publish-bp-v2-20261002-1-source`,
 * `…-000` to `…-007`), never a group. The regular card set its name on one line and cut it with an
 * ellipsis, so the end of the name — the part that tells the resources apart — was not on screen;
 * the full value was only in the native `title` and the accessible name. Now the name wraps, at a
 * hyphen where it can and anywhere as the last resort, and the card is as tall as the longest name
 * needs: FlowChart measures it and reserves that height for every card, so a taller card never runs
 * into the one under it.
 *
 * The fixture (main.tsx `?fixture=architecture-names&box=1179`) mounts the FlowChart widget with the
 * eleven nodes in the box the composition page gives the diagram at a 1456px window.
 */
import { expect, test, type Page } from '@playwright/test'

// Tall enough for the whole drawing: G6's cards and canvas are not painted past the viewport, so a
// screenshot of the eight stacked rows at 900px lost the last one.
test.use({ viewport: { height: 1200, width: 1440 } })

const PREFIX = 'publish-bp-v2-20261002-1'
const NAMES = [`${PREFIX}-repo`, `${PREFIX}-source`, ...Array.from({ length: 8 }, (_, index) => `${PREFIX}-${String(index).padStart(3, '0')}`), `${PREFIX}-pr`]

type Rect = { bottom: number; left: number; right: number; top: number }
type Name = {
  /** The text the name line holds. */
  text: string
  /** Wider or taller than its box: part of it is not drawn. */
  clipped: boolean
  scroll: [number, number]
  client: [number, number]
  /** A rule that ends the visible text in an ellipsis applies: `text-overflow` or a line clamp. */
  ellipsis: boolean
  /** The name line lies inside the card's border. */
  inside: boolean
  /** Distinct line boxes the text is set on. */
  lines: number
}
type Card = { card: Rect; name: Name; overflows: boolean }
type Drawing = { box: Rect; cards: Card[] }

const draw = (): string => {
  const rect = (element: Element): Rect => {
    const { bottom, left, right, top } = element.getBoundingClientRect()
    return { bottom, left, right, top }
  }
  const cards = [...document.querySelectorAll<HTMLElement>('[role="group"]')].map((card): Card => {
    // The name line is the second line of the regular card (kind, name, detail).
    const name = card.children[1] as HTMLElement
    const style = getComputedStyle(name)
    const outer = card.getBoundingClientRect()
    const border = Number.parseFloat(getComputedStyle(card).borderTopWidth)
    const box = name.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(name)
    const lines = new Set([...range.getClientRects()].filter((each) => each.width > 0).map((each) => Math.round((each.top + each.bottom) / 2))).size
    return {
      card: rect(card),
      name: {
        client: [name.clientWidth, name.clientHeight],
        clipped: name.scrollWidth > name.clientWidth || name.scrollHeight > name.clientHeight,
        ellipsis: style.textOverflow === 'ellipsis' || (style.webkitLineClamp !== 'none' && style.webkitLineClamp !== ''),
        inside: box.left >= outer.left + border - 0.5 && box.right <= outer.right - border + 0.5
          && box.top >= outer.top + border - 0.5 && box.bottom <= outer.bottom - border + 0.5,
        lines,
        scroll: [name.scrollWidth, name.scrollHeight],
        text: name.textContent ?? '',
      },
      overflows: card.scrollHeight > card.clientHeight || card.scrollWidth > card.clientWidth,
    }
  })
  return JSON.stringify({ box: rect(document.querySelector('[data-testid="architecture-graph-box"]')!), cards })
}

const outside = ({ bottom, left, right, top }: Rect, box: Rect): boolean =>
  left < box.left || right > box.right || top < box.top || bottom > box.bottom

/**
 * The drawing once the placement has settled: unchanged for half a second (three reads 250ms apart
 * agree). Half a second, not 100ms, so a placement that holds a wrong position for a while is read
 * as what it is: when FlowChart created the graph before the fonts were in, the graph was laid out
 * again at the taller card and, for about a second, every card sat 35px low with the last row past
 * the box's edge (useArchitectureCardHeight).
 */
const settled = async (page: Page): Promise<Drawing> => {
  await expect(page.getByRole('group')).toHaveCount(NAMES.length)
  let last = ''
  let same = 0
  await expect.poll(async () => {
    const now = await page.evaluate(draw)
    same = now === last ? same + 1 : 0
    last = now
    return same
  }, { intervals: [250], timeout: 10000 }).toBeGreaterThanOrEqual(2)
  return JSON.parse(last) as Drawing
}

const overlap = (one: Rect, other: Rect): boolean =>
  Math.min(one.right, other.right) - Math.max(one.left, other.left) > 0.5 && Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top) > 0.5

test('the Topology shows every one of its eleven names in full, and no two cards overlap', async ({ page }, testInfo) => {
  await page.goto('/visual/index.html?fixture=architecture-names&box=1179')
  await page.evaluate(() => document.fonts.ready)
  const { box, cards } = await settled(page)
  await page.getByTestId('architecture-host').screenshot({ path: testInfo.outputPath('architecture-names.png') })

  // One card per resource, each with its own full name.
  expect(cards.map(({ name }) => name.text).sort()).toEqual([...NAMES].sort())

  // The whole of every name is drawn: nothing past its box, and no rule that would end it in an
  // ellipsis. Listed, so a failure names every card it fails on.
  const detail = JSON.stringify(cards.map(({ name }) => name))
  expect(cards.filter(({ name }) => name.clipped).map(({ name }) => name.text), `cut: ${detail}`).toEqual([])
  expect(cards.filter(({ name }) => name.ellipsis).map(({ name }) => name.text), `ellipsis rule: ${detail}`).toEqual([])

  for (const { card, name, overflows } of cards) {
    const at = `${name.text}: ${JSON.stringify({ card, name, overflows })}`
    // The name line is inside the card's border.
    expect(name.inside, at).toBe(true)
    // …and nothing else on the card spills out of it either.
    expect(overflows, at).toBe(false)
    // …and the card is inside the diagram's box: the box is as tall as the drawing of taller cards.
    expect(outside(card, box), `${at} in ${JSON.stringify(box)}`).toBe(false)
  }

  // At least one name needs more than one line (else the case proves nothing about wrapping), and
  // every card is as tall as the tallest one needs: the box the layout reserves for each.
  expect(Math.max(...cards.map(({ name }) => name.lines))).toBeGreaterThan(1)
  const heights = new Set(cards.map(({ card }) => Math.round(card.bottom - card.top)))
  expect([...heights], 'every card the same height').toHaveLength(1)

  // No two cards overlap.
  for (const [index, one] of cards.entries()) {
    for (const other of cards.slice(index + 1)) {
      expect(overlap(one.card, other.card), `${one.name.text} ${JSON.stringify(one.card)} and ${other.name.text} ${JSON.stringify(other.card)}`).toBe(false)
    }
  }
})
