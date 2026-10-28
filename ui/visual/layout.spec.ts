/**
 * P26, MEASURED: a header is two columns — the text block (the title, the subtitle under it) and
 * the status and actions on the trailing edge, on ONE row, never stacked, centred vertically on the
 * whole text block: between the title and the subtitle when there is one, level with the title when
 * there is not. When the row is too narrow the actions drop under the text block, still one row,
 * still on the right edge.
 *
 * src/test/screenHeaders.test.ts holds the structure (no hand-built header with actions — use
 * ScreenHeader). This holds the geometry the structure is for, in a real browser, at the widths the
 * console is used at, for both headers: ScreenHeader (screens the app builds) and the PageHeader
 * widget (pages authored as CRs). A stylesheet change that pins the buttons to the title's line or
 * the subtitle's, pushes them left, or stacks them fails here even if every screenshot baseline is
 * regenerated to match.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

type Box = { bottom: number; left: number; right: number; top: number }

const box = async (locator: Locator): Promise<Box> => {
  const rect = await locator.boundingBox()
  if (!rect) { throw new Error('not rendered') }
  return { bottom: rect.y + rect.height, left: rect.x, right: rect.x + rect.width, top: rect.y }
}
const overlapsVertically = (one: Box, other: Box) => one.top < other.bottom && one.bottom > other.top

const middle = (box: Box) => (box.top + box.bottom) / 2

/**
 * The rule itself, for any header: `buttons` in reading order, `text` the title (and subtitle) it
 * sits beside. `beside: false` is the narrow case, where the row has moved under the text.
 */
const expectP26 = (header: Box, text: Box[], buttons: Box[], beside = true) => {
  const block = { bottom: Math.max(...text.map((box) => box.bottom)), left: text[0].left, right: Math.max(...text.map((box) => box.right)), top: text[0].top }
  const last = buttons[buttons.length - 1]
  for (const button of buttons) {
    expect(overlapsVertically(button, buttons[0]), 'one row: no button above or below another').toBe(true)
  }
  buttons.slice(1).forEach((button, index) => expect(button.left, 'left to right, in reading order').toBeGreaterThan(buttons[index].left))
  expect(Math.abs(last.right - header.right), 'the row ends at the header’s right edge').toBeLessThanOrEqual(1)
  if (beside) {
    expect(Math.abs(middle(buttons[0]) - middle(block)), 'the row is centred on the whole text block').toBeLessThanOrEqual(2)
    expect(buttons[0].left, 'beside the text, not over it').toBeGreaterThanOrEqual(block.right)
  } else {
    expect(buttons[0].top, 'when it cannot sit beside the text, the row goes under it').toBeGreaterThanOrEqual(block.bottom - 1)
  }
}

const openScreenHeader = async (page: Page, fixture: string, width: number) => {
  await page.setViewportSize({ height: 600, width })
  await page.goto(`/visual/index.html?fixture=${fixture}&mode=light`)
  await page.evaluate(() => document.fonts.ready)
}

const screenButtons = (page: Page) => Promise.all(['Preview', 'Undo', 'Publish', 'Close draft'].map((name) => box(page.getByRole('button', { name }))))

for (const width of [1440, 1024]) {
  test(`ScreenHeader at ${width}px: status and actions on the trailing edge, one row, centred on title + subtitle`, async ({ page }) => {
    await openScreenHeader(page, 'screen-header', width)
    const status = await box(page.getByTestId('status'))
    const buttons = await screenButtons(page)

    expectP26(await box(page.locator('header')), [await box(page.locator('header h1')), await box(page.locator('header p'))], buttons)
    expect(overlapsVertically(status, buttons[0]), 'the status is on the actions’ row').toBe(true)
    expect(status.right, 'the status comes before the actions').toBeLessThanOrEqual(buttons[0].left)
  })
}

test('ScreenHeader at 600px: the actions drop under the text, one row, right edge', async ({ page }) => {
  await openScreenHeader(page, 'screen-header', 600)
  expectP26(await box(page.locator('header')), [await box(page.locator('header h1')), await box(page.locator('header p'))], await screenButtons(page), false)
})

test('ScreenHeader without a subtitle: status and actions level with the title, right edge', async ({ page }) => {
  await openScreenHeader(page, 'screen-header-no-subtitle', 1440)
  const status = await box(page.getByTestId('status'))
  const buttons = await screenButtons(page)
  expectP26(await box(page.locator('header')), [await box(page.locator('header h1'))], buttons)
  expect(overlapsVertically(status, buttons[0])).toBe(true)
})

/** The PageHeader fixtures fetch their two Buttons like any widget; serve them from the chart's shape. */
const BUTTONS: Record<string, object> = {
  'ask-autopilot': { actions: { navigate: [{ id: 'ask', path: '/x?ask=help', type: 'navigate' }] }, clickActionId: 'ask', icon: 'fa-wand-magic-sparkles', label: 'Ask Autopilot →', size: 'middle', type: 'primary' },
  'page-action': { actions: { navigate: [{ id: 'go', path: '/x', type: 'navigate' }] }, clickActionId: 'go', label: 'Build a controller', size: 'middle', type: 'primary' },
}

const openPageHeader = async (page: Page, fixture: string, width: number) => {
  await page.setViewportSize({ height: 600, width })
  await page.addInitScript(() => localStorage.setItem('K_user', JSON.stringify({ accessToken: 'fixture' })))
  await page.route('http://127.0.0.1:9/**', async (route) => {
    const name = new URL(route.request().url()).searchParams.get('name') ?? ''
    const widgetData = BUTTONS[name]
    await route.fulfill({ json: { apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Button', metadata: { name, namespace: 'krateo-system', uid: name }, spec: { widgetData }, status: { resourcesRefs: { items: [] }, widgetData } } })
  })
  await page.goto(`/visual/index.html?fixture=${fixture}&mode=light`)
  await page.getByRole('button', { name: 'Build a controller' }).waitFor()
  await page.getByRole('button', { name: 'Ask Autopilot' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
}

const pageButtons = (page: Page) => Promise.all([box(page.getByRole('button', { name: 'Ask Autopilot' })), box(page.getByRole('button', { name: 'Build a controller' }))])
const pageHeaderBox = (page: Page) => box(page.getByTestId('case').locator('> div').first())

test('PageHeader at 1440px: Ask Autopilot and the page action on the trailing edge, one row, centred on title + subtitle', async ({ page }) => {
  await openPageHeader(page, 'page-header', 1440)
  const subtitle = await box(page.locator('.ant-typography').filter({ hasText: 'OpenAPI' }))
  expectP26(await pageHeaderBox(page), [await box(page.locator('h1')), subtitle], await pageButtons(page))
})

test('PageHeader at 420px: the actions drop under the text, one row, right edge', async ({ page }) => {
  await openPageHeader(page, 'page-header', 420)
  const subtitle = await box(page.locator('.ant-typography').filter({ hasText: 'OpenAPI' }))
  expectP26(await pageHeaderBox(page), [await box(page.locator('h1')), subtitle], await pageButtons(page), false)
})

test('PageHeader without a subtitle: the actions level with the title, right edge', async ({ page }) => {
  await openPageHeader(page, 'page-header-no-subtitle', 1440)
  expectP26(await pageHeaderBox(page), [await box(page.locator('h1'))], await pageButtons(page))
})
