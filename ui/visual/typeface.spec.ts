/**
 * THE TWO TEXT FACES, as the browser resolves them: Syne for page titles (the display role), Inter
 * for body text, labels, inputs, tables, buttons and the menu.
 *
 * A stat value is data, so it is Inter too: in Syne the figures read "42" as "4²".
 *
 * A face is decided in several places — the antd theme's fontFamily, the CSS variables, a module
 * rule on a title — and antd draws a Typography.Title in the body face unless a rule says
 * otherwise, so this reads the computed font-family of each kind of text in a real page. It also
 * asks the document whether that face is LOADED at the weight in use, so a family that is named but
 * never downloaded does not pass for drawn.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * The first family of the element's computed stack, and whether a face of that family is LOADED at
 * the element's weight. Not `document.fonts.check()`: it answers true when no FontFace of the
 * family exists at all (nothing to wait for), so a family that is named but never shipped passed.
 */
const faceOf = (locator: Locator): Promise<{ family: string; loaded: boolean }> => locator.evaluate((element) => {
  const style = getComputedStyle(element)
  const family = style.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '')
  const loaded = [...document.fonts].some((face) => face.family.replace(/^["']|["']$/g, '') === family && face.weight === style.fontWeight && face.status === 'loaded')
  return { family, loaded }
})

const open = async (page: Page, query: string) => {
  await page.goto(`/visual/index.html?${query}&mode=light`)
  await page.evaluate(() => document.fonts.ready)
}

const expectFace = async (locator: Locator, family: 'Inter' | 'Syne', what: string) => {
  await expect(locator, what).toBeVisible()
  expect(await faceOf(locator), what).toEqual({ family, loaded: true })
}

test('a PageHeader title is Syne; its subtitle is Inter', async ({ page }) => {
  await open(page, 'fixture=page-header')
  await expectFace(page.locator('h1'), 'Syne', 'the page title')
  await expectFace(page.locator('.ant-typography').filter({ hasText: 'OpenAPI' }), 'Inter', 'the subtitle')
})

test('a ScreenHeader title is Syne; its subtitle and buttons are Inter', async ({ page }) => {
  await open(page, 'fixture=screen-header')
  await expectFace(page.locator('header h1'), 'Syne', 'the builder title')
  await expectFace(page.locator('header p'), 'Inter', 'the subtitle')
  await expectFace(page.getByRole('button', { name: 'Preview' }), 'Inter', 'a default button label')
  await expectFace(page.getByRole('button', { name: 'Publish' }), 'Inter', 'the primary button label')
})

test('a menu label is Inter', async ({ page }) => {
  await open(page, 'fixture=nav-menu')
  await expectFace(page.locator('[data-krateo-nav-item]').first(), 'Inter', 'a sidebar label')
})

test('a table cell is Inter', async ({ page }) => {
  await open(page, 'fixture=table-cell-tooltip')
  await expectFace(page.getByRole('cell', { name: 'snowplow /call' }), 'Inter', 'a table cell')
})

test('an input and its value are Inter', async ({ page }) => {
  await open(page, 'example=Input&doc=0')
  await expectFace(page.locator('input').first(), 'Inter', 'an input')
})

test('a stat value is Inter', async ({ page }) => {
  await open(page, 'example=Statistic&doc=0')
  await expectFace(page.locator('.ant-statistic-content-value'), 'Inter', 'a stat value')
})
