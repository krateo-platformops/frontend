/**
 * THE SIDEBAR'S GEOMETRY, MEASURED: the approved redesign's rail, in a real browser.
 *
 * - The brand sits in the Layout's `sider.header` slot, a band exactly as tall as the top bar, so
 *   its hairline is level with the top bar's bottom line.
 * - ONE LEFT EDGE, x = 24 from the rail's edge: the logo, every group heading's text and every
 *   item's icon start there.
 * - 16px between the band and the first nav entry; rows 36px tall; 16px between groups.
 * - The selected row is a 16% tint with a 3px accent bar at its leading edge, not a solid block.
 * - Below `lg` the rail collapses to antd's 80px: the compact glyph (`sider.collapsedHeader`)
 *   centred in the same 64px band, each icon centred, and every group after the first opens with a
 *   short rule instead of its heading.
 *
 * Menu.groups.test.tsx holds the structure and theme/tokens.contrast.test.ts the colours; padding,
 * antd's inline indent and its collapsed-menu rules only compose in a layout engine, so this runs
 * in Chromium. The fixture is main.tsx `?fixture=app-shell`; its child widgets are served here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Locator, type Page } from '@playwright/test'

const images = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'assets', 'images')
const svgUri = (file: string) => `data:image/svg+xml;base64,${readFileSync(join(images, file)).toString('base64')}`

/** The portal's pages as restaction.sidebar-nav emits them: Dashboard declares no group. */
const NAV = [
  { icon: 'fa-gauge', label: 'Dashboard', order: 1, path: '/dashboard' },
  { group: 'Workspace', icon: 'fa-cubes', label: 'Compositions', order: 10, path: '/compositions' },
  { group: 'Workspace', icon: 'fa-layer-group', label: 'Blueprints', order: 11, path: '/blueprints' },
  { group: 'Workspace', icon: 'fa-store', label: 'Marketplace', order: 12, path: '/marketplace' },
  { group: 'Operate', icon: 'fa-wave-square', label: 'Observability', order: 20, path: '/observability' },
  { group: 'Operate', icon: 'fa-triangle-exclamation', label: 'Incidents', order: 21, path: '/incidents' },
  { group: 'Operate', icon: 'fa-bell', label: 'Alerts', order: 22, path: '/alerts' },
  { group: 'Build', icon: 'fa-pen-ruler', label: 'Portal builder', order: 30, path: '/portal-builder' },
  { group: 'Platform', icon: 'fa-sliders', label: 'Settings', order: 40, path: '/settings' },
  { group: 'Platform', icon: 'fa-ticket', label: 'Raise a ticket', order: 41, path: '/raise-a-ticket' },
]
const GROUPS = ['Workspace', 'Operate', 'Build', 'Platform']

const WIDGETS: Record<string, { kind: string; widgetData: unknown }> = {
  brand: { kind: 'Image', widgetData: { alt: 'Krateo PlatformOps', preview: false, src: svgUri('logo_big.svg'), width: 117 } },
  glyph: { kind: 'Image', widgetData: { alt: 'Krateo PlatformOps', preview: false, src: svgUri('logo_glyph.svg'), width: 28 } },
  'top-bar': { kind: 'Paragraph', widgetData: { text: 'Compositions' } },
}

type Box = { bottom: number; height: number; left: number; right: number; top: number; width: number }
const box = async (locator: Locator): Promise<Box> => {
  const rect = await locator.boundingBox()
  if (!rect) { throw new Error('not rendered') }
  return { bottom: rect.y + rect.height, height: rect.height, left: rect.x, right: rect.x + rect.width, top: rect.y, width: rect.width }
}

