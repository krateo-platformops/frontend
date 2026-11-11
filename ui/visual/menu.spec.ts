/**
 * SIDEBAR LABELS RENDER EXACTLY AS THEIR PAGES DECLARE THEM.
 *
 * A nav label is the page's own name, so the sidebar shows it as written: "Raise a ticket", not
 * "Raise A Ticket". Menu.module.css used to set `text-transform: capitalize` on every item, which
 * title-cased each word. A transform is a computed style, inherited from any ancestor, and jsdom
 * computes no cascade, so this runs in Chromium, where `innerText` is the text as drawn.
 *
 * The fixture (main.tsx `?fixture=nav-menu`) renders the Menu widget with sentence-case labels and
 * one that starts lower-case.
 */
import { expect, test } from '@playwright/test'

const LABELS = ['Raise a ticket', 'Platform review', 'kubectl access']

for (const mode of ['light', 'dark'] as const) {
  test(`every sidebar label renders as declared · ${mode}`, async ({ page }) => {
    await page.goto(`/visual/index.html?fixture=nav-menu&mode=${mode}`)
    await page.evaluate(() => document.fonts.ready)

    const rows = page.locator('[data-krateo-nav-item]')
    // Waits for the nav to render, and fails here rather than below if it rendered no rows.
    await expect(rows).toHaveCount(LABELS.length)

    // Every row at once, in order: its declared label (our own attribute, navAnchor.ts), the text
    // Chromium draws, and the transform that decides it.
    const drawn = await rows.evaluateAll((elements) => elements.map((element) => {
      const title = element.querySelector<HTMLElement>('.ant-menu-title-content')
      return { label: element.getAttribute('data-krateo-nav-item'), text: title?.innerText, transform: title && getComputedStyle(title).textTransform }
    }))
    expect(drawn).toEqual(LABELS.map((label) => ({ label, text: label, transform: 'none' })))
  })
}
