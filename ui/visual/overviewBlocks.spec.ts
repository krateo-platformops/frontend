/**
 * The root pages' building blocks in a real browser: a Collapse of capped groups and a facet Select
 * with counts, from their own example CRs (Collapse #0, Select #1).
 *
 * jsdom lays nothing out and runs no CSS, so the unit tests can check what the widgets render but
 * not that it fits. This checks what a reader gets: the capped footer link, the counts, the panel
 * headers driven from the keyboard, and nothing wider than a 400px phone viewport.
 */
import { expect, test, type Page } from '@playwright/test'

const PHONE = 400

/** Fails with the offenders when anything in the page reaches past the viewport's right edge. */
const expectNoHorizontalOverflow = async (page: Page) => {
  const report = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const box = element.getBoundingClientRect()
        return box.width > 0 && box.right > width + 0.5
      })
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className} → ${Math.round(element.getBoundingClientRect().right)}`)
    return { offenders, scrollWidth: document.documentElement.scrollWidth, width }
  })
  // eslint-disable-next-line no-console -- the measurement is the output when this fails
  console.log(`OVERFLOW ${JSON.stringify(report)}`)
  expect(report.scrollWidth, 'the page does not scroll sideways').toBeLessThanOrEqual(report.width)
  expect(report.offenders, 'no element reaches past the viewport').toEqual([])
}

const open = async (page: Page, example: string, doc: number) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ height: 900, width: PHONE })
  await page.goto(`/visual/index.html?example=${example}&doc=${doc}&fill`)
  await expect(page.getByTestId('case')).toBeVisible()
  await expect(page.getByTestId('missing')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  return errors
}

test.describe('Collapse — capped groups', () => {
  test('three panels; the exception groups open, each capped to 3 cards with its "See all" link', async ({ page }) => {
    const errors = await open(page, 'Collapse', 0)
    const panels = page.locator('.ant-collapse-item')
    await expect(panels).toHaveCount(3)

    const openGroup = panels.nth(0)
    await expect(openGroup.locator('.ant-collapse-header')).toHaveAttribute('aria-expanded', 'true')
    await expect(openGroup.locator('.ant-card')).toHaveCount(3)
    const seeAll = openGroup.getByRole('link', { name: 'See all 5 →' })
    await expect(seeAll).toBeVisible()
    await expect(seeAll).toHaveAttribute('href', '/incidents?status=Open&view=table')
    // the count rides in the header, tinted for the exception group only
    await expect(openGroup.locator('.ant-collapse-header .ant-tag')).toHaveText('5')
    await expect(openGroup.locator('.ant-collapse-header .ant-tag')).toHaveClass(/ant-tag-error/)

    await expect(panels.nth(1).locator('.ant-card')).toHaveCount(3)
    await expect(panels.nth(1).getByRole('link', { name: 'See all 4 →' })).toBeVisible()

    // the settled group starts folded, its badge neutral
    const resolved = panels.nth(2)
    await expect(resolved.locator('.ant-collapse-header')).toHaveAttribute('aria-expanded', 'false')
    await expect(resolved.locator('.ant-collapse-header .ant-tag')).not.toHaveClass(/ant-tag-(error|warning)/)

    await expectNoHorizontalOverflow(page)
    expect(errors).toEqual([])
  })

  test('a header is reached with Tab and toggled with Enter', async ({ page }) => {
    await open(page, 'Collapse', 0)
    const header = page.locator('.ant-collapse-item').nth(2).locator('.ant-collapse-header')
    await expect(header).toHaveAttribute('aria-expanded', 'false')

    // Tab from the top of the page until the Resolved header holds focus, as a keyboard user would.
    for (let step = 0; step < 40; step += 1) {
      // eslint-disable-next-line no-await-in-loop -- each Tab depends on where the last one landed
      await page.keyboard.press('Tab')
      // eslint-disable-next-line no-await-in-loop
      if (await header.evaluate((element) => element === document.activeElement)) { break }
    }
    await expect(header).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    const body = page.locator('.ant-collapse-item').nth(2)
    await expect(body.locator('.ant-card')).toHaveCount(3)
    await expect(body.getByRole('link', { name: 'See all 4 →' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.keyboard.press('Enter')
    await expect(header).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('Select — a facet with counts', () => {
  test('the open panel shows each count, their sum, and the facet\'s own footnote', async ({ page }) => {
    const errors = await open(page, 'Select', 1)
    // the trigger names the facet
    await expect(page.locator('.ant-select-prefix')).toHaveText('Kind')
    await expectNoHorizontalOverflow(page)

    await page.locator('.ant-select').first().click()
    const panel = page.locator('.ant-select-dropdown')
    await expect(panel).toBeVisible()

    const rows = panel.locator('.ant-select-item-option')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toHaveText('Alert47')
    await expect(rows.nth(1)).toHaveText('Prompt12')
    await expect(rows.nth(2)).toHaveText('Drift3')
    // the count is part of each option's accessible name
    await expect(page.getByRole('option', { name: 'Alert, 47' }).first()).toBeAttached()

    await expect(panel.getByRole('button', { name: /All kinds/ })).toContainText('62')
    await expect(panel).toContainText('Counts apply the other filters on the page')
    await expect(panel).not.toContainText('scope persists')

    await expectNoHorizontalOverflow(page)
    expect(errors).toEqual([])
  })
})
