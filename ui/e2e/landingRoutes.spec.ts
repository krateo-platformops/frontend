/**
 * A LANDING'S PAGE REQUEST DOES NOT WAIT FOR THE SIDEBAR (api.NAV, components/Shell/NavRoutesPrefetch).
 *
 * snowplow's bench (run 30) measured a sign-in landing at 852 ms median, ~570 ms of it the browser
 * waiting between dependent requests. The dashboard page request started 510 ms in, 215 ms after the
 * shell's last response: the route map came from the sidebar Menu, which the shell fetched only after
 * its Layout and the sider's Flex, and registered only after rendering. A landing on `/` is run through
 * the real built app, with the stubbed /call answers under the test's control (no wall-clock compared):
 *
 *   NAV set     the sider's Flex is HELD unanswered; the page request is still issued while it is held
 *               (the Menu was read in parallel with INIT, held too: its read is issued while the shell
 *               is unanswered); the Menu is read exactly once (the sider renders it from cache)
 *   NAV empty   the control, today's behaviour: with the sider's Flex held, neither the Menu nor the page
 *               is requested; the Menu is requested only after the Flex answers, the page only after the Menu
 * Same fixtures: only `NAV` differs, so the gap between the arms is the change. Order is read from one
 * event log, so a slow runner cannot reorder what the test itself releases.
 */
import { expect, test, type Page } from '@playwright/test'

const TOKEN = 'SYNTHETIC-TOKEN-never-leaves'
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
  // Its own text, not the Menu item's label: waiting on "Dashboard" could be met by the sidebar alone.
  hello: widget('Paragraph', 'hello', { text: 'The dashboard page body' }),
  'page-dashboard': widget('Flex', 'page-dashboard', { allowedResources: ['paragraphs'], items: [{ resourceRefId: 'hello' }] }, [ref('hello', 'paragraphs', 'hello')]),
  'sidebar-nav': widget('Menu', 'sidebar-nav', { items: [{ label: 'Dashboard', order: 1, path: '/dashboard', resourceRefId: 'page' }] }, [ref('page', 'flexes', 'page-dashboard')]),
  'sider-content': widget('Flex', 'sider-content', { allowedResources: ['menus'], items: [{ resourceRefId: 'nav' }], vertical: true }, [ref('nav', 'menus', 'sidebar-nav')]),
}

type Event = `answered:${string}` | `requested:${string}`

type Landing = {
  /** One log of every stubbed read, in the order the browser issued and the test answered them. */
  events: Event[]
  /** Answer a held widget. */
  release: (name: string) => void
  /** Resolves once the app has requested `name` (held or not). */
  requested: (name: string) => Promise<void>
  /** Release nothing more: wait for the page to render and check every widget on the path was read. */
  settled: () => Promise<void>
}

/** Open `/` with a synthetic session. The answers of the widgets in `held` wait until `release(name)`;
 * every other answer is immediate. */
const land = async (page: Page, nav: string, held: string[]): Promise<Landing> => {
  const snowplow = 'http://localhost:4174/sp'
  const events: Event[] = []
  const gates = new Map(held.map((name) => {
    const { promise: closed, resolve: open } = Promise.withResolvers<void>()
    return [name, { closed, open }] as const
  }))
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
    if (body) { events.push(`requested:${name}`) }
    await gates.get(name)?.closed
    if (body) { events.push(`answered:${name}`) }
    await route.fulfill({ body: JSON.stringify(body ?? { message: 'not found' }), contentType: 'application/json', status: body ? 200 : 404 })
  })
  await page.goto('/')
  return {
    events,
    release: (name) => { gates.get(name)?.open() },
    requested: async (name) => { await expect.poll(() => events.includes(`requested:${name}`), { message: `${name} is requested` }).toBe(true) },
    settled: async () => {
      // The PAGE has rendered (its own paragraph), so the page request has been made and answered.
      // Its own text, not the Menu item's label: waiting on "Dashboard" could be met by the sidebar alone.
      await expect(page.getByText('The dashboard page body')).toBeVisible()
      await expect(page).toHaveURL(/\/dashboard$/)
      expect([...new Set(events.map((event) => event.split(':')[1]))].sort(), 'every widget on the path was read').toEqual(['app-shell', 'hello', 'page-dashboard', 'sidebar-nav', 'sider-content'])
    },
  }
}

const reads = (events: Event[], name: string) => events.filter((event) => event === `requested:${name}`).length

test('with NAV, the page is requested while the shell\'s own children are still unanswered', async ({ page }) => {
  const landing = await land(page, NAV, ['app-shell', 'sider-content'])
  // The Menu is read alongside the shell, not after it: its read is issued while the shell is unanswered.
  await landing.requested('sidebar-nav')
  expect(landing.events, 'the Menu is read before the shell has answered').not.toContain('answered:app-shell')
  landing.release('app-shell')
  // The shell's child (the sider's Flex) is now asked for and held. The page must be asked for anyway.
  await landing.requested('sider-content')
  await landing.requested('page-dashboard')
  expect(landing.events, 'the page is requested while the sider\'s Flex is unanswered').not.toContain('answered:sider-content')
  landing.release('sider-content')
  await landing.settled()
  expect(reads(landing.events, 'sidebar-nav'), 'the Menu is read once; the sider renders it from that read').toBe(1)
})

test('control: without NAV, the page waits for the shell, its sider Flex and the Menu, in turn', async ({ page }) => {
  const landing = await land(page, '', ['sider-content'])
  await landing.requested('sider-content')
  // The Menu lives in the sider: with the Flex held nothing can ask for it, nor for the page. A fixed
  // window can only miss a request that is coming late, never invent one, so it cannot fail a good run.
  await page.waitForTimeout(1000)
  expect(landing.events, 'neither the Menu nor the page is requested while the sider Flex is held').not.toContain('requested:sidebar-nav')
  expect(landing.events).not.toContain('requested:page-dashboard')
  landing.release('sider-content')
  await landing.settled()
  const order = (event: Event) => landing.events.indexOf(event)
  expect(order('requested:sidebar-nav'), 'the Menu is read only after the sider Flex answers').toBeGreaterThan(order('answered:sider-content'))
  expect(order('requested:page-dashboard'), 'the page is read only after the Menu answers').toBeGreaterThan(order('answered:sidebar-nav'))
})

// Prefetch children on answer (hooks/prefetchChildren.ts) must not cost a read: the prefetch fills the
// entry each child's own query reads, so every widget on the landing is still read exactly once. That
// the prefetch happens at all is proven deterministically in hooks/useWidgetQuery.prefetch.test.tsx: an
// order test here (request start against first DOM insertion) passed WITHOUT the prefetch too, so it
// could not tell the two apart, and a timing threshold failed under load.
test('each widget on the landing is read exactly once', async ({ page }) => {
  const landing = await land(page, NAV, [])
  await landing.settled()
  for (const name of Object.keys(fixtures)) {
    expect(reads(landing.events, name), `${name} is read once`).toBe(1)
  }
})
