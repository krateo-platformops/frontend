import { describe, expect, it } from 'vitest'

import { getResourceEndpoint } from '../../utils/utils'

import { navEndpoint } from './NavRoutesPrefetch'

const MENU = { apiVersion: 'widgets.templates.krateo.io/v1beta1', name: 'sidebar-nav', namespace: 'krateo-system', resource: 'menus' }

describe('navEndpoint: api.NAV in the exact form of the Menu\'s own read, so both share one cached query', () => {
  it('the chart default is already that form', () => {
    const chartDefault = '/call?resource=menus&apiVersion=widgets.templates.krateo.io/v1beta1&name=sidebar-nav&namespace=krateo-system'
    expect(navEndpoint(chartDefault)).toBe(getResourceEndpoint(MENU))
    expect(navEndpoint(chartDefault)).toBe(chartDefault)
  })

  it('any parameter order becomes the child-ref form (a different string would be a second request)', () => {
    expect(navEndpoint('/call?name=sidebar-nav&namespace=krateo-system&resource=menus&apiVersion=widgets.templates.krateo.io/v1beta1'))
      .toBe(getResourceEndpoint(MENU))
  })

  it('a cluster-scoped menu has no namespace parameter', () => {
    expect(navEndpoint('/call?resource=menus&apiVersion=widgets.templates.krateo.io/v1beta1&name=sidebar-nav'))
      .toBe(getResourceEndpoint({ ...MENU, namespace: undefined }))
  })

  it('unset, empty, not a /call read, or missing a coordinate: no prefetch, the Menu stays the only route source', () => {
    expect(navEndpoint(undefined)).toBeNull()
    expect(navEndpoint('')).toBeNull()
    expect(navEndpoint('/export?resource=menus&apiVersion=widgets.templates.krateo.io/v1beta1&name=sidebar-nav')).toBeNull()
    expect(navEndpoint('/call?resource=menus&apiVersion=widgets.templates.krateo.io/v1beta1')).toBeNull()
  })
})
