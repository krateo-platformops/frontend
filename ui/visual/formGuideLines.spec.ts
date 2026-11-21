/**
 * A FORM'S CONNECTOR RAIL AND ITS FIELD LABELS, MEASURED (UX review round 3, items 22 and 24;
 * approved mockup https://claude.ai/artifact/2DzX7yxTtVAb72mTgs1YE7, section 3).
 *
 * The fixture (main.tsx `?fixture=form-guide-lines`) renders a schema Form and a Relations tree List:
 *   - a top-level field's rail is invisible at rest and lights while the field is focused;
 *   - a nested group draws ONE visible line, and the fields inside it draw none at rest;
 *   - a title that says something else than its key shows the key beside it (aria-hidden); a title
 *     equal to its key up to case ("Name" / name) does not repeat it;
 *   - a tree row draws no `└─` branch.
 * The widget screenshots exclude Form (its schema comes from the cluster), so without this nothing
 * in the visual suite would see any of it. Checked in the browser that draws it, light and dark.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

const TRANSPARENT = 'rgba(0, 0, 0, 0)'
const railColor = (el: Locator) => el.evaluate((node) => getComputedStyle(node).borderLeftColor)
/** The Form.Item that carries the rail for the input with this id (its class is the module's `field`). */
const fieldOf = (page: Page, id: string) => page.locator(`#${id}`).locator('xpath=ancestor::*[contains(@class, "_field_")][1]')

for (const mode of ['light', 'dark'] as const) {
  test.describe(mode, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/visual/index.html?fixture=form-guide-lines&mode=${mode}`)
      await page.locator('#name').waitFor()
    })

    test('a top-level field has no rail at rest, and lights it while focused', async ({ page }) => {
      const field = fieldOf(page, 'name')
      expect(await railColor(field)).toBe(TRANSPARENT)
      await page.locator('#name').focus()
      await expect.poll(() => railColor(field)).not.toBe(TRANSPARENT)
    })

    test('a nested group draws one line; the fields in it, and in its section, draw none at rest', async ({ page }) => {
      // A top-level object is a SECTION (global); an object inside one is a nested GROUP (global.mirror).
      // A sectioned form shows one section at a time: open "Global values" from the section nav, as a person would.
      await page.locator('[class*="_secNav_"]').getByText('Global values').click()
      const nested = page.locator('#global_mirror_host')
      await nested.waitFor()
      const group = nested.locator('xpath=ancestor::*[contains(@class, "_group_")][1]')
      await expect(group).toHaveCount(1)
      expect(await railColor(group)).not.toBe(TRANSPARENT)
      expect(await railColor(fieldOf(page, 'global_mirror_host'))).toBe(TRANSPARENT)
      expect(await railColor(fieldOf(page, 'global_imageRegistry'))).toBe(TRANSPARENT)
    })

    test('the key shows beside a title that differs, and not beside one equal up to case', async ({ page }) => {
      const keyOf = (id: string) => fieldOf(page, id).locator('label [aria-hidden="true"]')
      await expect(keyOf('imagePullSecrets')).toHaveText('imagePullSecrets')
      await expect(keyOf('imagePullSecrets')).toBeVisible()
      await expect(keyOf('name')).toHaveCount(0)
    })

    test('a Relations tree row draws no branch connector', async ({ page }) => {
      const tree = page.getByTestId('tree')
      await expect(tree.getByText('ConfigMap')).toBeVisible()
      expect(await tree.textContent()).not.toContain('└')
    })
  })
}
