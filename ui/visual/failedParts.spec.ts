/**
 * A PART SNOWPLOW REPORTED AS FAILED, SHOWN IN ITS SLOT (approved mockup
 * https://claude.ai/artifact/1yZY3r6QkbzfD78XjdyhTq), in the browser that draws it, light and dark:
 *   transient  snowplow's message and a Try again that re-reads the parent
 *   permanent  snowplow's message and who can fix it, and no retry
 * The fixture (main.tsx `?fixture=failed-parts`) renders a Flex whose child is reported failed.
 */
import { expect, test } from '@playwright/test'

for (const mode of ['light', 'dark'] as const) {
  test.describe(mode, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/visual/index.html?fixture=failed-parts&mode=${mode}`)
      await page.getByTestId('permanent').locator('[data-failed-part]').waitFor()
    })

    test('a transient failure shows the message and a working Try again', async ({ page }) => {
      const part = page.getByTestId('transient').locator('[data-failed-part="transient"]')
      await expect(part).toContainText('could not be looked up')
      const retried = page.evaluate(() => new Promise<string>((resolve) => {
        window.addEventListener('fixture-retry', (event) => { resolve((event as CustomEvent<string>).detail) }, { once: true })
      }))
      await part.getByRole('button', { name: /try again/i }).click()
      expect(await retried).toBe('transient')
    })

    test('a permanent failure shows the message and who can fix it, with no retry', async ({ page }) => {
      const part = page.getByTestId('permanent').locator('[data-failed-part="permanent"]')
      await expect(part).toContainText('is not installed on this cluster')
      await expect(part).toContainText('ask a platform admin to install it')
      await expect(part.getByRole('button')).toHaveCount(0)
    })

    test('the failed part keeps a visible slot: framed, never collapsed to nothing', async ({ page }) => {
      const ids = ['transient', 'permanent']
      const boxes = await Promise.all(ids.map((id) => page.getByTestId(id).locator('[data-failed-part]').boundingBox()))
      boxes.forEach((box, index) => {
        expect(box?.height ?? 0, `${ids[index]} slot height`).toBeGreaterThan(40)
        expect(box?.width ?? 0, `${ids[index]} slot width`).toBeGreaterThan(200)
      })
    })
  })
}
