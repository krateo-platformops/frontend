/**
 * P26, MEASURED: a screen's status and actions sit on its title's row, on the trailing edge.
 *
 * src/test/screenHeaders.test.ts holds the structure (no hand-built header with actions — use
 * ScreenHeader). This holds the geometry the structure is for, in a real browser, at the widths the
 * console is used at. A stylesheet change that pushes the actions under the title, or to the left,
 * fails here even if every screenshot baseline is regenerated to match it.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

const box = async (locator: Locator) => {
  const rect = await locator.boundingBox()
  if (!rect) { throw new Error('not rendered') }
  return { bottom: rect.y + rect.height, left: rect.x, right: rect.x + rect.width, top: rect.y }
}

const open = async (page: Page, width: number) => {
  await page.setViewportSize({ height: 600, width })
  await page.goto('/visual/index.html?fixture=screen-header&mode=light')
  await page.evaluate(() => document.fonts.ready)
}

for (const width of [1440, 1024]) {
  test(`ScreenHeader at ${width}px: status and actions on the title's row, trailing edge`, async ({ page }) => {
    await open(page, width)
    const header = await box(page.locator('header'))
    const title = await box(page.locator('header h1'))
    const trailing = await box(page.locator('[data-screen-header="trailing"]'))
    const status = await box(page.getByTestId('status'))
    const firstAction = await box(page.getByRole('button', { name: 'Preview' }))
    const primary = await box(page.getByRole('button', { name: 'Publish' }))

    expect(Math.abs(trailing.right - header.right), 'the trailing group ends at the header’s right edge').toBeLessThanOrEqual(1)
    expect(trailing.top < title.bottom && trailing.bottom > title.top, 'the trailing group shares the title’s row').toBe(true)
    expect(status.right, 'the status comes before the actions').toBeLessThanOrEqual(firstAction.left)
    expect(primary.left, 'actions read left to right, primary after Preview').toBeGreaterThan(firstAction.left)
  })
}

test('ScreenHeader at 600px: when the row wraps, the trailing group still keeps to the right edge', async ({ page }) => {
  await open(page, 600)
  const header = await box(page.locator('header'))
  const trailing = await box(page.locator('[data-screen-header="trailing"]'))
  expect(Math.abs(trailing.right - header.right)).toBeLessThanOrEqual(1)
})
