/**
 * THE SIGN-IN PAGE, photographed: the form-first card (2026-11 redesign) in both themes, on a
 * desktop-width viewport and at 400px, and its inline error state.
 *
 * The fixture (main.tsx `?fixture=login`) is the real Login page under a config that sets
 * `login.installationName` and `login.requestAccountUrl`. authn is mocked here: /strategies offers a
 * password form and one OIDC provider, and the sign-in call refuses the credentials the way authn
 * does (403, cause InvalidCredentials).
 *
 * Beyond the pictures, it checks in a real layout what the old split screen got wrong on a phone:
 * the logo and the installation name are drawn, inside the viewport, at 400px.
 */
import { expect, test, type Page } from '@playwright/test'

const STRATEGIES = [
  { kind: 'basic', path: '/basic/login' },
  {
    extensions: { authCodeURL: 'https://idp.example.com/auth?client_id=krateo&state=x', redirectURL: 'https://portal.example.com/auth' },
    graphics: { displayName: 'Continue with Keycloak', icon: 'key' },
    kind: 'oidc',
    name: 'keycloak',
    path: '/oidc/login',
  },
]

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

const open = async (page: Page, mode: 'dark' | 'light') => {
  await page.route('**/strategies', (route) => route.fulfill({ body: JSON.stringify(STRATEGIES), contentType: 'application/json' }))
  await page.route('**/basic/login', (route) => route.fulfill({
    body: JSON.stringify({ code: 403, details: { causes: [{ message: 'invalid credentials', reason: 'InvalidCredentials' }] }, kind: 'Status' }),
    contentType: 'application/json',
    status: 403,
  }))
  await page.goto(`/visual/index.html?fixture=login&mode=${mode}`)
  await expect(page.getByRole('button', { exact: true, name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Keycloak' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

for (const mode of ['light', 'dark'] as const) {
  test(`the sign-in page · desktop · ${mode}`, async ({ page }) => {
    await open(page, mode)
    // The cursor starts in Username (#652), so the picture shows that field focused.
    await expect(page.getByLabel('Username')).toBeFocused()
    await expect(page).toHaveScreenshot(`Login-desktop-${mode}.png`)
  })

  test(`the sign-in page · 400px · ${mode}`, async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 400 })
    await open(page, mode)

    // On a phone the brand and the installation stay: inside the viewport, not display:none.
    const logo = await page.getByRole('img', { name: 'Krateo | PlatformOps' }).boundingBox()
    const installation = await page.getByText('krateo-057', { exact: true }).boundingBox()
    expect(logo, 'the logo is drawn at 400px').not.toBeNull()
    expect(installation, 'the installation name is drawn at 400px').not.toBeNull()
    for (const box of [logo!, installation!]) {
      expect(box.width).toBeGreaterThan(0)
      expect(box.x + box.width).toBeLessThanOrEqual(400)
    }

    await expect(page).toHaveScreenshot(`Login-400-${mode}.png`)
  })

  test(`a refused password is explained above the button, and only the password is cleared · ${mode}`, async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 400 })
    await open(page, mode)
    await page.getByLabel('Username').fill('jdoe')
    await page.getByLabel('Password').fill('not-the-password')
    await page.getByRole('button', { exact: true, name: 'Sign in' }).click()

    await expect(page.getByRole('alert')).toContainText('Wrong username or password.')
    await expect(page.getByLabel('Username')).toHaveValue('jdoe')
    await expect(page.getByLabel('Password')).toHaveValue('')
    await expect(page.getByLabel('Password')).toBeFocused()

    // authn's cause is small and quiet, but still text: AA on the Alert as it is painted.
    const [ink, ground] = await page.getByRole('alert').evaluate((alert) => [
      getComputedStyle(alert.querySelector('code')!).color,
      getComputedStyle(alert).backgroundColor,
    ])
    expect(contrast(ink, ground), `reason code ${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5)

    await expect(page).toHaveScreenshot(`Login-error-400-${mode}.png`)
  })
}
