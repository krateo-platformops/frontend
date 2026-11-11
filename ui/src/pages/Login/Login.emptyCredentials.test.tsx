// @vitest-environment jsdom
/**
 * A credential submit with an empty field says the fields are required — not "Wrong username or
 * password".
 *
 * The form's `required` rules stop such a submit before it reaches Login.tsx, so the branch cannot
 * be reached through the real form. AuthMethods is replaced here by a stub that hands Login.tsx an
 * empty submission, exactly as a form without those rules would, so the branch's own copy is what
 * gets tested.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Login from './Login'
import type { AuthModeType, FormType, LoginFormAlert, LoginFormType } from './Login.types'

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: { api: { AUTHN_API_BASE_URL: 'http://authn.test' } },
    isLoading: false,
  }),
}))

const toUrl = (input: RequestInfo | URL): string => (input instanceof Request ? input.url : String(input))

const BASIC: AuthModeType = { kind: 'basic', name: '', path: '/basic/login' }

// The stub also shows the alert Login.tsx hands it, as the real form does above its button.
vi.mock('./AuthMethods', () => ({
  default: ({ alert, onCredentialSubmit }: {
    alert?: LoginFormAlert
    onCredentialSubmit: (values: LoginFormType, kind: FormType, method: AuthModeType) => void
  }) => (
    <>
      <button onClick={() => { onCredentialSubmit({ password: '', username: 'ada' }, 'basic', BASIC) }} type='button'>
        Submit empty password
      </button>
      {alert && <div role='alert'>{`${alert.title} ${alert.text}`}</div>}
    </>
  ),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('Login with an empty field', () => {
  it('says a username and a password are required, and sends nothing', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      return Promise.resolve(toUrl(input).endsWith('/strategies')
        ? new Response(JSON.stringify([BASIC]), { status: 200 })
        : new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
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

    fireEvent.click(await screen.findByRole('button', { name: 'Submit empty password' }))

    const text = (await screen.findByRole('alert')).textContent ?? ''
    expect(text).toMatch(/A username and a password are both required\./)
    expect(text).not.toMatch(/wrong username or password/i)
    expect(fetchMock.mock.calls.filter(([input]) => !toUrl(input).endsWith('/strategies'))).toHaveLength(0)
  })
})
