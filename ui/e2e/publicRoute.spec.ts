/**
 * A HARD LOAD of a public address, in a browser that still holds a session token.
 *
 * The unit trap (src/public/PublicPage.trap.test.tsx) renders the app in jsdom; this loads the built
 * app in Chromium, so what is checked is what a person would get: the router resolving `/public/…`
 * on a cold start, the stored session sitting in real localStorage, and the headers of the requests
 * that actually leave the page. The page must render OUTSIDE the signed-in shell — no INIT layout,
 * no redirect to /login — and no request may carry the stored token.
 *
 * The token is synthetic and is written into this test's own fresh browser context. snowplow and
 * the config are mocked with `page.route`; nothing leaves the machine.
 */
import { expect, test, type Page, type Request } from '@playwright/test'

const TOKEN = 'SYNTHETIC-TOKEN-never-leaves'
const INIT = '/call?resource=layouts&apiVersion=widgets.templates.krateo.io/v1beta1&name=app-shell&namespace=krateo-system'

const widget = (kind: string, name: string, widgetData: Record<string, unknown>, refs: unknown[] = []) => ({
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  kind,
  metadata: { name, namespace: 'krateo-system', uid: `uid-${name}` },
  spec: { widgetData },
  status: { resourcesRefs: { items: refs }, widgetData },
})

const fixtures: Record<string, unknown> = {
  'demo-button': widget('Button', 'demo-button', {
    actions: { rest: [{ id: 'write', payload: {}, resourceRefId: 'write-target', type: 'rest' }] },
    clickActionId: 'write',
    label: 'Make a change',
  }, [{ allowed: true, id: 'write-target', path: '/call?resource=configmaps&apiVersion=v1&name=target&namespace=krateo-system', payload: {}, verb: 'POST' }]),
  'page-demo': widget('Flex', 'page-demo', { allowedResources: ['buttons'], items: [{ resourceRefId: 'button' }] }, [{
    allowed: true,
    id: 'button',
    path: '/call?resource=buttons&apiVersion=widgets.templates.krateo.io/v1beta1&name=demo-button&namespace=krateo-system',
    payload: {},
    verb: 'GET',
  }]),
}

/** Serve the config and snowplow, same-origin, answering `statusFor[name]` where one is set. */
const mockBackend = async (page: Page, statusFor: Record<string, number> = {}) => {
  // Same-origin (the preview server's, e2e/playwright.config.ts), so no CORS preflight is involved.
  const snowplow = 'http://localhost:4174/sp'
  await page.route('**/config/config.json', (route) => route.fulfill({
    body: JSON.stringify({
      api: { AUTHN_API_BASE_URL: `${snowplow}/authn`, EVENTS_API_BASE_URL: `${snowplow}/events`, EVENTS_PUSH_API_BASE_URL: `${snowplow}/events`, INIT, SNOWPLOW_API_BASE_URL: snowplow },
      params: { DELAY_SAVE_NOTIFICATION: '10000', FRONTEND_NAMESPACE: 'krateo-system' },
    }),
    contentType: 'application/json',
  }))
  await page.route('**/sp/**', (route) => {
    const name = new URL(route.request().url()).searchParams.get('name') ?? ''
    const status = statusFor[name]
    if (status) {
      return route.fulfill({ body: JSON.stringify({ code: status, kind: 'Status', status: 'Failure' }), contentType: 'application/json', status })
    }
    const body = fixtures[name]
    return route.fulfill({ body: JSON.stringify(body ?? { message: 'not found' }), contentType: 'application/json', status: body ? 200 : 404 })
  })
}

/** A fresh context with a synthetic session in its storage, and a log of every request it makes. */
const openWithStoredSession = async (page: Page, address: string, statusFor?: Record<string, number>) => {
  const requests: Request[] = []
  page.on('request', (request) => { requests.push(request) })
  await page.addInitScript((token) => {
    window.localStorage.setItem('K_user', JSON.stringify({ accessToken: token, user: { displayName: 'Ada', username: 'ada' } }))
  }, TOKEN)
  await mockBackend(page, statusFor)
  await page.goto(address)
  return requests
}

const expectNoCredential = async (requests: Request[]) => {
  expect(requests.length).toBeGreaterThan(0)
  const sent = await Promise.all(requests.map(async (request) => ({ headers: await request.allHeaders(), request })))
  for (const { headers, request } of sent) {
    expect(headers.authorization, `${request.method()} ${request.url()}`).toBeUndefined()
    expect(request.url()).not.toContain(TOKEN)
  }
}

test('a hard load of /public/<slug> renders the page outside the shell, with no token on any request', async ({ page }) => {
  const requests = await openWithStoredSession(page, '/public/demo')

  await expect(page.getByRole('button', { name: 'Make a change' })).toBeVisible()
  // No redirect to /login, and no signed-in shell: its INIT layout was never asked for.
  expect(new URL(page.url()).pathname).toBe('/public/demo')
  expect(requests.some((request) => request.url().includes('name=app-shell'))).toBe(false)
  await expectNoCredential(requests)

  // A write sends nothing and asks the visitor to sign in.
  const before = requests.length
  await page.getByRole('button', { name: 'Make a change' }).click()
  await expect(page.getByText('Sign in to do this', { exact: true })).toBeVisible()
  expect(requests.slice(before).filter((request) => request.url().includes('/sp/'))).toEqual([])
  await expectNoCredential(requests)
})

test('a 401 on the root says public pages are off here, with a plain Sign in link', async ({ page }) => {
  const requests = await openWithStoredSession(page, '/public/demo', { 'page-demo': 401 })

  await expect(page.getByText("Public pages aren't enabled on this installation")).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  expect(new URL(page.url()).pathname).toBe('/public/demo')
  await expectNoCredential(requests)
})
