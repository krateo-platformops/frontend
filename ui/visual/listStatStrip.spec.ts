/**
 * A STATS STRIP'S NUMBERS ON ONE LINE, MEASURED (portal review, Dashboard: a tile title that wrapped
 * to two lines pushed its number down, so reading across the numbers went up and down).
 *
 * The fixture (main.tsx `?fixture=list-stat-strip`) renders the dashboard's five tiles at a width
 * where one row holds them all and at one where the strip reflows to two rows. In every row of
 * tiles, the numbers start on one line and so do the captions. Each case first checks that a title
 * in that row really wraps, or the case proves nothing. The strip's gap between rows of tiles
 * survives.
 */
import { expect, test, type Page } from '@playwright/test'

type Tile = { caption: number; liBottom: number; liTop: number; title: number; value: number }

const EDGE = 0.5

const tilesOf = (page: Page, testId: string): Promise<Tile[]> => page.getByTestId(testId).evaluate((host) =>
  [...host.querySelectorAll('.ant-list-item')].map((item) => {
    const top = (selector: string) => item.querySelector(selector)!.getBoundingClientRect()
    const li = item.getBoundingClientRect()
    return { caption: top('.ant-typography').top, liBottom: li.bottom, liTop: li.top, title: top('.ant-statistic-title').height, value: top('.ant-statistic-content').top }
  }))

const rowsOf = (tiles: Tile[]): Tile[][] => {
  const rows = new Map<number, Tile[]>()
  for (const tile of tiles) { rows.set(Math.round(tile.liTop), [...(rows.get(Math.round(tile.liTop)) ?? []), tile]) }
  return [...rows.values()]
}

test.beforeEach(async ({ page }) => {
  await page.goto('/visual/index.html?fixture=list-stat-strip&mode=light')
  await page.getByTestId('reflowed').locator('.ant-statistic')
    .first()
    .waitFor()
})

for (const [testId, rowCount] of [['one-row', 1], ['reflowed', 2]] as const) {
  test(`${testId}: in each row of tiles the numbers, and the captions, start on one line`, async ({ page }) => {
    const rows = rowsOf(await tilesOf(page, testId))
    expect(rows, 'rows of tiles').toHaveLength(rowCount)
    const wrapping = rows.filter((row) => Math.max(...row.map((tile) => tile.title)) > Math.min(...row.map((tile) => tile.title)) + 4)
    expect(wrapping.length, 'a row where one title wraps and another does not').toBeGreaterThan(0)
    for (const row of rows) {
      const values = row.map((tile) => tile.value)
      const captions = row.map((tile) => tile.caption)
      expect(Math.max(...values) - Math.min(...values), 'numbers in one row').toBeLessThanOrEqual(EDGE)
      expect(Math.max(...captions) - Math.min(...captions), 'captions in one row').toBeLessThanOrEqual(EDGE)
    }
    if (rows.length === 2) { expect(rows[1][0].liTop - rows[0][0].liBottom, 'gap between rows of tiles').toBeGreaterThanOrEqual(16 - EDGE) }
  })
}
