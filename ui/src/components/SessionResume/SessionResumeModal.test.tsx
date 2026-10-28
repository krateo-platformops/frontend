// @vitest-environment jsdom
/**
 * Component tests for the in-place SessionResumeModal (Wave-1 session honesty).
 *
 * Drives the REAL sessionResume store (raiseSessionExpired → CustomEvent → modal) end to
 * end with a mocked authn backend. The modal reflects EVERY enabled strategy (shared with the
 * Login page via pages/Login/AuthMethods):
 *  - basic / ldap: submitting credentials stores the fresh K_user, ROTATES the module-level
 *    token cache, resolves the pending resume 'resumed', and invalidates the react-query cache
 *    so the page refetches in place;
 *  - wrong credentials keep the modal up with an inline error (no logout, no toast);
 *  - a social/OIDC strategy renders its branded redirect button alongside the form;
 *  - an EMPTY strategies list (nothing to authenticate with) falls back to the legacy forceLogout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getAccessToken, invalidateAccessTokenCache } from '../../utils/getAccessToken'
import { __resetSessionResume, isSessionResumePending, raiseSessionExpired } from '../../utils/sessionResume'

import SessionResumeModal from './SessionResumeModal'

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: { api: { AUTHN_API_BASE_URL: 'http://authn.test' } },
    isLoading: false,
  }),
}))

vi.mock('../../utils/logout', () => ({
  forceLogout: vi.fn(() => Promise.resolve()),
}))

const { forceLogout } = await import('../../utils/logout')

const BASIC_STRATEGY = { kind: 'basic', name: 'basic', path: '/basic/login' }
const LDAP_STRATEGY = { kind: 'ldap', name: 'ldap', path: '/ldap/login' }
const GITHUB_OIDC = {
  extensions: { authCodeURL: 'https://idp.test/authorize?client_id=x', redirectURL: 'http://localhost/auth' },
  graphics: { backgroundColor: '#24292e', displayName: 'Sign in with GitHub', icon: 'fa-github', textColor: '#ffffff' },
  kind: 'oidc',
  name: 'github',
  path: '/oidc/github',
}

const FRESH_LOGIN = {
  accessToken: 'fresh-token',
  data: null,
  groups: ['admins'],
  user: { avatarURL: '', displayName: 'Diego', username: 'diego' },
}

/** fetch stub routed by URL: /strategies discovery + any strategy's login GET. */
const installFetchMock = (opts: { loginStatus?: number; strategies?: unknown[] }) => {
  const { loginStatus = 200, strategies = [BASIC_STRATEGY] } = opts
  const toUrl = (input: RequestInfo | URL): string => {
    if (typeof input === 'string') { return input }
    return input instanceof URL ? input.href : input.url
  }
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = toUrl(input)
    if (url.endsWith('/strategies')) {
      return Promise.resolve(new Response(JSON.stringify(strategies), { status: 200 }))
    }
    // Any other URL is a strategy login GET (basic or ldap).
    return loginStatus === 200
      ? Promise.resolve(new Response(JSON.stringify(FRESH_LOGIN), { status: 200 }))
      : Promise.resolve(new Response('nope', { status: loginStatus, statusText: 'Unauthorized' }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

let queryClient: QueryClient

const renderModal = () => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    // The modal is mounted inside the Shell (inside the app Router); LoginForm renders a
    // <Link>, so the test needs a Router context too.
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <SessionResumeModal />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

/** Raise a (real) session-expired and let the modal open + discover strategies.
 * The outcome promise is returned WRAPPED so `await raiseAndOpen()` does not flatten
 * (and block on) the still-pending resume itself. */
const raiseAndOpen = async (): Promise<{ outcome: Promise<'logout' | 'resumed'> }> => {
  let outcome!: Promise<'logout' | 'resumed'>
  act(() => { outcome = raiseSessionExpired() })
  await act(async () => { await Promise.resolve() })
  return { outcome }
}

const submitCredentials = (username: string, password: string, buttonName = 'Sign In') => {
  // The session-expired surface is a full-viewport role=dialog overlay (not an .ant-modal card),
  // so query the inputs by the dialog role rather than the antd modal class.
  const [usernameInput, passwordInput] = Array.from(document.querySelectorAll<HTMLInputElement>('[role="dialog"] input'))
  fireEvent.change(usernameInput, { target: { value: username } })
  fireEvent.change(passwordInput, { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: buttonName }))
}

beforeAll(() => {
  // antd needs these browser APIs; jsdom has neither.
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
  globalThis.ResizeObserver = class {
    disconnect = noop
    observe = noop
    unobserve = noop
  }
})

beforeEach(() => {
  __resetSessionResume()
  invalidateAccessTokenCache()
  localStorage.clear()
  vi.mocked(forceLogout).mockClear()
})

afterEach(() => {
  // Unmount the previous root explicitly: a still-mounted SessionResumeModal from an
  // earlier test would ALSO answer the window event and duplicate every button query.
  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('SessionResumeModal — in-place resume (credential strategies)', () => {
  it('re-authenticates in place: fresh K_user, rotated token cache, resumed outcome, query invalidation', async () => {
    installFetchMock({ strategies: [BASIC_STRATEGY, GITHUB_OIDC] })

    // The pre-expiry session: the token cache is warm with the STALE token.
    localStorage.setItem('K_user', JSON.stringify({ ...FRESH_LOGIN, accessToken: 'stale-token' }))
    expect(getAccessToken()).toBe('stale-token')

    renderModal()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { outcome } = await raiseAndOpen()
    expect(await screen.findByText('Session expired')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy()
    })
    submitCredentials('diego', 'secret')

    await waitFor(() => { expect(isSessionResumePending()).toBe(false) })

    // Fresh session stored where Login puts it…
    const stored = JSON.parse(localStorage.getItem('K_user')!) as { accessToken: string }
    expect(stored.accessToken).toBe('fresh-token')
    // …and the module-level token cache was invalidated (no stale-token replay).
    expect(getAccessToken()).toBe('fresh-token')
    // The coalesced 401 raisers are resolved as resumed (no logout, no navigation)…
    await expect(outcome).resolves.toBe('resumed')
    expect(forceLogout).not.toHaveBeenCalled()
    // …and the react-query cache is invalidated so the page refetches in place.
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it('resumes an LDAP-only install in place (not just basic)', async () => {
    const fetchMock = installFetchMock({ strategies: [LDAP_STRATEGY] })
    renderModal()

    const { outcome } = await raiseAndOpen()
    // LDAP renders a credential form with its own button label.
    await waitFor(() => { expect(screen.getByRole('button', { name: 'LDAP Sign In' })).toBeTruthy() })
    submitCredentials('diego', 'secret', 'LDAP Sign In')

    await expect(outcome).resolves.toBe('resumed')
    // The in-place resume hit the LDAP strategy's path, not a hard-coded /basic/login.
    expect(fetchMock).toHaveBeenCalledWith('http://authn.test/ldap/login', expect.anything())
    expect(forceLogout).not.toHaveBeenCalled()
  })

  it('renders every enabled method: a credential form AND the social redirect button', async () => {
    installFetchMock({ strategies: [BASIC_STRATEGY, GITHUB_OIDC] })
    renderModal()

    await raiseAndOpen()
    // basic → username/password form…
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy() })
    // …and the social/OIDC strategy → its branded redirect button (the bug: it used to be hidden).
    expect(screen.getByRole('button', { name: /Sign in with GitHub/ })).toBeTruthy()
  })

  it('shows a single "or continue with" divider between stacked credential forms and social', async () => {
    installFetchMock({ strategies: [BASIC_STRATEGY, LDAP_STRATEGY, GITHUB_OIDC] })
    renderModal()

    await raiseAndOpen()
    await waitFor(() => { expect(screen.getByRole('button', { name: /Sign in with GitHub/ })).toBeTruthy() })
    // Exactly one divider — between the ldap form and the github button, NOT between basic and ldap.
    expect(screen.getAllByText('or continue with')).toHaveLength(1)
  })

  it('wrong credentials keep the modal open with an inline error (still pending)', async () => {
    installFetchMock({ loginStatus: 401 })
    renderModal()

    await raiseAndOpen()
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy() })
    submitCredentials('diego', 'wrong')

    expect(await screen.findByText('Wrong username or password, try again.')).toBeTruthy()
    expect(isSessionResumePending()).toBe(true)
    expect(forceLogout).not.toHaveBeenCalled()
  })
})

describe('SessionResumeModal — documented fallbacks', () => {
  it('an install with NO strategies falls back to the legacy forceLogout flow', async () => {
    installFetchMock({ strategies: [] })
    renderModal()

    const { outcome } = await raiseAndOpen()

    await waitFor(() => { expect(forceLogout).toHaveBeenCalledTimes(1) })
    await expect(outcome).resolves.toBe('logout')
    expect(isSessionResumePending()).toBe(false)
  })

  it('the explicit Log out button hard-wipes via forceLogout(force)', async () => {
    installFetchMock({})
    renderModal()

    const { outcome } = await raiseAndOpen()
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    await expect(outcome).resolves.toBe('logout')
    expect(forceLogout).toHaveBeenCalledWith('/login', { force: true })
  })
})
