// @vitest-environment jsdom
/**
 * The 404 page (UX audit 404-1, 2026-11-25): in the dark theme its logo was the black mark on the
 * black page, and its link sent people to "the Home page", a name nothing else in the portal uses.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppRoute } from '../../context/RoutesContext'

let mockMode: 'dark' | 'light' = 'light'
let mockMenuRoutes: AppRoute[] = []
vi.mock('../../context/ThemeModeContext', () => ({ useThemeModeOrLight: () => mockMode }))
vi.mock('../../context/RoutesContext', () => ({ useRoutesContext: () => ({ menuRoutes: mockMenuRoutes }) }))

const { default: Page404 } = await import('./Page404')

const renderAt = (mode: 'dark' | 'light', routes: AppRoute[] = [{ path: '/dashboard', resourceRefId: '', title: 'Dashboard' }]) => {
  mockMode = mode
  mockMenuRoutes = routes
  return render(<MemoryRouter><Page404 /></MemoryRouter>)
}

afterEach(cleanup)

describe('Page404', () => {
  it('draws the white mark on the dark page and the black mark on the light page', () => {
    renderAt('dark')
    expect(screen.getByRole('img').getAttribute('src')).toMatch(/logo_big\.svg/)
    cleanup()
    renderAt('light')
    expect(screen.getByRole('img').getAttribute('src')).toMatch(/logo_black\.png/)
  })

  it('names the page its link opens, the navigation\'s first, by its sidebar label', () => {
    renderAt('light')
    expect(screen.getByRole('link').textContent).toBe('Go to Dashboard')
  })

  it('with no label for that page, says so without inventing a name', () => {
    renderAt('light', [{ path: '/dashboard', resourceRefId: '' }])
    expect(screen.getByRole('link').textContent).toBe('Go to the first page')
  })
})
