// @vitest-environment jsdom
/**
 * The password form's failure notification shows the classified copy — and only that.
 *
 * WHY THIS FILE EXISTS. On this page the notification is the ONLY failure surface: there is no
 * <Result> to fall back on. Login.tsx classified authn's answer and handed it to useCatchError as
 * `message`, where the hook's status defaults met it. A 4xx got "Please check your input or
 * permissions." added underneath; a 500 had the classified text REPLACED by "The server hit an
 * unexpected error". So every classified 5xx — the case loginFailureCause was written for — told
 * the person nothing.
 *
 * This renders the REAL hook inside antd's <App>, because the defect lived in the hand-off between
 * the page and the hook, which neither half's own tests can see.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import Login from './Login'

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: { api: { AUTHN_API_BASE_URL: 'http://authn.test' } },
    isLoading: false,
  }),
}))

const LDAP = { kind: 'ldap', name: 'corp', path: '/ldap/login?name=corp' }

const statusBody = (reason: string) => JSON.stringify({ details: { causes: [{ message: 'human text', reason }] } })

const installFetchMock = (loginStatus: number, loginBody: string) => {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.endsWith('/strategies')) {
      return Promise.resolve(new Response(JSON.stringify([LDAP]), { status: 200 }))
    }
    return Promise.resolve(new Response(loginBody, { status: loginStatus }))
  }))
}

const signIn = async () => {
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
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'ada' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
  fireEvent.click(screen.getByRole('button', { name: /ldap sign in/i }))
  await waitFor(() => expect(document.querySelector('.ant-notification-notice')).not.toBeNull())
  return document.querySelector('.ant-notification-notice')?.textContent ?? ''
}

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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('Login failure notification', () => {
  it('a classified 5xx keeps its text, instead of "The server hit an unexpected error"', async () => {
    installFetchMock(500, statusBody('LDAPUnavailable'))
    const text = await signIn()

    expect(text).toMatch(/Sign-in unavailable/)
    expect(text).toMatch(/the platform could not check your credentials/i)
    expect(text).toMatch(/\(LDAPUnavailable\)/)
    expect(text).not.toMatch(/server hit an unexpected error/i)
    expect(text).not.toMatch(/unexpected condition/i)
  })

  it('a refused password says check them — once, with no "Please check your input" added', async () => {
    installFetchMock(403, statusBody('InvalidCredentials'))
    const text = await signIn()

    expect(text).toMatch(/Authentication error/)
    expect(text).toMatch(/Those credentials were not accepted\. Check them and try again\. \(InvalidCredentials\)/)
    expect(text).not.toMatch(/check your input/i)
  })
})
