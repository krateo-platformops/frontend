/**
 * THE PRIMARY BUTTON'S SOLID FILL, measured in a real browser (WCAG 1.4.3, 1.4.11).
 *
 * The primary is antd's own solid in both modes: no stylesheet repaints it (ui/index.css used to,
 * with a 14% wash that stood 1.21:1 / 1.29:1 off the panel). tokens.contrast.test.ts pins the token
 * pairs; this reads what Chromium actually paints, so a rule that repaints the button again, or a
 * nested theme that changes its label, is caught where the user would see it.
 *
 * The fixture (main.tsx `?fixture=primary-button`) puts a primary Button, a disabled one and a
 * primary inside an agent surface's nested theme (AgentikoBrandScope) on the page ground and on a
 * panel. Each enabled one must carry its label at >= 4.5:1 and stand >= 3:1 off the surface, at
 * rest, on hover and pressed; the disabled one must not wear the enabled fill.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

type Paint = { background: string; color: string }

const paintOf = (locator: Locator): Promise<Paint> => locator.evaluate((element) => {
  const style = getComputedStyle(element)
  return { background: style.backgroundColor, color: style.color }
})

/**
 * A computed colour as 0-255 channels and alpha. Chromium reports `rgb()` / `rgba()` for plain
 * colours and `color(srgb r g b / a)`, channels 0-1, for a `color-mix()` result.
 */
const channels = (value: string): { alpha: number; rgb: number[] } => {
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(value)
  if (srgb) { return { alpha: srgb[4] === undefined ? 1 : Number(srgb[4]), rgb: srgb.slice(1, 4).map((channel) => Number(channel) * 255) } }
  const rgb = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(value)
  if (rgb) { return { alpha: rgb[4] === undefined ? 1 : Number(rgb[4]), rgb: rgb.slice(1, 4).map(Number) } }
  throw new Error(`unparseable colour ${value}`)
}
const luminance = (value: string): number => {
  const [red, green, blue] = channels(value).rgb.map((channel) => {
    const unit = channel / 255
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}
const contrast = (one: string, other: string): number => {
  const [light, dark] = [luminance(one), luminance(other)].sort((first, second) => second - first)
  return (light + 0.05) / (dark + 0.05)
}

/** antd animates colour changes; the measurement is of the state, not of the way into it. */
const open = async (page: Page, mode: string) => {
  await page.goto(`/visual/index.html?fixture=primary-button&mode=${mode}`)
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' })
  await page.evaluate(() => document.fonts.ready)
}

const SURFACES = [['ground', 'case'], ['panel', 'panel-surface']] as const
const BUTTONS = ['Primary', 'Agent primary']

for (const mode of ['light', 'dark'] as const) {
  for (const [where, surface] of SURFACES) {
    for (const name of BUTTONS) {
      test(`${name} is a solid fill that carries its label, at rest, hovered and pressed · ${where} · ${mode}`, async ({ page }) => {
        await open(page, mode)
        const ground = await page.getByTestId(surface).evaluate((element) => getComputedStyle(element).backgroundColor)
        const button = page.getByTestId(where).getByRole('button', { exact: true, name })
        const box = await button.boundingBox()
        if (!box) { throw new Error(`${name} has no box`) }

        const measure = async (state: string) => {
          const paint = await paintOf(button)
          expect(channels(paint.background).alpha, `${state}: the fill ${paint.background} is opaque, not a wash`).toBe(1)
          expect(contrast(paint.color, paint.background), `${state}: label ${paint.color} on ${paint.background}`).toBeGreaterThanOrEqual(4.5)
          expect(contrast(paint.background, ground), `${state}: fill ${paint.background} on the ${where} ${ground}`).toBeGreaterThanOrEqual(3)
          return paint
        }

        await page.mouse.move(0, 0)
        const rest = await measure('rest')
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        const hover = await measure('hover')
        await page.mouse.down()
        const pressed = await measure('pressed')
        await page.mouse.up()
        expect(hover.background, 'hover changes the fill').not.toBe(rest.background)
        expect(pressed.background, 'pressing changes the fill').not.toBe(hover.background)
      })
    }

    test(`a disabled primary does not wear the enabled fill · ${where} · ${mode}`, async ({ page }) => {
      await open(page, mode)
      const row = page.getByTestId(where)
      const enabled = await paintOf(row.getByRole('button', { exact: true, name: 'Primary' }))
      const disabled = await paintOf(row.getByRole('button', { exact: true, name: 'Disabled' }))
      expect(disabled.background).not.toBe(enabled.background)
      expect(disabled.color).not.toBe(enabled.color)
    })
  }
}