const openShell = async (page: Page, width: number, mode: 'dark' | 'light' = 'dark', nav = NAV) => {
  await page.setViewportSize({ height: 760, width })
  // WidgetRenderer reads a token before it fetches; the mock accepts any.
  await page.addInitScript(() => localStorage.setItem('K_user', JSON.stringify({ accessToken: 'fixture' })))
  await page.route('http://127.0.0.1:9/**', async (route) => {
    const name = new URL(route.request().url()).searchParams.get('name') ?? ''
    const { kind, widgetData } = name === 'nav' ? { kind: 'Menu', widgetData: { allowedResources: ['flexes'], items: nav, mode: 'inline' } } : WIDGETS[name]
    await route.fulfill({ json: { apiVersion: 'widgets.templates.krateo.io/v1beta1', kind, metadata: { name, namespace: 'krateo-system', uid: name }, spec: { widgetData }, status: { resourcesRefs: { items: [] }, widgetData } } })
  })
  await page.goto(`/visual/index.html?fixture=app-shell&mode=${mode}`)
  await expect(page.getByRole('menuitem')).toHaveCount(nav.length)
  await page.getByRole('img', { name: 'Krateo PlatformOps' }).evaluate((image: HTMLImageElement) => image.decode())
  await page.evaluate(() => document.fonts.ready)
  // The Menu selects its first page once it has navigated there, and antd eases the selected
  // background and the collapsed rail's padding in: measure the settled state, not a frame of it.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)))
}

const sider = (page: Page) => page.locator('.ant-layout-sider')
/** The Layout's sider header slot (Layout.module.css .siderHeader; CSS-module names keep the class name). */
const band = (page: Page) => sider(page).locator('[class*="siderHeader"]').first()
const icons = (page: Page) => page.getByRole('menuitem').locator('.ant-menu-item-icon')
const headings = (page: Page) => page.locator('.ant-menu-item-group-title')

/** A collapsed group title, drawn as a rule. */
const rule = (heading: Locator) => heading.evaluate((element) => {
  const computed = getComputedStyle(element)
  return { display: computed.display, height: computed.height, width: computed.width }
})

/** Where a heading's TEXT starts: its box plus its own padding, which is what the eye lines up. */
const textLeft = (heading: Locator) => heading.evaluate((element) => {
  const range = document.createRange()
  range.selectNodeContents(element)
  return range.getBoundingClientRect().left
})

test.describe('expanded, 1280px', () => {
  test('the brand band is the top bar\'s height, level with it, the logo on x = 24', async ({ page }) => {
    await openShell(page, 1280)
    const rail = await box(sider(page))
    const header = await box(band(page))
    const topBar = await box(page.locator('.ant-layout-header'))
    const logo = await box(page.getByRole('img', { name: 'Krateo PlatformOps' }))

    expect(rail.width, 'the Sider is the chart\'s 236px').toBe(236)
    expect(header.height, 'the band is 64px').toBe(64)
    expect(header.top).toBe(topBar.top)
    expect(header.bottom, 'its hairline is level with the top bar\'s bottom line').toBe(topBar.bottom)
    expect(logo.left - rail.left, 'the logo starts on the one left edge').toBe(24)
    expect(Math.abs((logo.top + logo.bottom) / 2 - (header.top + header.bottom) / 2), 'centred in the band').toBeLessThanOrEqual(1)
    const hairline = await band(page).evaluate((element) => getComputedStyle(element).borderBottom)
    expect(hairline).toBe('1px solid rgba(255, 255, 255, 0.12)')
  })

  test('one left edge: every icon and every group heading\'s text starts at x = 24', async ({ page }) => {
    await openShell(page, 1280)
    const rail = await box(sider(page))
    const iconLefts = await Promise.all((await icons(page).all()).map(async (icon) => (await box(icon)).left - rail.left))
    expect(iconLefts).toEqual(Array(NAV.length).fill(24))
    const headingLefts = await Promise.all((await headings(page).all()).map(async (heading) => (await textLeft(heading)) - rail.left))
    expect(headingLefts).toEqual(Array(GROUPS.length).fill(24))
  })

  test('16px from the band to the first entry, 36px rows, 16px between groups, headings in order', async ({ page }) => {
    await openShell(page, 1280)
    const header = await box(band(page))
    const rows = await Promise.all((await page.getByRole('menuitem').all()).map(box))
    expect(rows[0].top - header.bottom, 'the gap under the band').toBe(16)
    expect(rows.map((row) => row.height)).toEqual(Array(NAV.length).fill(36))
    expect(await headings(page).allInnerTexts(), 'drawn uppercase, named by nav-group').toEqual(GROUPS.map((group) => group.toUpperCase()))

    const [workspace, operate] = await Promise.all([headings(page).nth(0), headings(page).nth(1)].map(box))
    const [, , , lastWorkspaceRow] = rows
    expect(workspace.height).toBe(24)
    expect(workspace.top, 'a heading sits directly on its first row').toBe(rows[1].top - 24)
    expect(operate.top - lastWorkspaceRow.bottom, 'the gap before the next group').toBe(16)
    expect(workspace.top - rows[0].bottom, 'the same gap after an ungrouped entry').toBe(16)
  })

  test('a group heading is 11px / 600, +0.08em, uppercase, white at 55%', async ({ page }) => {
    await openShell(page, 1280)
    const style = await headings(page).first().evaluate((element) => {
      const computed = getComputedStyle(element)
      return { color: computed.color, size: computed.fontSize, tracking: computed.letterSpacing, transform: computed.textTransform, weight: computed.fontWeight }
    })
    expect(style).toEqual({ color: 'rgba(255, 255, 255, 0.55)', size: '11px', tracking: '0.88px', transform: 'uppercase', weight: '600' })
  })

  test('the selected row is a 16% #C27AFF tint with a 3px #C27AFF bar at its leading edge', async ({ page }) => {
    await openShell(page, 1280)
    const selected = page.locator('.ant-menu-item-selected')
    await expect(selected).toHaveCount(1)
    const row = await box(selected)
    const drawn = await selected.evaluate((element) => {
      const bar = getComputedStyle(element, '::before')
      return { background: getComputedStyle(element).backgroundColor, bar: bar.backgroundColor, barLeft: bar.left, barWidth: bar.width, color: getComputedStyle(element).color, weight: getComputedStyle(element).fontWeight }
    })
    expect(drawn).toEqual({ background: 'rgba(194, 122, 255, 0.16)', bar: 'rgb(194, 122, 255)', barLeft: '0px', barWidth: '3px', color: 'rgb(255, 255, 255)', weight: '500' })
    expect(row.height).toBe(36)
  })
})

