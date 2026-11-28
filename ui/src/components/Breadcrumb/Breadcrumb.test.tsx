// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

const { default: Breadcrumb, splitLeaf } = await import('./Breadcrumb')
const { default: styles } = await import('./Breadcrumb.module.css')

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
    renderAt('/compositions/demo', [route('/compositions', 'Compositions'), route('/compositions/demo')])
    expect(screen.queryByRole('link', { name: 'demo' })).toBeNull()
    expect(screen.getByTitle('demo')).toBeTruthy()
  })
})

// BC-1 (UX audit, 2026-11-25).
describe('Breadcrumb — names as they are, cut in the middle, none on a first-level page', () => {
  it('draws nothing on a first-level page, where it only repeated the title, wrapper included', () => {
    const { container } = renderAt('/compositions', [route('/compositions', 'Compositions')])
    expect(container.innerHTML).toBe('')
  })

  it('only the section crumb is the upper-case eyebrow; route words and names keep their case', () => {
    renderAt('/reviews/runs/rr-20261124-0200', [route('/reviews', 'Platform review')])
    expect(screen.getByTitle('Platform review').classList.contains(styles.section)).toBe(true)
    expect(screen.getByTitle('runs').classList.contains(styles.section)).toBe(false)
    expect(screen.getByTitle('rr-20261124-0200').classList.contains(styles.section)).toBe(false)
    const css = readFileSync(join(__dirname, 'Breadcrumb.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const transforms = [...css.matchAll(/([^{};]+)\{[^{}]*text-transform:\s*uppercase/g)].map((match) => match[1].trim())
    expect(transforms).toEqual(['&.section'])
  })

  it('a long name is drawn as a head that shortens and a tail that stays, the whole name its title', () => {
    const name = 'sre-certificate-expiry-warning-20261123-1'
    renderAt(`/incidents/krateo-system/${name}`, [route('/incidents', 'Incidents')])
    const leaf = screen.getByTitle(name)
    expect(leaf.querySelector(`.${styles.leafHead}`)?.textContent).toBe('sre-certificate-expiry-warning')
    expect(leaf.querySelector(`.${styles.leafTail}`)?.textContent).toBe('-20261123-1')
    expect(leaf.textContent).toBe(name)
  })

  it('splits at a separator within the end when there is one, by length when not, and not at all when short', () => {
    expect(splitLeaf('event-feedback-form')).toBeUndefined()
    expect(splitLeaf('4bf92f3577b34da6a3ce929d0e0e4736')).toEqual(['4bf92f3577b34da6a3', 'ce929d0e0e4736'])
    expect(splitLeaf('acmefeedbacks-v0-1-0-controller-manager')).toEqual(['acmefeedbacks-v0-1-0-controller', '-manager'])
  })
})
