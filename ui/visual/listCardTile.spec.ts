/**
 * A CARD'S ICON TILE AGAINST ITS TITLE LINES, MEASURED (portal review: the centred 32px tile met
 * neither the name nor the tags; it started below one and ended above the other).
 *
 * The fixture (main.tsx `?fixture=list-card-tiles`) renders card-variant List rows with an icon tile:
 *   two-lines   a name and a tag line: the tile's top is the name's top, its bottom the tags' bottom;
 *   tags-wrap   a narrow card whose tag line wraps: the tile stays level with the name, and the
 *               block grows under it (checked to really wrap, or the case proves nothing);
 *   one-line    a name alone: the 32px tile stays centred on it, as before.
 * ListView.cardTile.test.tsx decides WHICH cards get the layout; this checks where the edges land,
 * in the browser that draws them, so a stylesheet that re-centres the tile fails here.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

type Box = { bottom: number; height: number; top: number }

const box = async (locator: Locator): Promise<Box> => {
  const rect = await locator.boundingBox()
  if (!rect) { throw new Error('not rendered') }
  return { bottom: rect.y + rect.height, height: rect.height, top: rect.y }
}

/** The card's top row: the tile, then the title block (the name, then the tag line when there is one). */
const parts = (page: Page, testId: string) => {
  const top = page.getByTestId(testId).locator('.ant-card-body > div').first()
  const titles = top.locator(':scope > div').first()
  return {
    meta: titles.locator(':scope > div').first(),
    name: titles.locator(':scope > span').first(),
    tile: top.locator(':scope > span').first(),
  }
}

const EDGE = 0.5

test.beforeEach(async ({ page }) => {
  await page.goto('/visual/index.html?fixture=list-card-tiles&mode=light')
  await page.getByTestId('one-line').locator('.ant-card').waitFor()
})

test('beside a name and a tag line, the tile spans both lines', async ({ page }) => {
  const { meta, name, tile } = parts(page, 'two-lines')
  const [tileBox, nameBox, metaBox] = [await box(tile), await box(name), await box(meta)]
  expect(Math.abs(tileBox.top - nameBox.top), 'tile top vs name top').toBeLessThanOrEqual(EDGE)
  expect(Math.abs(tileBox.bottom - metaBox.bottom), 'tile bottom vs tag line bottom').toBeLessThanOrEqual(EDGE)
  expect(tileBox.height).toBeGreaterThan(32)
})

test('when the tag line wraps, the tile stays level with the name', async ({ page }) => {
  const { meta, name, tile } = parts(page, 'tags-wrap')
  const { meta: oneRowMeta } = parts(page, 'two-lines')
  const [tileBox, nameBox, metaBox] = [await box(tile), await box(name), await box(meta)]
  expect(metaBox.height, 'the tag line really wraps').toBeGreaterThan((await box(oneRowMeta)).height + 8)
  expect(Math.abs(tileBox.top - nameBox.top), 'tile top vs name top').toBeLessThanOrEqual(EDGE)
  expect(metaBox.bottom).toBeGreaterThan(tileBox.bottom)
})

test('beside a name alone, the 32px tile stays centred on it', async ({ page }) => {
  const { name, tile } = parts(page, 'one-line')
  const [tileBox, nameBox] = [await box(tile), await box(name)]
  expect(tileBox.height).toBe(32)
  expect(Math.abs((tileBox.top + tileBox.bottom) / 2 - (nameBox.top + nameBox.bottom) / 2)).toBeLessThanOrEqual(EDGE)
})
