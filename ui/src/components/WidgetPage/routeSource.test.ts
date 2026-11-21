/**
 * routeSource — the Menu read's state, read from a REAL query cache (no mocks of react-query), and
 * classified the way WidgetRenderer classifies a widget's failure.
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { WidgetFetchError } from '../../hooks/useWidgetQuery'

import { classifyRouteSourceFailure, readRouteSource, retryRouteSource } from './routeSource'

const MENUS = '/call?resource=menus&apiVersion=widgets.templates.krateo.io/v1beta1&name=sidebar-nav&namespace=krateo-system'
const OTHER = '/call?resource=flexes&apiVersion=widgets.templates.krateo.io/v1beta1&name=page-alerts&namespace=krateo-alerts'

const failWith = async (client: QueryClient, endpoint: string, error: Error) => {
  const queryKey = ['widgets', endpoint, '']
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the key is the menu query's own shape; the error is the fixture
  await client.fetchQuery({ queryFn: () => Promise.reject(error), queryKey, retry: false }).catch(() => undefined)
}

describe('readRouteSource', () => {
  it('reports nothing while there is no menu query yet (the page keeps its loading state)', () => {
    expect(readRouteSource(new QueryClient())).toEqual({ retrying: false })
  })

  it('a 424 is a missing dependency, with snowplow’s words and the menu it was for', async () => {
    const client = new QueryClient()
    await failWith(client, MENUS, new WidgetFetchError('Widget fetch failed: 424 Failed Dependency', 424, 'restactions "nav-items" not found'))
    expect(readRouteSource(client)).toEqual({
      failure: { detail: 'restactions "nav-items" not found', kind: 'dependency', object: 'krateo-system/sidebar-nav', status: 424 },
      retrying: false,
    })
  })

  it('a 403 is not-available-to-you, a 500 an error, a 504 a timeout', async () => {
    const forbidden = new QueryClient()
    await failWith(forbidden, MENUS, new WidgetFetchError('x', 403, 'forbidden'))
    expect(readRouteSource(forbidden).failure?.kind).toBe('forbidden')

    const broken = new QueryClient()
    await failWith(broken, MENUS, new WidgetFetchError('x', 500, 'boom'))
    expect(readRouteSource(broken).failure).toMatchObject({ detail: 'boom', kind: 'error', status: 500 })

    const slow = new QueryClient()
    await failWith(slow, MENUS, new WidgetFetchError('x', 504))
    expect(readRouteSource(slow).failure?.kind).toBe('timeout')
  })

  it('an unreachable server is an error that says so, not a status-less blank', async () => {
    const client = new QueryClient()
    await failWith(client, MENUS, new TypeError('Failed to fetch'))
    expect(readRouteSource(client).failure).toMatchObject({ detail: "Couldn't reach the server. It may still be starting up.", kind: 'error' })
  })

  it('reads a failure snowplow answered IN THE BODY (a Status kind with a code)', () => {
    const client = new QueryClient()
    client.setQueryData(['widgets', MENUS, ''], { pages: [{ code: 424, kind: 'Status', message: 'a dependency is missing', status: 'Failure' }] })
    expect(readRouteSource(client).failure).toMatchObject({ detail: 'a dependency is missing', kind: 'dependency', status: 424 })
  })

  it('a menu that resolved is no failure', () => {
    const client = new QueryClient()
    client.setQueryData(['widgets', MENUS, ''], { pages: [{ kind: 'Menu', status: { widgetData: { items: [] } } }] })
    expect(readRouteSource(client)).toEqual({ retrying: false })
  })

  it('ignores every other widget’s failure: only the route source decides', async () => {
    const client = new QueryClient()
    await failWith(client, OTHER, new WidgetFetchError('x', 424, 'not mine'))
    expect(readRouteSource(client)).toEqual({ retrying: false })
  })

  it('a retry in flight keeps the failure and says it is retrying, then clears on success', async () => {
    const client = new QueryClient()
    await failWith(client, MENUS, new WidgetFetchError('x', 424, 'missing'))
    // The page reads the cache on every change, so it has seen the failure before anyone retries.
    expect(readRouteSource(client).failure?.kind).toBe('dependency')
    let release: (value: unknown) => void = () => undefined
    const query = client.getQueryCache().find({ queryKey: ['widgets', MENUS, ''] })
    query?.setOptions({ queryFn: () => new Promise((resolve) => { release = resolve }), queryKey: ['widgets', MENUS, ''], retry: false })
    const retry = retryRouteSource(client)
    expect(readRouteSource(client)).toMatchObject({ failure: { kind: 'dependency' }, retrying: true })
    release({ pages: [{ kind: 'Menu', status: { widgetData: { items: [] } } }] })
    await retry
    expect(readRouteSource(client)).toEqual({ retrying: false })
  })
})

describe('classifyRouteSourceFailure', () => {
  it('a 404 from before snowplow 1.12.55 reads as the same missing dependency', () => {
    expect(classifyRouteSourceFailure(new WidgetFetchError('x', 404), MENUS).kind).toBe('dependency')
  })

  it('names the menu from the /call URL, namespace first', () => {
    expect(classifyRouteSourceFailure(new WidgetFetchError('x', 500), MENUS).object).toBe('krateo-system/sidebar-nav')
  })
})
