// @vitest-environment jsdom
/**
 * The oidc/oauth callback must explain its failures, and must NOT explain them as a password
 * problem.
 *
 * WHY THIS FILE EXISTS. `Auth.tsx` printed `Login error (${status}: ${statusText})` and a fixed
 * subtitle — "There seems to be an authentication problem using this method" — for every failure.
 * That is the same defect `loginFailureCause` was written to remove from `Login.tsx`, left in place
 * here because before authn 0.35.0 these routes answered 417/500 with no cause and there was
 * nothing to classify.
 *
 * THE ASSERTION THAT MATTERS is the unknown-4xx case. `loginFailureCauseOf` takes the flow, and the
 * whole point of that argument is that a 4xx means "you typed it wrong" on a password form and
 * never on a redirect. A unit test of the classifier cannot prove `Auth.tsx` passes `'redirect'`;
 * only rendering it can. If someone changes that argument to `'password'`, the classifier's own
 * tests all still pass and this is the file that fails.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Auth from './Auth'

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: { api: { AUTHN_API_BASE_URL: 'http://authn.test' } },
    isLoading: false,
  }),
}))

const catchError = vi.fn()
vi.mock('../../hooks/useCatchError', () => ({
  default: () => ({ catchError }),
}))

/*
 * `redirectURL` must carry the window's protocol: Auth.tsx selects the strategy with
 * `el.extensions.redirectURL.indexOf(window.location.protocol) > -1`, and jsdom serves `http:`.
 */
const GITHUB_OIDC = {
  extensions: { authCodeURL: 'https://idp.test/authorize?client_id=x', redirectURL: 'http://localhost/auth' },
  kind: 'oidc',
  name: 'github',
  path: '/oidc/github',
}

/** authn's failure body: a Kubernetes Status with the cause in details.causes[0].reason. */
const statusBody = (reason: string) => JSON.stringify({ details: { causes: [{ message: 'human text', reason }] } })

const installFetchMock = (loginStatus: number, loginBody: string) => {
  const toUrl = (input: RequestInfo | URL): string => {
    if (typeof input === 'string') { return input }
    return input instanceof URL ? input.href : input.url
  }
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = toUrl(input)
    if (url.endsWith('/strategies')) {
      return Promise.resolve(new Response(JSON.stringify([GITHUB_OIDC]), { status: 200 }))
    }
    return Promise.resolve(new Response(loginBody, { status: loginStatus, statusText: 'Forbidden' }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/*
 * No stored social-login state, so Auth takes its `else if (code && methodData)` branch and
 * exchanges the code — which is the path under test. `state` is deliberately absent.
 */
const renderCallback = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={['/auth?code=the-code&kind=oidc']}>
      <QueryClientProvider client={queryClient}>
        <Auth />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  catchError.mockClear()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Auth callback failures', () => {
  it('a rejected authorization code says start over, and offers that as the action', async () => {
    installFetchMock(403, statusBody('AuthorizationCodeRejected'))
    renderCallback()

    // The copy appears twice on purpose — in the subtitle and as the link's label — so each is
    // asserted by role rather than by text, which would match both.
    await waitFor(() => expect(screen.getByRole('link', { name: /start the sign-in again/i })).toBeTruthy())
    expect(screen.getByText(/the code from your identity provider was refused/i)).toBeTruthy()
    // Nothing was typed, so nothing may be presented as a credential to check.
    expect(screen.queryByText(/check them and try again/i)).toBeNull()
    expect(document.body.textContent).not.toMatch(/credentials were not accepted/i)
  })

  it("authn's own failure reads as unavailable, not as the person's fault", async () => {
    installFetchMock(500, statusBody('TokenExchangeFailed'))
    renderCallback()

    await waitFor(() => expect(screen.getByText(/sign-in unavailable/i)).toBeTruthy())
    expect(screen.getByText(/not a problem with what you typed/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /return to the login page/i })).toBeTruthy()
  })

  it('an UNKNOWN 4xx cause does not become "check your password" — this is what proves the redirect flow is passed', async () => {
    // A cause newer than our classifier, on a 403. Read as a password form this falls through to
    // retype; read as a redirect it escalates. Auth.tsx must produce the second.
    installFetchMock(403, statusBody('SomeCauseAddedIn2028'))
    renderCallback()

    await waitFor(() => expect(screen.getByText(/not a problem with what you typed/i)).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/check them and try again/i)
    expect(document.body.textContent).not.toMatch(/credentials were not accepted/i)
  })

  it('never shows the raw status line that this change replaced', async () => {
    installFetchMock(403, statusBody('AuthorizationCodeRejected'))
    renderCallback()

    await waitFor(() => expect(screen.getByRole('link', { name: /start the sign-in again/i })).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/Login error \(403/)
    // The notification carries the same classified text, with authn's cause appended for support.
    expect(catchError).toHaveBeenCalled()
    const [{ message }] = catchError.mock.calls[0] as [{ message: string }]
    expect(message).toMatch(/AuthorizationCodeRejected/)
    expect(message).not.toMatch(/Login error \(403/)
  })

  it('a body that is not authn\'s shape still explains itself rather than throwing', async () => {
    // A proxy answering the callback with HTML. The classifier takes `unknown` and never throws;
    // on a redirect flow a 4xx with no cause escalates.
    installFetchMock(403, '<html>403 Forbidden</html>')
    renderCallback()

    await waitFor(() => expect(screen.getByText(/not a problem with what you typed/i)).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/check them and try again/i)
  })
})
