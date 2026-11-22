/**
 * THE WELCOME BLOCK'S MARGINS, MEASURED (UX review round 3: "the boxes' margins aren't uniform; at
 * the top they overlap the header's line"). The fixture (main.tsx `?fixture=welcome-cards`) renders
 * portal's list.onboarding-empty as it ships, at the review's 4-across width, and asserts it is even:
 *   - the space above the cards (header line to card top) equals the space below them;
 *   - the outer side margins equal each other, and every card fills its grid column.
 * On main (before borderedGrid) it measured 0px above vs 9px below, and every card 32px short of its
 * column (antd's bordered-list item padding inside a grid column).
 */
import { expect, test } from '@playwright/test'

const EDGE = 1

test('the Welcome cards sit evenly inside the bordered block', async ({ page }) => {
  // antd picks the grid's column count from the WINDOW width: the review's capture is 4 across (lg).
  await page.setViewportSize({ height: 900, width: 1500 })
  await page.goto('/visual/index.html?fixture=welcome-cards&mode=dark')
  const list = page.getByTestId('welcome').locator('.ant-list').first()
  await list.locator('.ant-card').first().waitFor()
  const geo = await list.evaluate((root) => {
    const rect = (el: Element | null) => {
      const box = el!.getBoundingClientRect()
      return { b: box.bottom, l: box.left, r: box.right, t: box.top, w: box.width }
    }
    return {
      box: rect(root),
      cards: [...root.querySelectorAll('.ant-card')].map((el) => rect(el)),
      cols: [...root.querySelectorAll('.ant-col')].map((el) => rect(el)),
      header: rect(root.querySelector('.ant-list-header')),
    }
  })
  const top = Math.min(...geo.cards.map((card) => card.t)) - geo.header.b
  const bottom = geo.box.b - Math.max(...geo.cards.map((card) => card.b))
  const left = Math.min(...geo.cards.map((card) => card.l)) - geo.box.l
  const right = geo.box.r - Math.max(...geo.cards.map((card) => card.r))
  const gutter = 16
  const shortfall = geo.cards.map((card, index) => Math.round(geo.cols[index].w - gutter - card.w))
  expect.soft(geo.cards.length, 'four cards').toBe(4)
  expect.soft(new Set(geo.cards.map((card) => Math.round(card.t))).size, 'one row of four, as captured').toBe(1)
  expect.soft(Math.abs(top - bottom), `space above the cards (${top}) vs below (${bottom})`).toBeLessThanOrEqual(EDGE)
  expect.soft(top, 'the cards clear the header line').toBeGreaterThan(8)
  expect.soft(Math.abs(left - right), `left margin (${left}) vs right (${right})`).toBeLessThanOrEqual(EDGE)
  expect.soft(shortfall, 'each card fills its grid column (less the gutter)').toEqual(shortfall.map(() => 0))
})
