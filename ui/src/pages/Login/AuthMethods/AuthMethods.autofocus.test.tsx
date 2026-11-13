// @vitest-environment jsdom
/**
 * The sign-in page puts the cursor in Username (#652).
 *
 * The page exists to type into that field, and reaching it took a Tab or a click. Only the FIRST
 * credential form asks for focus: with basic and LDAP stacked, two requests would leave the cursor
 * in whichever form mounted last, and a social method listed first has no field to fill, so the
 * credential form after it still gets the cursor.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { AuthModeType } from '../Login.types'

import AuthMethods from './AuthMethods'

// SocialLogin reads the authn base URL to build its redirect.
vi.mock('../../../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: { api: { AUTHN_API_BASE_URL: 'http://authn.test' } },
    isLoading: false,
  }),
}))

const graphics = (displayName: string) => ({ backgroundColor: '#fff', displayName, icon: 'fa-user', textColor: '#000' })

const BASIC: AuthModeType = { kind: 'basic', name: 'basic', path: '/basic/login' }
const CORP: AuthModeType = { graphics: graphics('Corp directory'), kind: 'ldap', name: 'corp', path: '/ldap/login' }
const GITHUB: AuthModeType = { graphics: graphics('GitHub'), kind: 'github', name: 'github', path: '/github/login' }

const renderMethods = (methods: AuthModeType[]) => render(
  <MemoryRouter>
    <AuthMethods isLoading={false} methods={methods} onCredentialSubmit={() => undefined} />
  </MemoryRouter>,
)

describe('AuthMethods — the cursor starts in Username (#652)', () => {
  beforeAll(() => {
    // antd's responsive observer (Form's grid) needs matchMedia; jsdom has none.
    const noop = () => undefined
    Object.defineProperty(window, 'matchMedia', {
      value: (query: string) => ({
        addEventListener: noop,
        addListener: noop,
        dispatchEvent: () => false,
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: noop,
        removeListener: noop,
      }),
      writable: true,
    })
  })

  afterEach(() => { cleanup() })

  it('focuses the Username field of a single basic form', () => {
    renderMethods([BASIC])
    expect(document.activeElement).toBe(screen.getByLabelText('Username'))
  })

  it('focuses the FIRST credential form when basic and LDAP are stacked', () => {
    const { container } = renderMethods([BASIC, CORP])
    const [first, second] = container.querySelectorAll<HTMLInputElement>('input[autocomplete="username"]')
    expect(document.activeElement).toBe(first)
    expect(document.activeElement).not.toBe(second)
  })

  it('skips a social method listed first and focuses the credential form after it', () => {
    const { container } = renderMethods([GITHUB, CORP])
    expect(document.activeElement).toBe(container.querySelector('input[autocomplete="username"]'))
  })
})
