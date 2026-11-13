/**
 * frontend#701: after an "Ask Agentiko →" click the rail could no longer be resized. The rail is
 * the clip for its own content while it animates open, and the composer takes focus as it opens.
 * A box with `overflow: hidden` is still a scroll container, so focusing the composer while the
 * rail was a few pixels wide scrolled the rail sideways; once open, a header wider than the rail
 * (the minimum width while a turn streams) kept that offset. The drag handle at the rail's left
 * edge scrolled out with the content, and the rail showed its contents cut on the left and an
 * empty strip on the right.
 *
 * The scroll happens while the rail opens, whatever the open rail's header does afterwards, so
 * every frame of the opening is sampled, not only the settled rail.
 *
 * Measured in a real browser, because the defect is layout and scrolling, which jsdom does not do.
 */
import { expect, test, type Page } from '@playwright/test'

/** The narrowest rail (railWidth.ts RAIL_MIN_WIDTH). */
const RAIL_WIDTH = 320

const serveAgent = async (page: Page) => {
  // The reachability probe answers, so the rail is live; a turn is accepted and never finishes,
  // as a long investigation on a live install does not finish while anyone is looking.
  await page.route('**/agentiko-a2a/**', (route) => (route.request().method() === 'GET' ? route.fulfill({ body: '{}', status: 200 }) : undefined))
}

/** Wait until the rail has finished animating open: the same width over consecutive frames. */
const settledRail = async (page: Page) => {
  const rail = page.locator('aside')
  await expect.poll(() => rail.evaluate((element) => element.getBoundingClientRect().width)).toBe(RAIL_WIDTH)
  await page.evaluate(() => new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)) }))
  return rail
}

test('an Ask Agentiko click opens the narrow rail unscrolled, with its resize handle under the pointer', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1512 })
  await page.addInitScript((width) => { localStorage.setItem('krateo.agentiko.rail-width', String(width)) }, RAIL_WIDTH)
  await serveAgent(page)
  await page.goto('/visual/index.html?fixture=agentiko-rail&mode=dark')
  await page.evaluate(() => document.fonts.ready)

  // Sample every frame from the click until the rail has settled: how far the rail is scrolled
  // sideways, and whether its header is wider than the rail (the overflow a scroll needs).
  await page.evaluate(() => {
    const record = { headerOverflowed: false, maxScrollLeft: 0, stop: false }
    Object.assign(window, { railFrames: record })
    const sample = () => {
      const rail = document.querySelector('aside')
      const collapse = rail?.querySelector<HTMLElement>('button[aria-label="Collapse rail"]')
      const head = collapse?.offsetParent as HTMLElement | null | undefined
      if (rail && collapse && head) {
        record.maxScrollLeft = Math.max(record.maxScrollLeft, rail.scrollLeft)
        record.headerOverflowed ||= collapse.offsetLeft + collapse.offsetWidth + parseFloat(getComputedStyle(head).paddingRight) > head.clientWidth
      }
      if (!record.stop) { requestAnimationFrame(sample) }
    }
    requestAnimationFrame(sample)
  })
  await page.getByRole('link', { name: 'Ask Agentiko →' }).click()
  await expect(page.getByText('streaming', { exact: true })).toBeVisible()
  const rail = await settledRail(page)
  const frames = await page.evaluate(() => {
    const record = (window as unknown as { railFrames: { headerOverflowed: boolean; maxScrollLeft: number; stop: boolean } }).railFrames
    record.stop = true
    return record
  })

  // The precondition the defect needs, so this test cannot pass by nothing ever overflowing: while
  // the rail opened, its header was wider than the rail.
  expect(frames.headerOverflowed, 'the header overflowed the rail while it opened').toBe(true)
  expect(frames.maxScrollLeft, 'the rail never scrolled sideways while it opened').toBe(0)

  // Nothing on the page is scrolled sideways: not the rail, and not an ancestor in its place.
  const scrolled = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((element) => element.scrollLeft !== 0).map((element) => element.tagName))
  expect(scrolled, 'no element is scrolled sideways').toEqual([])

  // What the report saw: the handle that resizes the rail is at its left edge, under the pointer.
  const box = await rail.boundingBox()
  if (!box) { throw new Error('rail not rendered') }
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-testid') ?? null, [box.x + 3, box.y + box.height / 2])
  expect(hit, 'the resize handle is under the rail’s left edge').toBe('agentiko-resize-handle')

  // And it resizes: the rail's right edge stays put and its left edge follows the pointer.
  const right = box.x + box.width
  await page.mouse.move(box.x + 3, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 77, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => rail.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(Math.round(right - (box.x - 77)))
})