test.describe('collapsed icon rail, 900px', () => {
  test('80px wide, the glyph centred in the same 64px band, every icon centred', async ({ page }) => {
    await openShell(page, 900)
    const rail = await box(sider(page))
    const header = await box(band(page))
    const topBar = await box(page.locator('.ant-layout-header'))
    const glyph = await box(page.getByRole('img', { name: 'Krateo PlatformOps' }))
    const centre = rail.left + rail.width / 2

    expect(rail.width).toBe(80)
    expect(header.height).toBe(64)
    expect(header.bottom).toBe(topBar.bottom)
    expect(glyph.width, 'the compact glyph, not the full logo').toBe(28)
    expect(Math.abs((glyph.left + glyph.right) / 2 - centre)).toBeLessThanOrEqual(1)
    const iconCentres = await Promise.all((await icons(page).all()).map(async (icon) => {
      const drawn = await box(icon)
      return Math.abs((drawn.left + drawn.right) / 2 - centre)
    }))
    iconCentres.forEach((offset) => expect(offset, 'icon centred on the rail').toBeLessThanOrEqual(1))
    const rows = await Promise.all((await page.getByRole('menuitem').all()).map(box))
    rows.forEach((row) => {
      expect(row.left, 'no row spills out of the rail').toBeGreaterThanOrEqual(rail.left)
      expect(row.right).toBeLessThanOrEqual(rail.right)
    })
  })

  test('groups become short rules: a 24px hairline before each group that follows an entry', async ({ page }) => {
    await openShell(page, 900)
    const rules = await Promise.all((await headings(page).all()).map(rule))
    expect(rules).toEqual(Array(GROUPS.length).fill({ display: 'block', height: '1px', width: '24px' }))
  })

  test('a group that opens the nav has no rule above it', async ({ page }) => {
    await openShell(page, 900, 'dark', NAV.filter((item) => item.group))
    const rules = await Promise.all((await headings(page).all()).map(rule))
    expect(rules[0].display).toBe('none')
    expect(rules.slice(1)).toEqual(Array(GROUPS.length - 1).fill({ display: 'block', height: '1px', width: '24px' }))
  })
})

for (const mode of ['dark', 'light'] as const) {
  for (const [state, width] of [['expanded', 1280], ['collapsed', 900]] as const) {
    test(`the sidebar · ${state} · ${mode}`, async ({ page }) => {
      await openShell(page, width, mode)
      await expect(sider(page)).toHaveScreenshot(`Sidebar-${state}-${mode}.png`)
    })
  }
}
