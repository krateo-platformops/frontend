import { describe, expect, it } from 'vitest'

import type { ResourcesRefs } from '../../types/Widget'

import { buildNavModel, resolveContentEndpoint } from './navModel'

const resourcesRefs: ResourcesRefs = {
  items: [
    { allowed: true, id: 'home-page', path: '/call?resource=flexes&name=home', payload: {}, verb: 'GET' },
    { allowed: true, id: 'settings-page', path: '/call?resource=flexes&name=settings', payload: {}, verb: 'GET' },
  ],
}

describe('Menu navModel', () => {
  it('builds entries + routes from inline items, sorted by order, resolving content endpoints', () => {
    const items = [
      { icon: 'fa-gear', label: 'Settings', order: 20, path: '/settings', resourceRefId: 'settings-page' },
      { icon: 'fa-home', label: 'Home', order: 10, path: '/home', resourceRefId: 'home-page' },
    ]
    const { entries, routes } = buildNavModel(items, resourcesRefs)

    expect(entries.map((entry) => entry.label)).toEqual(['Home', 'Settings'])
    expect(entries[0]).toEqual({ iconName: 'fa-home', key: '/home', label: 'Home' })
    expect(routes[0]).toEqual({ endpoint: '/call?resource=flexes&name=home', path: '/home', resourceRef: resourcesRefs.items[0], resourceRefId: 'home-page', title: 'Home' })
  })

  it('skips items missing a path (no path → neither route nor entry)', () => {
    const { entries, routes } = buildNavModel([{ label: 'Home', resourceRefId: 'home-page' }], resourcesRefs)
    expect(entries).toHaveLength(0)
    expect(routes).toHaveLength(0)
  })

  it('derives a flexes/page-<slug> endpoint when an item has no resourceRefId (convention)', () => {
    const { entries, routes } = buildNavModel([{ label: 'Marketplace', path: '/marketplace' }], { items: [] }, 'krateo-system')
    expect(entries.map((entry) => entry.label)).toEqual(['Marketplace'])
    expect(routes[0].endpoint).toBe('/call?resource=flexes&apiVersion=widgets.templates.krateo.io/v1beta1&name=page-marketplace&namespace=krateo-system')
  })

  it('registers a route-only (label-less, templated) item with a page-<slug> endpoint and no sidebar entry', () => {
    const { entries, routes } = buildNavModel([{ page: 'composition-detail', path: '/compositions/{namespace}/{name}' }], { items: [] }, 'krateo-system')
    expect(entries).toHaveLength(0)
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({
      endpoint: '/call?resource=flexes&apiVersion=widgets.templates.krateo.io/v1beta1&name=page-composition-detail&namespace=krateo-system',
      path: '/compositions/{namespace}/{name}',
      resourceRefId: '',
    })
  })

  it('prefers resourceRefId over the page-<slug> convention when both could apply', () => {
    const { routes } = buildNavModel([{ label: 'Home', path: '/home', resourceRefId: 'home-page' }], resourcesRefs, 'krateo-system')
    expect(routes[0].endpoint).toBe('/call?resource=flexes&name=home')
  })

  it('RBAC: hides a sidebar entry whose ref was dropped (allowed:false → WidgetRenderer removes it → absent), keeps present ones', () => {
    // WidgetRenderer pre-filters allowed:false refs OUT before the Menu sees them,
    // so a DENIED page is represented by its ref being ABSENT (not present-with-allowed:false).
    const rbacRefs: ResourcesRefs = {
      items: [
        { allowed: true, id: 'home-page', path: '/call?resource=flexes&name=home', payload: {}, verb: 'GET' },
        // 'settings-page' was allowed:false -> removed by WidgetRenderer -> absent here
      ],
    }
    const items = [
      { icon: 'fa-home', label: 'Home', order: 10, path: '/home', resourceRefId: 'home-page' },
      { icon: 'fa-gear', label: 'Settings', order: 20, path: '/settings', resourceRefId: 'settings-page' },
    ]
    const { entries, routes } = buildNavModel(items, rbacRefs)
    // denied 'Settings' (ref absent) is dropped from the sider; 'Home' (ref present) stays
    expect(entries.map((entry) => entry.label)).toEqual(['Home'])
    // routes are NOT RBAC-filtered — the deep-link still resolves (page /call 403s at the content layer)
    expect(routes.map((route) => route.path)).toEqual(['/home', '/settings'])
  })

  it('fail-open ONLY for no-resourceRefId (convention pages); a resourceRefId whose ref is absent (denied/removed) is HIDDEN', () => {
    const { entries } = buildNavModel(
      [
        // no resourceRefId → convention page → shown
        { label: 'Marketplace', order: 1, path: '/marketplace' },
        // ref absent → denied/removed → hidden
        { label: 'Ghost', order: 2, path: '/ghost', resourceRefId: 'missing' },
      ],
      { items: [] },
      'krateo-system',
    )
    expect(entries.map((entry) => entry.label)).toEqual(['Marketplace'])
  })
})

describe('resolveContentEndpoint — a page that lives in another namespace', () => {
  it('resolves the convention in the ITEM’s namespace when it declares one', () => {
    // Without this, the convention resolves every page in the single configured
    // FRONTEND_NAMESPACE — so a page shipped by another chart, or placed in a `tiers` namespace,
    // is simply unreachable by a nav entry that has no resourceRefId.
    const endpoint = resolveContentEndpoint(
      { namespace: 'krateo-tenant', page: 'fleet-health', path: '/fleet-health' },
      { items: [] },
      'krateo-system',
    )

    expect(endpoint).toContain('namespace=krateo-tenant')
    expect(endpoint).toContain('name=page-fleet-health')
  })

  it('falls back to the configured namespace when the item declares none', () => {
    // Today's behaviour, unchanged — every existing item omits it.
    const endpoint = resolveContentEndpoint({ page: 'dashboard', path: '/dashboard' }, { items: [] }, 'krateo-system')

    expect(endpoint).toContain('namespace=krateo-system')
  })

  it('does NOT let the item namespace override an explicit resourceRefId path', () => {
    // Precedence is unchanged: a structured ref already carries its own namespace, resolved by
    // snowplow. The item namespace only feeds the convention fallback.
    const endpoint = resolveContentEndpoint(
      { namespace: 'ignored-ns', resourceRefId: 'dash' },
      { items: [{ id: 'dash', path: '/call?resource=flexes&namespace=real-ns&name=dashboard-flex' }] } as never,
      'krateo-system',
    )

    expect(endpoint).toContain('namespace=real-ns')
  })

  it('keeps an empty namespace rather than silently defaulting it', () => {
    // `??` not `||`: an empty string is a misconfigured item, and letting it 404 is more honest
    // than quietly resolving somewhere that happens to work.
    const endpoint = resolveContentEndpoint({ namespace: '', page: 'x', path: '/x' }, { items: [] }, 'krateo-system')

    // `namespace` is the last query param, so the empty value shows as a trailing `namespace=`.
    expect(endpoint.endsWith('namespace=')).toBe(true)
  })
})
