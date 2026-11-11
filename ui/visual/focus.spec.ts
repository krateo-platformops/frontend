/**
 * THE FOCUS RING ON EVERY antd BUTTON, measured in a real browser (WCAG 2.4.7, 1.4.11).
 *
 * The portal's ring is defined once, in ui/index.css: 2px solid `--primary-color`, 2px offset, on
 * `:focus-visible`. antd draws its own outline on a Button with a more specific selector, in its
 * pale `colorPrimaryBorder` (2.57:1 on the light panel, 1.72:1 on the dark one), so index.css names
 * the Button too. Specificity and source order decide which ring is drawn, and jsdom implements
 * neither, so this runs in Chromium.
 *
 * The fixture (main.tsx `?fixture=focus-ring`) puts a plain <button>, which only the universal rule
 * styles, before one Button of every type, on the page ground and on a panel. Each Button must wear
 * exactly the reference's ring when Tab reaches it, at >= 3:1 on the surface around it, and none
 * after a mouse click.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

const BUTTONS = ['Primary', 'Default', 'Dashed', 'Text', 'Link', 'Delete', 'Remove', 'Refresh']

type Ring = { color: string; offset: string; style: string; width: string }

const ringOf = (locator: Locator): Promise<Ring> => locator.evaluate((element) => {
  const style = getComputedStyle(element)
  return { color: style.outlineColor, offset: style.outlineOffset, style: style.outlineStyle, width: style.outlineWidth }
})

/** `--primary-color` as the browser resolves it, in the rgb() form computed styles use. */
const primary = (page: Page): Promise<string> => page.evaluate(() => {
  const probe = document.createElement('span')
  probe.style.color = 'var(--primary-color)'
  document.body.append(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved
})

const luminance = (rgb: string): number => {
  const [red, green, blue] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((channel) => {
    const unit = channel / 255
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}
const contrast = (one: string, other: string): number => {
  const [light, dark] = [luminance(one), luminance(other)].sort((first, second) => second - first)
  return (light + 0.05) / (dark + 0.05)
}

/** The ground under each row: the case's page ground, and the panel the second row sits on. */
const SURFACES = [['ground', 'case'], ['panel', 'panel-surface']] as const

for (const mode of ['light', 'dark'] as const) {
  for (const [where, surface] of SURFACES) {
    test(`every antd Button type wears the portal's focus ring on Tab · ${where} · ${mode}`, async ({ page }) => {
      await page.goto(`/visual/index.html?fixture=focus-ring&mode=${mode}`)
      await page.evaluate(() => document.fonts.ready)
      const ring = await primary(page)
      const ground = await page.getByTestId(surface).evaluate((element) => getComputedStyle(element).backgroundColor)

      const reference = page.getByTestId(`reference-${where}`)
      await reference.focus()
      // focus() from script is not keyboard modality; a key press after it is.
      await page.keyboard.press('Shift')
      const expected = await ringOf(reference)
      expect(expected, 'the reference wears the global ring: 2px solid --primary-color, 2px offset').toEqual({ color: ring, offset: '2px', style: 'solid', width: '2px' })
      expect(contrast(ring, ground), `the ring on the ${where} ${ground}`).toBeGreaterThanOrEqual(3)

      // One Tab per Button, in order: each step needs the focus the one before it left.
      await BUTTONS.reduce(async (previous, name) => {
        await previous
        await page.keyboard.press('Tab')
        const button = page.getByTestId(where).getByRole('button', { exact: true, name })
        await expect(button, `Tab reaches ${name} on the ${where}`).toBeFocused()
        expect(await ringOf(button), `${name} on the ${where} (${mode})`).toEqual(expected)
      }, Promise.resolve())
    })
  }

  for (const name of ['Primary', 'Default', 'Delete', 'Refresh']) {
    test(`a mouse click paints no ring on ${name} · ${mode}`, async ({ page }) => {
      await page.goto(`/visual/index.html?fixture=focus-ring&mode=${mode}`)
      const button = page.getByTestId('panel').getByRole('button', { exact: true, name })
      await button.click()
      await expect(button).toBeFocused()
      expect(await button.evaluate((element) => element.matches(':focus-visible')), 'a click is not keyboard focus').toBe(false)
      expect((await ringOf(button)).style, 'no outline after a click').toBe('none')
    })
  }
}
