// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppRoute } from '../../context/RoutesContext'

const matchesRef: { current: { pathname: string }[] } = { current: [] }
const menuRoutesRef: { current: AppRoute[] } = { current: [] }

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useMatches: () => matchesRef.current,
}))
vi.mock('../../context/RoutesContext', () => ({
  useRoutesContext: () => ({ menuRoutes: menuRoutesRef.current }),
}))

const { default: Breadcrumb } = await import('./Breadcrumb')

// Auto-cleanup is not registered here (no jest-dom/testing-library setup file), so renders
// would otherwise accumulate across tests and every query would find duplicates.
afterEach(cleanup)

const route = (path: string, title?: string): AppRoute => ({ path, resourceRefId: path, title })

const renderAt = (pathname: string, routes: AppRoute[]) => {
  matchesRef.current = [{ pathname: '/' }, { pathname }]
  menuRoutesRef.current = routes
  return render(<Breadcrumb />)
}

describe('Breadcrumb — the section crumb links only where a list route exists', () => {
  it('links the section when the nav declares that list route', () => {
    renderAt('/compositions/demo/app', [route('/compositions', 'Compositions')])
    expect(screen.getByRole('link', { name: 'Compositions' }).getAttribute('href')).toBe('/compositions')
  })

  // The regression this test exists for. The nav declares only the six-segment
  // /resources/{namespace}/{group}/{version}/{plural}/{name} detail route — there is no
  // /resources list page — so linking the section crumb produced a 404 on every generic
  // resource page, which is a heavily used drill target from composition and incident tables.
  it('does NOT link the section when no such list route is declared', () => {
    renderAt('/resources/demo/apps/v1/deployments/web', [
      route('/resources/:namespace/:group/:version/:plural/:name'),
    ])
    expect(screen.queryByRole('link', { name: 'resources' })).toBeNull()
    expect(screen.getByTitle('resources')).toBeTruthy()
  })

  it('still links the namespace crumb on a composition detail route', () => {
    renderAt('/compositions/demo/app', [route('/compositions', 'Compositions')])
    expect(screen.getByRole('link', { name: 'demo' }).getAttribute('href')).toBe('/compositions/demo')
  })

  it('never links the leaf, even when a route of that name exists', () => {
    renderAt('/compositions', [route('/compositions', 'Compositions')])
    expect(screen.queryByRole('link')).toBeNull()
  })
})
