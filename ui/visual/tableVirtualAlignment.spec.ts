/**
 * A VIRTUAL Table's body cells line up with their headers, measured in a real browser.
 *
 * antd draws a virtual table as two pieces: the header is its own fixed-layout <table>, and the body
 * is a virtual list of rows whose cells are positioned from the column widths. Nothing lines one up
 * with the other except the widths Table hands antd, so if the two read different widths the body
 * drifts under the header. Seen on /reviews (116 open proposals, 1209px): the header's columns were
 * squeezed to fit the container while the body's kept each column's `minWidth`, so from the second
 * column on every cell started further right than its header — 568px against 534px, 748 against 693.
 *
 * jsdom lays nothing out, so the unit tests can only check the widths Table passes; this checks what
 * the browser draws. For every column, the header th's left edge and the first body row's cell left
 * edge agree (±1px): at load, after a column is narrowed, and after one is widened past the box.
 *
 * The measurements are written out (one `ALIGNMENT {json}` line per case) so a drift can be read
 * column by column.
 */
import { expect, test, type Page } from '@playwright/test'

const BOX = 1209

type Lefts = { cells: number[]; headers: number[]; tableClass: string; titles: string[] }

const measure = (page: Page): Promise<Lefts> => page.evaluate(() => {
  const root = document.querySelector('[data-testid="alignment-box"]') as HTMLElement
  const origin = root.getBoundingClientRect().left
  const ths = [...root.querySelectorAll<HTMLElement>('.ant-table-thead th[data-column-key]')]
  const row = root.querySelector('.ant-table-tbody-virtual .ant-table-row') as HTMLElement
  const cells = [...row.children].filter((child) => child.classList.contains('ant-table-cell')) as HTMLElement[]
  return {
    cells: cells.map((cell) => Math.round((cell.getBoundingClientRect().left - origin) * 10) / 10),
    headers: ths.map((th) => Math.round((th.getBoundingClientRect().left - origin) * 10) / 10),
    tableClass: (root.querySelector('.ant-table') as HTMLElement).className,
    titles: ths.map((th) => th.textContent ?? ''),
  }
})

const expectAligned = (got: Lefts, label: string) => {
  // eslint-disable-next-line no-console -- the measurements are the output (see the header)
  console.log(`ALIGNMENT ${JSON.stringify({ case: label, cells: got.cells, headers: got.headers })}`)
  expect(got.tableClass, 'the table under test is virtual').toContain('ant-table-virtual')
  expect(got.headers, 'one header per column').toHaveLength(9)
  expect(got.cells, 'one body cell per header').toHaveLength(got.headers.length)
  got.headers.forEach((left, index) => {
    expect(Math.abs(got.cells[index] - left), `${label}: column ${index} (${got.titles[index]}) starts where its header does`).toBeLessThanOrEqual(1)
  })
}

/** Drags column `index`'s resize handle `dx` px sideways, as a reader would. */
const dragHandle = async (page: Page, index: number, dx: number) => {
  const handle = page.locator('.ant-table-thead th[data-column-key]').nth(index).locator('[role="separator"]')
  const box = await handle.boundingBox()
  if (!box) { throw new Error(`no resize handle on column ${index}`) }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y, { steps: 4 })
  await page.mouse.move(x + dx, y, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

test.describe('virtual Table — body cells under their headers', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ height: 900, width: BOX + 80 })
  })

  test('at load, in a box narrower than the columns ask for', async ({ page }) => {
    await page.goto(`/visual/index.html?fixture=table-virtual-alignment&box=${BOX}&rows=116`)
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('.ant-table-row').first()).toBeVisible()
    // The table measures its container once mounted (useMeasuredWidth); let that settle.
    await page.waitForTimeout(300)

    expectAligned(await measure(page), 'load')
  })

  test('after a column is narrowed, and after one is widened past the box', async ({ page }) => {
    await page.goto(`/visual/index.html?fixture=table-virtual-alignment&box=${BOX}&rows=116&uid=fixture-virtual-alignment-resize`)
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('.ant-table-row').first()).toBeVisible()
    await page.waitForTimeout(300)
    const before = await measure(page)

    await dragHandle(page, 0, -60)
    const narrowed = await measure(page)
    expect(narrowed.headers[1], 'the drag moved the second column').toBeLessThan(before.headers[1] - 30)
    expectAligned(narrowed, 'narrowed')

    await dragHandle(page, 1, 400)
    const widened = await measure(page)
    expect(widened.headers[2], 'the drag moved the third column').toBeGreaterThan(narrowed.headers[2] + 300)
    expectAligned(widened, 'widened')
  })
})
