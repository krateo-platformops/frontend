// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { carryScopeParams, isExternalUrl, navigateOrExternal } from './navigation'

describe('isExternalUrl', () => {
  it('is true for http(s) URLs', () => {
    expect(isExternalUrl('https://github.com/o/r/pull/2')).toBe(true)
    expect(isExternalUrl('http://example.com')).toBe(true)
    expect(isExternalUrl('  HTTPS://x.io  ')).toBe(true)
  })
  it('is false for in-app routes and blanks', () => {
    expect(isExternalUrl('/compositions/ns/name')).toBe(false)
    expect(isExternalUrl('/resources/cluster/core/v1/namespaces/x')).toBe(false)
    expect(isExternalUrl('')).toBe(false)
    expect(isExternalUrl(undefined)).toBe(false)
    expect(isExternalUrl('mailto:x@y.z')).toBe(false)
  })
})

describe('navigateOrExternal', () => {
  it('opens an external URL in a new tab, never touching the router', () => {
    const navigate = vi.fn()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    navigateOrExternal(navigate, 'https://github.com/o/r/pull/2')
    expect(open).toHaveBeenCalledWith('https://github.com/o/r/pull/2', '_blank', 'noopener,noreferrer')
    expect(navigate).not.toHaveBeenCalled()
    open.mockRestore()
  })
  it('routes an internal path through react-router (with the optional resolver)', () => {
    const navigate = vi.fn()
    navigateOrExternal(navigate, '/compositions/ns/name')
    expect(navigate).toHaveBeenCalledWith('/compositions/ns/name')

    const resolve = (path: string) => `${path}?merged=1`
    navigateOrExternal(navigate, '/compositions', resolve)
    expect(navigate).toHaveBeenCalledWith('/compositions?merged=1')
  })
  it('is a no-op for a blank/undefined path', () => {
    const navigate = vi.fn()
    navigateOrExternal(navigate, '')
    navigateOrExternal(navigate, undefined)
    expect(navigate).not.toHaveBeenCalled()
  })
})

/**
 * The reported bug: "header projects, when selected, are not kept selected when navigating another
 * page". The switcher keeps its selection ONLY in `?projects=` (widgets/Select, queryParam mode),
 * and every nav site emitted a bare pathname — so the first click in the sidebar dropped it.
 * These pin the carry AND its limits: it must not turn into a blanket query-merge, which would
 * make page-local filters leak across pages (the thing resolveNavigationTarget exists to prevent).
 */
describe('carryScopeParams', () => {
  it('carries the project scope onto a target on ANOTHER page', () => {
    expect(carryScopeParams('/blueprints', '?projects=alpha,beta')).toBe('/blueprints?projects=alpha%2Cbeta')
  })

  it('keeps the scope beside the params the target brings itself', () => {
    const out = carryScopeParams('/compositions?status=failed', '?projects=alpha')
    expect(out).toContain('status=failed')
    expect(out).toContain('projects=alpha')
  })

  it('lets the TARGET win, so the scope stays changeable (and clearable)', () => {
    // The switcher applying a new scope, or a project-scoped deep link, must not be overridden
    // by the scope currently on screen.
    expect(carryScopeParams('/compositions?projects=gamma', '?projects=alpha')).toBe('/compositions?projects=gamma')
  })

  it('does NOT resurrect a cleared scope ("All projects")', () => {
    expect(carryScopeParams('/compositions', '?status=failed')).toBe('/compositions')
  })

  it('carries ONLY the scope — a page-local filter must still not leak to another page', () => {
    const out = carryScopeParams('/incidents', '?projects=alpha&status=failed&range=7d&q=web')
    expect(out).toBe('/incidents?projects=alpha')
  })

  it('returns a query-less target untouched when there is no scope to carry', () => {
    expect(carryScopeParams('/compositions', '')).toBe('/compositions')
    expect(carryScopeParams('/compositions?status=failed', '')).toBe('/compositions?status=failed')
  })
})

describe('navigateOrExternal — the global scope rides along', () => {
  afterEach(() => { window.history.replaceState({}, '', '/') })

  it('adds the applied project scope to an in-app target', () => {
    window.history.replaceState({}, '', '/compositions?projects=alpha')
    const navigate = vi.fn()
    navigateOrExternal(navigate, '/blueprints')
    expect(navigate).toHaveBeenCalledWith('/blueprints?projects=alpha')
  })

  it('never rewrites an external URL', () => {
    window.history.replaceState({}, '', '/compositions?projects=alpha')
    const navigate = vi.fn()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    navigateOrExternal(navigate, 'https://github.com/o/r/pull/2')
    expect(open).toHaveBeenCalledWith('https://github.com/o/r/pull/2', '_blank', 'noopener,noreferrer')
    expect(navigate).not.toHaveBeenCalled()
    open.mockRestore()
  })
})
