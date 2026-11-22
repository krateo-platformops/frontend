/**
 * A LANDING'S PAGE REQUEST DOES NOT WAIT FOR THE SIDEBAR (api.NAV, components/Shell/NavRoutesPrefetch).
 *
 * snowplow's bench (run 30) measured a sign-in landing at 852 ms median, ~570 ms of it the browser
 * waiting between dependent requests. The dashboard page request started 510 ms in, 215 ms after the
 * shell's last response: the route map came from the sidebar Menu, which the shell fetched only after
 * its Layout and the sider's Flex, and registered only after rendering. Here every stubbed /call
 * answers after DELAY ms, and a landing on `/` is timed through the real built app:
 *
 *   NAV set     the Menu is read in parallel with INIT, so the page request starts BEFORE the sider's
 *               Flex has answered; the Menu is read exactly once (the sider renders it from cache)
 *   NAV empty   the control, today's behaviour: the page request waits for Layout -> sider Flex ->
 *               Menu, and starts after the sider's Flex has answered
 * Same fixtures, same delays: only `NAV` differs, so the gap between the arms is the change.
 */
import { expect, test, type Page } from '@playwright/test'

const TOKEN = 'SYNTHETIC-TOKEN-never-leaves'
const DELAY = 80
const api = 'widgets.templates.krateo.io/v1beta1'
const ref = (id: string, resource: string, name: string) => ({
  allowed: true, id, path: `/call?resource=${resource}&apiVersion=${api}&name=${name}&namespace=krateo-system`, payload: {}, verb: 'GET',
})
const INIT = `/call?resource=layouts&apiVersion=${api}&name=app-shell&namespace=krateo-system`
const NAV = `/call?resource=menus&apiVersion=${api}&name=sidebar-nav&namespace=krateo-system`

const widget = (kind: string, name: string, widgetData: Record<string, unknown>, refs: unknown[] = []) => ({
  apiVersion: api,
  kind,
  metadata: { name, namespace: 'krateo-system', uid: `uid-${name}` },
  spec: { widgetData },
  status: { resourcesRefs: { items: refs }, widgetData },
})

const fixtures: Record<string, unknown> = {
  'app-shell': widget('Layout', 'app-shell', { hasSider: true, sider: { resourceRefId: 'sider' } }, [ref('sider', 'flexes', 'sider-content')]),
  hello: widget('Paragraph', 'hello', { text: 'Dashboard' }),
  'page-dashboard': widget('Flex', 'page-dashboard', { allowedResources: ['paragraphs'], items: [{ resourceRefId: 'hello' }] }, [ref('hello', 'paragraphs', 'hello')]),
  'sidebar-nav': widget('Menu', 'sidebar-nav', { items: [{ label: 'Dashboard', order: 1, path: '/dashboard', resourceRefId: 'page' }] }, [ref('page', 'flexes', 'page-dashboard')]),
  'sider-content': widget('Flex', 'sider-content', { allowedResources: ['menus'], items: [{ resourceRefId: 'nav' }], vertical: true }, [ref('nav', 'menus', 'sidebar-nav')]),
}

type Timing = { end: number; start: number }

/** Land on `/` with a synthetic session; return when each widget was requested and answered (ms since navigation). */
const land = async (page: Page, nav: string): Promise<Record<string, Timing[]>> => {
  const snowplow = 'http://localhost:4174/sp'
  const timings: Record<string, Timing[]> = {}
  let t0 = 0
  await page.addInitScript((token) => {
    window.localStorage.setItem('K_user', JSON.stringify({ accessToken: token, user: { displayName: 'Ada', username: 'ada' } }))
  }, TOKEN)
  await page.route('**/config/config.json', (route) => route.fulfill({
    body: JSON.stringify({
      api: { AUTHN_API_BASE_URL: `${snowplow}/authn`, EVENTS_API_BASE_URL: `${snowplow}/events`, EVENTS_PUSH_API_BASE_URL: `${snowplow}/events`, INIT, NAV: nav, SNOWPLOW_API_BASE_URL: snowplow },
      params: { DELAY_SAVE_NOTIFICATION: '10000', FRONTEND_NAMESPACE: 'krateo-system', PUBLIC_NAMESPACE: 'krateo-public' },
    }),
    contentType: 'application/json',
  }))
  await page.route('**/sp/**', async (route) => {
    const name = new URL(route.request().url()).searchParams.get('name') ?? ''
    const body = fixtures[name]
    const timing = { end: 0, start: Date.now() - t0 }
    if (body) { (timings[name] ??= []).push(timing) }
    await new Promise((resolve) => { setTimeout(resolve, DELAY) })
    timing.end = Date.now() - t0
    await route.fulfill({ body: JSON.stringify(body ?? { message: 'not found' }), contentType: 'application/json', status: body ? 200 : 404 })
  })
  t0 = Date.now()
  await page.goto('/')
  await expect(page.getByText('Dashboard', { exact: true }).last()).toBeVisible()
  await expect(page).toHaveURL(/\/dashboard$/)
  // Every stubbed read has answered before anything is measured (a timing read mid-flight is 0).
  await expect.poll(() => Object.values(timings).flat().every((timing) => timing.end > 0)).toBe(true)
  return timings
}

/** ms between the app shell's answer and a request: the load of the app bundle varies by run, so
 * every arm is measured from the same event, the first answer the shell gets. */
const afterShell = (timings: Record<string, Timing[]>, name: string) => timings[name][0].start - timings['app-shell'][0].end

test('with NAV, the page is requested in the same round as the shell\'s own children', async ({ page }) => {
  const timings = await land(page, NAV)
  const pageAt = afterShell(timings, 'page-dashboard')
  const siderAt = afterShell(timings, 'sider-content')
  // One render after the shell answers, the shell asks for its children AND (routes known) the page.
  expect(pageAt, `page requested ${pageAt} ms after the shell answered; the sider's Flex ${siderAt} ms`).toBeLessThanOrEqual(siderAt + 25)
  expect(timings['sidebar-nav'][0].start, 'the Menu is read alongside the shell').toBeLessThanOrEqual(timings['app-shell'][0].start + 25)
  expect(timings['sidebar-nav'], 'the Menu is read once; the sider renders it from that read').toHaveLength(1)
})

test('control: without NAV, the page waits for the shell, its sider Flex and the Menu, in turn', async ({ page }) => {
  const timings = await land(page, '')
  expect(timings['sidebar-nav'][0].start, 'the Menu is read only after the sider Flex answers').toBeGreaterThan(timings['sider-content'][0].end)
  expect(timings['page-dashboard'][0].start, 'the page is read only after the Menu answers').toBeGreaterThan(timings['sidebar-nav'][0].end)
})
