/**
 * A Table cell's explicit `tooltip`, reached by keyboard, in a real browser (WCAG 2.1.1, 2.4.7).
 *
 * The unit tests (Table.cellTooltip.test.tsx) prove the tooltip opens on focus and carries the
 * text; jsdom implements neither `:focus-visible` nor CSS, so whether Tab reaches the cell, whether
 * it wears the portal's ring, and what the open tooltip looks like over the table are checked here.
 *
 * The fixture (main.tsx `?fixture=table-cell-tooltip`) is the trace page's spans table: the red
 * "500 · error" tag carries the span's OTel StatusMessage; the green "200 · ok" tag carries none.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

const STATUS_MESSAGE = 'dial tcp 10.40.4.184:8081: i/o timeout'

/** Press Tab until `target` has focus, at most `remaining` times. Each step needs the one before. */
const tabUntilFocused = async (page: Page, target: Locator, remaining: number): Promise<void> => {
  if (remaining === 0 || await target.evaluate((element) => element === document.activeElement)) { return }
  await page.keyboard.press('Tab')
  await tabUntilFocused(page, target, remaining - 1)
}

for (const mode of ['light', 'dark'] as const) {
  test(`a status tag with a tooltip opens it on Tab, ringed · ${mode}`, async ({ page }) => {
    await page.goto(`/visual/index.html?fixture=table-cell-tooltip&mode=${mode}`)
    await page.evaluate(() => document.fonts.ready)

    const errorTag = page.locator('.ant-tag', { hasText: '500 · error' })
    const wrapper = errorTag.locator('xpath=..')
    await expect(wrapper).toHaveAttribute('tabindex', '0')
    // The tag without a tooltip is not wrapped: its parent is the cell, as before the field existed.
    await expect(page.locator('.ant-tag', { hasText: '200 · ok' }).locator('xpath=..')).toHaveJSProperty('tagName', 'TD')

    // Real Tab presses, so the focus is keyboard modality. The sortable headers come first; the
    // loop is bounded so a cell Tab never reaches fails here rather than hanging.
    await tabUntilFocused(page, wrapper, 10)
    await expect(wrapper, 'Tab reaches the status tag').toBeFocused()

    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toHaveText(STATUS_MESSAGE)
    await expect(tooltip).toBeVisible()
    await expect(wrapper).toHaveAttribute('aria-describedby', (await tooltip.getAttribute('id')) ?? '')
    // One tooltip: the tag's own full-text title is dropped when the cell carries an explicit one.
    expect(await errorTag.getAttribute('title')).toBeNull()

    const ring = await wrapper.evaluate((element) => {
      const style = getComputedStyle(element)
      return { offset: style.outlineOffset, style: style.outlineStyle, width: style.outlineWidth }
    })
    expect(ring, 'the portal focus ring: 2px solid, 2px offset').toEqual({ offset: '2px', style: 'solid', width: '2px' })

    const table = await page.locator('.ant-table').boundingBox()
    const tip = await tooltip.boundingBox()
    if (!table || !tip) { throw new Error('the table or the tooltip has no box') }
    const top = Math.max(0, Math.min(table.y, tip.y) - 8)
    const bottom = Math.max(table.y + table.height, tip.y + tip.height) + 8
    await expect(page).toHaveScreenshot(`TableCellTooltip-focused-${mode}.png`, {
      clip: { height: bottom - top, width: 900, x: 0, y: top },
    })
  })
}
