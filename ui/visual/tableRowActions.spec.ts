/**
 * A Table's `rowActions` column (#700), measured in a real browser in the portal's own theme.
 *
 * The unit tests prove what a control fires and that the row never does; jsdom has no layout, so
 * whether the column is wide enough is answered here. Under `fitContent` or virtualization the
 * table's layout is fixed and the column's width is an ESTIMATE (rowActionsColumnWidth, from antd's
 * Button and Space tokens) — this is what checks it against the controls the theme actually draws,
 * bold labels and icons included.
 *
 * For each display (kebab menu, buttons) × layout (max-content, fitContent, virtual) × width
 * (1280px desktop, 390px phone): every control lies inside its cell, no two overlap, no label is
 * cut inside its button, the column is in view (it is pinned to the trailing edge: the first run of
 * this spec found a phone-width virtual table drawing its buttons past its edge), and the header is
 * named for assistive tech but takes no space on screen. Where the table is wider than its box the
 * pinned cell lies over the columns scrolling beneath it, so there it must be opaque; where it is
 * not, it must not overlap the cell before it.
 *
 * The measurements are written out (one `ROWACTIONS {json}` line per case) so a change to the
 * estimate can be read against what the browser drew.
 */
import { expect, test } from '@playwright/test'

const WIDTHS = [{ height: 900, name: 'desktop', width: 1280 }, { height: 844, name: 'phone', width: 390 }] as const

type Box = { bottom: number; left: number; right: number; top: number }

