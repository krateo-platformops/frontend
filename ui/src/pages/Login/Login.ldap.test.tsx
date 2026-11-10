// @vitest-environment jsdom
/**
 * An LDAP sign-in names the LDAPConfig it is for — the one whose form was submitted.
 *
 * WHY THIS FILE EXISTS. authn's /strategies describes an LDAP method as `path: "/ldap/login"` with
 * the config's name in a SEPARATE `name` field (authn strategies.go, `forLDAP`), and `/ldap/login`
 * answers 400 MissingConfigName to a request without `?name=` (ldap/login.go:97-99, authn 0.40.0).
 * Login.tsx sent `${base}${path}` and nothing else, so every LDAP sign-in from the portal was refused
 * before authn read the credentials. It went unseen because the install it was tested on serves
 * basic only, and because the earlier test fixture invented a path with the name already in it.
 *
 * So the fetch stub below answers as authn does — refusing a nameless LDAP request with exactly
 * MissingConfigName — and the fixtures use the shape authn really sends.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import Login from './Login'

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: { api: { AUTHN_API_BASE_URL: 'http://authn.test' } },
    isLoading: false,
  }),
}))

const graphics = (displayName: string) => ({ backgroundColor: '#fff', displayName, icon: 'fa-user', textColor: '#000' })

// authn's real /strategies shape: a bare `path`, the config name separate.
const CORP = { graphics: graphics('Corp directory'), kind: 'ldap', name: 'corp', path: '/ldap/login' }
// A name that needs encoding: raw, `&` would cut it to `partners` and `%` would start an escape.
const PARTNERS = { graphics: graphics('Partner directory'), kind: 'ldap', name: 'partners&eu%2', path: '/ldap/login' }
const BASIC = { kind: 'basic', path: '/basic/login' }

const toUrl = (input: RequestInfo | URL): string => (input instanceof Request ? input.url : String(input))

/** What the stub answered each credential request with: the config it named, and the cause if refused. */
let answered: { cause: string | null; name: string | null; url: string }[] = []

const installAuthn = (strategies: unknown[], configs: string[]) => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = toUrl(input)
    if (url.endsWith('/strategies')) {
      return Promise.resolve(new Response(JSON.stringify(strategies), { status: 200 }))
    }
    const parsed = new URL(url)
    const name = parsed.searchParams.get('name')
    const refuse = (status: number, cause: string) => {
      answered.push({ cause, name, url })
      return Promise.resolve(new Response(JSON.stringify({ code: status, details: { causes: [{ reason: cause }] }, kind: 'Status' }), { status }))
    }
    if (parsed.pathname === '/ldap/login') {
      if (!name) { return refuse(400, 'MissingConfigName') }
      if (!configs.includes(name)) { return refuse(404, 'LDAPConfigNotFound') }
    }
    answered.push({ cause: null, name, url })
    return Promise.resolve(new Response(JSON.stringify({ accessToken: 't', user: { username: 'ada' } }), { status: 200 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const renderLogin = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <App>
      <MemoryRouter initialEntries={['/login']}>
        <QueryClientProvider client={queryClient}>
          <Login />
        </QueryClientProvider>
      </MemoryRouter>
    </App>
  )
}

/*
 * Fill and submit the form whose button says `button`. Each credential strategy gets its own form,
 * so the inputs are found inside the clicked button's form, not by label: two forms share the
 * labels "Username" and "Password".
 */
const submitThrough = async (button: string) => {
  const submit = await screen.findByRole('button', { name: button })
  const form = submit.closest('form')!
  fireEvent.change(form.querySelector('input:not([type=password])')!, { target: { value: 'ada' } })
  fireEvent.change(form.querySelector('input[type=password]')!, { target: { value: 'pw' } })
  fireEvent.click(submit)
}

beforeAll(() => {
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

beforeEach(() => {
  answered = []
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('LDAP sign-in names its LDAPConfig', () => {
  it('a single LDAP strategy signs in with ?name= — authn does not refuse it with MissingConfigName', async () => {
    installAuthn([CORP], ['corp'])
    renderLogin()
    await submitThrough('Corp directory')

    await waitFor(() => expect(answered).toHaveLength(1))
    // The cause authn answered with. Built as `${base}${path}`, this is 'MissingConfigName'.
    expect(answered[0].cause).toBeNull()
    expect(answered[0].name).toBe('corp')
    await waitFor(() => expect(localStorage.getItem('K_user')).not.toBeNull())
  })

  it('with two LDAPConfigs, the form the person used decides which one — and its name is encoded', async () => {
    installAuthn([CORP, PARTNERS], ['corp', 'partners&eu%2'])
    renderLogin()
    await submitThrough('Partner directory')

    await waitFor(() => expect(answered).toHaveLength(1))
    expect(answered[0].cause).toBeNull()
    // Not `corp` — the first of kind ldap, which is what re-finding the method by kind picked.
    expect(answered[0].name).toBe('partners&eu%2')
    const parsed = new URL(answered[0].url)
    expect(parsed.pathname).toBe('/ldap/login')
    expect([...parsed.searchParams.keys()]).toEqual(['name'])
  })

  it('basic is unchanged: its bare path, no name', async () => {
    installAuthn([BASIC], [])
    renderLogin()
    await submitThrough('Sign In')

    await waitFor(() => expect(answered).toHaveLength(1))
    expect(answered[0].url).toBe('http://authn.test/basic/login')
  })

  it('an LDAP strategy with no name is a configuration fault: platform-fault copy, nothing sent', async () => {
    installAuthn([{ ...CORP, name: '' }], ['corp'])
    renderLogin()
    await submitThrough('Corp directory')

    await waitFor(() => expect(document.querySelector('.ant-notification-notice')).not.toBeNull())
    const text = document.querySelector('.ant-notification-notice')?.textContent ?? ''
    expect(text).toMatch(/Sign-in unavailable/)
    expect(text).toMatch(/retrying will not help/i)
    expect(text).toMatch(/\(LdapStrategyWithoutName\)/)
    expect(text).not.toMatch(/wrong username or password/i)
    expect(answered).toHaveLength(0)
  })
})
