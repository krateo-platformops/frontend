/**
 * The rail header when the rail is narrow. While a turn streamed, the title, the STREAMING pill and
 * the five icon controls were wider than the rail: at the narrowest 320 px rail the last control
 * (Collapse) was cut off at the rail's edge, and even at the default 384 px the flex row squeezed
 * every control below its 26 px. When the header would overflow, the pill now gives up its word and
 * keeps its dot: the word stays in the pill's accessible name and its title, and every control stays
 * whole and at full size. At rest ("live") the default rail keeps the word, and with room for it
 * so does a streaming one. An install's AGENTIKO_RAIL_BADGE replaces the pill; a long badge
 * ellipsises and carries its full text in its title.
 *
 * Measured in a real browser, because the defect is layout, which jsdom does not do.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

/** The narrowest rail (railWidth.ts RAIL_MIN_WIDTH), the default one, and one with room. */
const NARROWEST = 320
const DEFAULT = 384
const ROOMY = 420
const LONG_BADGE = 'Scripted demo for the Northwind evaluation'

type Box = { bottom: number; left: number; right: number; top: number }

const rect = async (locator: Locator): Promise<Box> => {
  const box = await locator.boundingBox()
  if (!box) { throw new Error('not rendered') }
  return { bottom: box.y + box.height, left: box.x, right: box.x + box.width, top: box.y }
}

/**
 * Open the rail at `width`: with a turn streaming, as an "Ask Agentiko →" click does, or at rest,
 * from the header toggle.
 */
const openRail = async (page: Page, width: number, { badge, streaming }: { badge?: string; streaming: boolean }) => {
  await page.setViewportSize({ height: 900, width: 1512 })
  await page.addInitScript((value) => { localStorage.setItem('krateo.agentiko.rail-width', String(value)) }, width)
  // The probe answers, so the rail is live; a turn is accepted and never finishes.
  await page.route('**/agentiko-a2a/**', (route) => (route.request().method() === 'GET' ? route.fulfill({ body: '{}', status: 200 }) : undefined))
  await page.goto(`/visual/index.html?fixture=agentiko-rail&mode=dark${badge ? `&badge=${encodeURIComponent(badge)}` : ''}`)
  await page.evaluate(() => document.fonts.ready)
  if (streaming) {
    await page.getByRole('link', { name: 'Ask Agentiko →' }).click()
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  } else {
    await page.getByRole('button', { name: /^Agentiko/ }).first().click()
  }
  const rail = page.locator('aside')
  await expect.poll(() => rail.evaluate((element) => element.getBoundingClientRect().width)).toBe(width)
  await page.evaluate(() => new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)) }))
  const header = rail.getByRole('button', { name: 'Collapse rail' }).locator('xpath=..')
  return { header, rail }
}

/** Every header control lies inside the rail at its full 26 px, and is the element under its own centre. */
const expectControlsWhole = async (rail: Locator, header: Locator) => {
  const railBox = await rect(rail)
  const controls = await header.getByRole('button').all()
  // History, new thread, full width and collapse; speak-back too where the browser can speak.
  expect(controls.length).toBeGreaterThanOrEqual(4)
  const measured = await Promise.all(controls.map(async (control) => {
    const box = await rect(control)
    const onTop = await control.evaluate((element, [x, y]) => element.contains(document.elementFromPoint(x, y)), [(box.left + box.right) / 2, (box.top + box.bottom) / 2])
    return { box, name: await control.getAttribute('aria-label'), onTop }
  }))
  for (const { box, name, onTop } of measured) {
    expect(box.left, `${name} starts inside the rail`).toBeGreaterThanOrEqual(railBox.left)
    expect(box.right, `${name} ends inside the rail`).toBeLessThanOrEqual(railBox.right)
    expect(box.right - box.left, `${name} keeps its full 26 px`).toBeGreaterThanOrEqual(26)
    expect(onTop, `${name} is not covered or clipped`).toBe(true)
  }
}

/** The pill, found by the title that names it, and whether its word is on screen inside it. */
const pillWord = async (header: Locator, word: string) => {
  const pill = header.getByTitle(word, { exact: true })
  await expect(pill, 'the pill is named by its word').toHaveAccessibleName(word)
  const [pillBox, wordBox] = [await rect(pill), await rect(pill.getByText(word, { exact: true }))]
  const shown = wordBox.right - wordBox.left > 1 && wordBox.left >= pillBox.left && wordBox.right <= pillBox.right && wordBox.top >= pillBox.top && wordBox.bottom <= pillBox.bottom
  return { pillBox, shown }
}

test('narrowest rail, streaming: every header control is whole and inside the rail; the pill keeps its dot', async ({ page }) => {
  const { header, rail } = await openRail(page, NARROWEST, { streaming: true })
  await expectControlsWhole(rail, header)
  expect((await pillWord(header, 'streaming')).shown, 'the word is visually hidden').toBe(false)
})

test('default rail, streaming: every header control is whole and at full size', async ({ page }) => {
  const { header, rail } = await openRail(page, DEFAULT, { streaming: true })
  await expectControlsWhole(rail, header)
})

test('with room for it, a streaming pill shows its word', async ({ page }) => {
  const { header, rail } = await openRail(page, ROOMY, { streaming: true })
  await expectControlsWhole(rail, header)
  expect((await pillWord(header, 'streaming')).shown, 'the word is on screen, inside the pill').toBe(true)
})

test('default rail at rest: the pill still says "live", every control whole', async ({ page }) => {
  const { header, rail } = await openRail(page, DEFAULT, { streaming: false })
  await expectControlsWhole(rail, header)
  expect((await pillWord(header, 'live')).shown, 'the word is on screen, inside the pill').toBe(true)
})

test('narrowest rail at rest: every header control is whole and inside the rail', async ({ page }) => {
  const { header, rail } = await openRail(page, NARROWEST, { streaming: false })
  await expectControlsWhole(rail, header)
})

test('a long rail badge ellipsises at the narrowest width, with its full text in its title', async ({ page }) => {
  const { header, rail } = await openRail(page, NARROWEST, { badge: LONG_BADGE, streaming: true })
  await expectControlsWhole(rail, header)
  const badge = header.getByTitle(LONG_BADGE)
  await expect(badge).toHaveText(LONG_BADGE)
  const { clientWidth, scrollWidth, textOverflow } = await badge.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, textOverflow: getComputedStyle(element).textOverflow }))
  expect(scrollWidth, 'the badge text is longer than the badge').toBeGreaterThan(clientWidth)
  expect(textOverflow, 'and it ends in an ellipsis').toBe('ellipsis')
})