for (const display of ['menu', 'buttons'] as const) {
  for (const layout of ['normal', 'fit', 'virtual'] as const) {
    for (const viewport of WIDTHS) {
      test(`rowActions ${display} · ${layout} · ${viewport.name}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ height: viewport.height, width: viewport.width })
        // The same table without rowActions: the row height and opening scroll the column must keep.
        await page.goto(`/visual/index.html?fixture=table-row-actions&display=none&layout=${layout}`)
        await page.evaluate(() => document.fonts.ready)
        await expect(page.locator('.ant-table-row').first()).toBeVisible()
        await page.waitForTimeout(300)
        const baseline = await page.evaluate(() => ({
          holderScrollTop: (document.querySelector('.ant-table-tbody-virtual-holder'))?.scrollTop ?? 0,
          rowHeight: (document.querySelector('.ant-table-row') as HTMLElement).getBoundingClientRect().height,
        }))

        await page.goto(`/visual/index.html?fixture=table-row-actions&display=${display}&layout=${layout}`)
        await page.evaluate(() => document.fonts.ready)
        await expect(page.locator('.ant-table-row').first()).toBeVisible()
        // The table measures its container once mounted (useMeasuredWidth); let that settle.
        await page.waitForTimeout(300)

        const got = await page.evaluate(() => {
          const rect = (element: Element): Box => {
            const { bottom, left, right, top } = element.getBoundingClientRect()
            return { bottom, left, right, top }
          }
          const row = document.querySelector('.ant-table-row') as HTMLElement
          const cells = [...row.children].filter((child) => child.classList.contains('ant-table-cell'))
          const cell = cells.at(-1) as HTMLElement
          const before = cells.at(-2) as HTMLElement
          const style = getComputedStyle(cell)
          const contentLeft = rect(cell).left + parseFloat(style.paddingLeft)
          const contentRight = rect(cell).right - parseFloat(style.paddingRight)
          const buttons = [...cell.querySelectorAll('button')].map((button) => {
            const label = [...button.children].find((child) => !child.classList.contains('ant-btn-icon')) as HTMLElement | undefined
            return {
              box: rect(button),
              clientWidth: button.clientWidth,
              label: button.textContent ?? '',
              labelClipped: label ? label.scrollWidth > label.clientWidth + 0.5 : false,
              scrollWidth: button.scrollWidth,
            }
          })
          const header = [...document.querySelectorAll('.ant-table-thead th')].at(-1) as HTMLElement
          const headerLabel = header.querySelector('span') as HTMLElement
          const container = (document.querySelector('.ant-table-body, .ant-table-content, .ant-table-tbody-virtual-holder') ?? document.querySelector('.ant-table')) as HTMLElement
          const control = (cell.querySelector('.ant-space') ?? cell.querySelector('button')) as HTMLElement
          return {
            background: style.backgroundColor,
            before: rect(before),
            buttons,
            cell: rect(cell),
            cellWidth: cell.getBoundingClientRect().width,
            container: rect(container),
            contentLeft,
            contentRight,
            controlNeeds: control.getBoundingClientRect().width,
            controlScrollWidth: control.scrollWidth,
            firstRowTop: row.getBoundingClientRect().top,
            header: { box: rect(headerLabel), clipPath: getComputedStyle(headerLabel).clipPath, position: getComputedStyle(headerLabel).position, text: header.textContent },
            headerBottom: (document.querySelector('.ant-table-thead') as HTMLElement).getBoundingClientRect().bottom,
            holderScrollTop: (document.querySelector('.ant-table-tbody-virtual-holder'))?.scrollTop ?? 0,
            padding: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
            position: style.position,
            rowHeight: row.getBoundingClientRect().height,
            tableLayout: getComputedStyle(document.querySelector('.ant-table table, .ant-table-container table') ?? document.body).tableLayout,
          }
        })

        // eslint-disable-next-line no-console -- the measurements are the output (see the header)
        console.log(`ROWACTIONS ${JSON.stringify({
          buttons: got.buttons.map((button) => ({ label: button.label || '(kebab)', width: Math.round((button.box.right - button.box.left) * 10) / 10 })),
          case: `${display}/${layout}/${viewport.name}`,
          cellWidth: Math.round(got.cellWidth * 10) / 10,
          controlNeeds: Math.round(got.controlNeeds * 10) / 10,
          firstRowUnderHeader: Math.round((got.headerBottom - got.firstRowTop) * 10) / 10,
          inView: got.cell.right <= got.container.right + 0.5 && got.cell.left >= got.container.left - 0.5,
          neededWithPadding: Math.round((got.controlNeeds + got.padding) * 10) / 10,
          overScrolledColumns: got.before.right > got.cell.left + 0.5,
          pinned: got.position === 'sticky',
          rowHeight: Math.round(got.rowHeight * 10) / 10,
          rowHeightWithout: Math.round(baseline.rowHeight * 10) / 10,
          scrollTopWithout: baseline.holderScrollTop,
          tableLayout: got.tableLayout,
        })}`)
        await page.screenshot({ fullPage: true, path: testInfo.outputPath(`rowactions-${display}-${layout}-${viewport.name}.png`) })

        expect(got.buttons.length, 'one control per action, or the one kebab').toBe(display === 'buttons' ? 2 : 1)
        for (const button of got.buttons) {
          expect(button.box.left, `${button.label || 'kebab'} starts inside its cell`).toBeGreaterThanOrEqual(got.contentLeft - 0.5)
          expect(button.box.right, `${button.label || 'kebab'} ends inside its cell`).toBeLessThanOrEqual(got.contentRight + 0.5)
          expect(button.labelClipped, `${button.label} is not cut inside its button`).toBe(false)
          expect(button.scrollWidth, `${button.label || 'kebab'} does not overflow itself`).toBeLessThanOrEqual(button.clientWidth)
        }
        const sorted = [...got.buttons].sort((left, right) => left.box.left - right.box.left)
        sorted.slice(1).forEach((button, index) => {
          expect(button.box.left, `${button.label} does not overlap ${sorted[index].label}`).toBeGreaterThanOrEqual(sorted[index].box.right)
        })
        // The header: named "Actions" for assistive tech, invisible and taking no space on screen.
        expect(got.header.text).toBe('Actions')
        await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCount(1)
        expect(got.header.position).toBe('absolute')
        expect(got.header.clipPath).toContain('inset(50%)')
        expect(got.header.box.right - got.header.box.left).toBeLessThanOrEqual(1)
        // The controls must not make a row taller than the same table's rows without them. In a
        // virtual table a taller row is also past antd's row estimate, and its scroll-jump
        // correction opens the table scrolled, the first row partly under the header.
        expect(got.rowHeight, 'the controls do not make the row taller').toBeLessThanOrEqual(baseline.rowHeight + 0.5)
        expect(got.holderScrollTop, 'the table opens where it would without rowActions').toBeLessThanOrEqual(baseline.holderScrollTop)
        // Pinned, so in view at every width, whatever the table's own width.
        expect(got.position, 'the actions column is pinned').toBe('sticky')
        expect(got.cell.right, 'the actions column ends in view').toBeLessThanOrEqual(got.container.right + 0.5)
        expect(got.cell.left, 'the actions column starts in view').toBeGreaterThanOrEqual(got.container.left - 0.5)
        if (got.before.right > got.cell.left + 0.5) {
          // Over the columns scrolling beneath it: they must not show through.
          expect(got.background, 'the pinned cell is opaque').not.toMatch(/transparent|rgba\([^)]*,\s*0\)/)
        }
      })
    }
  }
}
