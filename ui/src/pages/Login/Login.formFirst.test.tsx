// @vitest-environment jsdom
/**
 * The form-first sign-in card (2026-11 redesign): what it shows by default, what config adds, and
 * how a refused password is handled.
 *
 * - No marketing copy unless an install sets some; then one short paragraph.
 * - "to Krateo PlatformOps", followed by the installation's name when `login.installationName` is set.
 * - The fields say what they are to a password manager (`username`, `current-password`).
 * - authn refusing the credentials is an inline Alert above the button, not a toast: the username
 *   stays, the password is emptied and focused, and authn's cause is shown for support.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '../../context/ConfigContext'

import Login from './Login'

const branding = vi.hoisted(() => ({ login: undefined as Config['login'] }))

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: { api: { AUTHN_API_BASE_URL: 'http://authn.test' }, login: branding.login },
    isLoading: false,
  }),
}))

const BASIC = { kind: 'basic', path: '/basic/login' }
const refused = JSON.stringify({ code: 403, details: { causes: [{ message: 'invalid credentials', reason: 'InvalidCredentials' }] }, kind: 'Status' })

const toUrl = (input: RequestInfo | URL): string => (input instanceof Request ? input.url : String(input))

const installAuthn = () => {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => Promise.resolve(toUrl(input).endsWith('/strategies')
    ? new Response(JSON.stringify([BASIC]), { status: 200 })
    : new Response(refused, { status: 403 }))))
}

const renderLogin = async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <App>
      <MemoryRouter initialEntries={['/login']}>
        <QueryClientProvider client={queryClient}>
          <Login />
        </QueryClientProvider>
      </MemoryRouter>
    </App>
  )
  await screen.findByLabelText('Username')
  return view
}

/** The page's own paragraphs, in order — the heading's line, the pitch, the request-access line. */
const paragraphs = (container: HTMLElement) => [...container.querySelectorAll('main p')].map((paragraph) => paragraph.textContent)

beforeAll(() => {
  // antd's responsive observer (Form's grid) needs matchMedia; jsdom has none.
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
})

beforeEach(() => {
  branding.login = undefined
  installAuthn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  localStorage.clear()
})

describe('the sign-in card by default', () => {
  it('has a heading and the product line, and no marketing copy at all', async () => {
    const { container } = await renderLogin()

    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
    // Just the product line: no pitch, and no request-access line (unset).
    expect(paragraphs(container)).toEqual(['to Krateo PlatformOps'])
    // The copy the page used to ship as its default.
    expect(container.textContent).not.toMatch(/YAML toil|Self-service infrastructure|GitOps reconciliation/)
  })

  it('names the installation when login.installationName is set', async () => {
    branding.login = { installationName: 'krateo-057' }
    const { container } = await renderLogin()

    expect(paragraphs(container)).toEqual(['to Krateo PlatformOps · krateo-057'])
  })

  it('shows marketing copy only when an install sets it, as one paragraph', async () => {
    branding.login = { headline: 'Acme platform.', highlights: ['Fast', 'Safe'], subtitle: 'Ask the platform team.' }
    const { container } = await renderLogin()

    expect(paragraphs(container)).toEqual(['to Krateo PlatformOps', 'Acme platform. Ask the platform team. Fast · Safe'])
  })

  it('offers "Request an account" only when login.requestAccountUrl is set', async () => {
    branding.login = { requestAccountUrl: 'https://example.com/access' }
    await renderLogin()

    expect(screen.getByRole('link', { name: 'Request an account' }).getAttribute('href')).toBe('https://example.com/access')
  })
})

describe('the credential fields', () => {
  it('tell a password manager what they hold, and the form does not switch autocomplete off', async () => {
    const { container } = await renderLogin()

    expect(screen.getByLabelText('Username').getAttribute('autocomplete')).toBe('username')
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('current-password')
    expect(container.querySelector('form')?.getAttribute('autocomplete')).toBeNull()
  })
})

describe('a refused password', () => {
  const signIn = (password: string) => {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  }

  it('is explained above the button, keeps the username, and empties and focuses the password', async () => {
    await renderLogin()
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ada' } })
    signIn('not-it')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Wrong username or password.Check both and try again. InvalidCredentials')
    // authn's cause, as its own small element.
    expect(alert.querySelector('code')?.textContent).toBe('InvalidCredentials')
    // Above the button, inside the form that was submitted.
    const button = screen.getByRole('button', { name: 'Sign in' })
    expect(alert.closest('form')).toBe(button.closest('form'))
    expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // No toast beside it.
    expect(document.querySelector('.ant-notification-notice')).toBeNull()

    expect(screen.getByLabelText<HTMLInputElement>('Username').value).toBe('ada')
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Password').value).toBe(''))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Password')))
  })

  it('is handled again on a second refusal: the password is emptied each time', async () => {
    await renderLogin()
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ada' } })
    signIn('first')
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Password').value).toBe(''))

    signIn('second')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' }).closest('form')?.querySelector('[role=alert]')).toBeTruthy())
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Password').value).toBe(''))
    expect(screen.getByLabelText<HTMLInputElement>('Username').value).toBe('ada')
  })
})
