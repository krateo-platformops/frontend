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

const toUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') { return input }
  return input instanceof URL ? input.href : input.url
}

const installFetchMock = (loginStatus: number, loginBody: string) => {
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
const renderCallback = (entry = '/auth?code=the-code&kind=oidc') => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>
        <Auth />
      </QueryClientProvider>
    </MemoryRouter>
  )
  return queryClient
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

  it('a missing PKCE verifier offers to start again, without saying a code was refused', async () => {
    installFetchMock(400, statusBody('MissingCodeVerifier'))
    renderCallback()

    await waitFor(() => expect(screen.getByRole('link', { name: /start the sign-in again/i })).toBeTruthy())
    expect(screen.getByText(/could not be finished in this browser/i)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/was refused/i)
    expect(document.body.textContent).not.toMatch(/sign-in unavailable/i)
  })

  it('a request the portal could not make right says retrying will not help — not "retry shortly"', async () => {
    // MissingAuthorizationCode is unreachable from a normal callback: Auth.tsx exchanges only with a
    // non-empty ?code=. Arriving here means something between the browser and authn dropped the
    // header, and the next attempt meets the same thing.
    installFetchMock(400, statusBody('MissingAuthorizationCode'))
    renderCallback()

    await waitFor(() => expect(screen.getByText(/retrying will not help/i)).toBeTruthy())
    expect(screen.getByText('Sign-in unavailable')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/retry shortly/i)
  })

  it('the notification for a refusal carries the page\'s title and classified text, and nothing else', async () => {
    installFetchMock(403, statusBody('GroupNotAllowed'))
    renderCallback()

    await waitFor(() => expect(screen.getByText('Access not granted')).toBeTruthy())
    expect(catchError).toHaveBeenCalledTimes(1)
    const [{ description, message, status }] = catchError.mock.calls[0] as [{ description: string; message: string; status: number }]
    expect(message).toBe('Access not granted')
    expect(description).toBe('Your identity provider signed you in, but your account is not allowed into '
      + 'this control plane. Ask its owner to give you access. (GroupNotAllowed)')
    expect(status).toBe(403)
  })

  it("authn's own failure reads as unavailable, not as the person's fault", async () => {
    installFetchMock(500, statusBody('TokenExchangeFailed'))
    renderCallback()

    await waitFor(() => expect(screen.getByText(/sign-in unavailable/i)).toBeTruthy())
    expect(screen.getByText(/not a problem with what you typed/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /return to the login page/i })).toBeTruthy()
  })

  it('a person outside allowedGroups is told to ask for access, under its own title — not "Sign-in unavailable"', async () => {
    // The reported defect, end to end: authn 0.36.0 answered /oidc/login with 403 GroupNotAllowed
    // and this page titled it "Sign-in unavailable" with copy saying the credentials could not be
    // checked and to retry shortly. The classifier's own test cannot see the title — only this can.
    installFetchMock(403, statusBody('GroupNotAllowed'))
    renderCallback()

    await waitFor(() => expect(screen.getByText('Access not granted')).toBeTruthy())
    expect(screen.getByText(/not allowed into this control plane/i)).toBeTruthy()
    expect(screen.getByText(/ask its owner/i)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/sign-in unavailable/i)
    expect(document.body.textContent).not.toMatch(/could not check your credentials/i)
    expect(document.body.textContent).not.toMatch(/retry/i)
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
    // The notification carries the Result's title, and the same classified text with authn's cause
    // appended for support — as its OWN description, so useCatchError adds none of its defaults.
    expect(catchError).toHaveBeenCalled()
    const [{ description, message }] = catchError.mock.calls[0] as [{ description: string; message: string }]
    expect(message).toBe('Sign-in not completed')
    expect(description).toMatch(/the code from your identity provider was refused/i)
    expect(description).toMatch(/\(AuthorizationCodeRejected\)$/)
    expect(`${message} ${description}`).not.toMatch(/Login error \(403/)
  })

  it('a body that is not authn\'s shape still explains itself rather than throwing', async () => {
    // A proxy answering the callback with HTML. The classifier takes `unknown` and never throws;
    // on a redirect flow a 4xx with no cause escalates.
    installFetchMock(403, '<html>403 Forbidden</html>')
    renderCallback()

    await waitFor(() => expect(screen.getByText(/not a problem with what you typed/i)).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/check them and try again/i)
  })

  // THE CALLBACK THAT CARRIES NO CODE. It used to spin on "Authentication in progress..." forever.

  it('a cancelled consent (?error=access_denied) stops spinning, says so plainly, and offers to start again', async () => {
    const fetchMock = installFetchMock(200, '{}')
    localStorage.setItem('KrateoSL', 'the-state')
    localStorage.setItem('KrateoSLV', 'the-verifier')
    renderCallback('/auth?error=access_denied&error_description=User%20cancelled&state=the-state&kind=oidc')

    await waitFor(() => expect(screen.getByText('Sign-in not completed')).toBeTruthy())
    expect(screen.getByText(/cancelled or declined at your identity provider/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /start the sign-in again/i })).toBeTruthy()
    expect(screen.queryByText(/authentication in progress/i)).toBeNull()
    expect(document.body.textContent).not.toMatch(/sign-in unavailable|platform/i)
    // The attempt is over: its state and verifier are spent, so no later callback can present them.
    expect(localStorage.getItem('KrateoSL')).toBeNull()
    expect(localStorage.getItem('KrateoSLV')).toBeNull()
    // Nothing was exchanged — there was no code — and no error toast for pressing Cancel.
    expect(fetchMock.mock.calls.some(([input]) => toUrl(input).includes('/oidc/'))).toBe(false)
    expect(catchError).not.toHaveBeenCalled()
  })

  it('the IdP\'s error_description is never rendered — not as markup, not as text', async () => {
    // Free text from the URL: any link can write it. Rendering it would let a sender print a message
    // of their choosing on the portal's own origin.
    installFetchMock(200, '{}')
    const hostile = '<b>Your account is locked. Call 555-0100</b>'
    renderCallback(`/auth?error=access_denied&error_description=${encodeURIComponent(hostile)}&kind=oidc`)

    await waitFor(() => expect(screen.getByText('Sign-in not completed')).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/555-0100|account is locked/i)
    expect(document.body.querySelector('b')).toBeNull()
  })

  it('a refused request (?error=invalid_scope) is configuration: tell an administrator, no retry', async () => {
    installFetchMock(200, '{}')
    renderCallback('/auth?error=invalid_scope&kind=oidc')

    await waitFor(() => expect(screen.getByText('Sign-in unavailable')).toBeTruthy())
    expect(screen.getByText(/retrying will not help/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /return to the login page/i })).toBeTruthy()
  })

  it('an IdP that is temporarily unavailable gets "start again in a moment"', async () => {
    installFetchMock(200, '{}')
    renderCallback('/auth?error=temporarily_unavailable&kind=oidc')

    await waitFor(() => expect(screen.getByRole('link', { name: /start the sign-in again/i })).toBeTruthy())
    expect(screen.getByText(/start the sign-in again in a moment/i)).toBeTruthy()
  })

  it('/auth opened with no code and no error stops spinning and says there is nothing to finish', async () => {
    installFetchMock(200, '{}')
    renderCallback('/auth')

    await waitFor(() => expect(screen.getByText(/no sign-in to finish here/i)).toBeTruthy())
    expect(screen.queryByText(/authentication in progress/i)).toBeNull()
  })

  // THE CALLBACK CARRYING A CODE THE PAGE WILL NOT EXCHANGE. Both used to spin forever.

  it('a state mismatch is refused without exchanging the code, says start again, and spends the stored state', async () => {
    // An older tab finishing after a newer attempt replaced the state, or a callback link opened
    // twice: the callback cannot be tied to a sign-in this browser started.
    const fetchMock = installFetchMock(200, '{}')
    localStorage.setItem('KrateoSL', 'the-state-this-browser-sent')
    localStorage.setItem('KrateoSLV', 'the-verifier')
    renderCallback('/auth?code=the-code&state=some-other-state&kind=oidc')

    await waitFor(() => expect(screen.getByText('Sign-in not completed')).toBeTruthy())
    expect(screen.getByText(/does not belong to a sign-in started in this browser/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /start the sign-in again/i })).toBeTruthy()
    expect(screen.queryByText(/authentication in progress/i)).toBeNull()
    expect(localStorage.getItem('KrateoSL')).toBeNull()
    expect(localStorage.getItem('KrateoSLV')).toBeNull()
    expect(catchError).not.toHaveBeenCalled()
    // Give any re-run of the effect its chance: with the state now spent, a second pass must still
    // not fall into the unvalidated branch and exchange the code it just refused.
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(fetchMock.mock.calls.some(([input]) => toUrl(input).includes('/oidc/'))).toBe(false)
  })

  it('a refused code stays refused when /strategies refetches and the effect runs again', async () => {
    // The first run spends the stored state and refuses the mismatch. Anything that re-runs the
    // effect afterwards — here a /strategies refetch that returns a changed list, as a focus refetch
    // can — finds NO state, and without a once-only guard would take the unvalidated branch and
    // exchange the very code it just refused.
    const fetchMock = installFetchMock(200, '{}')
    localStorage.setItem('KrateoSL', 'the-state-this-browser-sent')
    const queryClient = renderCallback('/auth?code=the-code&state=some-other-state&kind=oidc')

    await waitFor(() => expect(screen.getByText('Sign-in not completed')).toBeTruthy())
    fetchMock.mockImplementation((input: RequestInfo | URL) => Promise.resolve(toUrl(input).endsWith('/strategies')
      ? new Response(JSON.stringify([GITHUB_OIDC, { ...GITHUB_OIDC, name: 'another' }]), { status: 200 })
      : new Response('{}', { status: 200 })))
    await queryClient.refetchQueries()
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(fetchMock.mock.calls.filter(([input]) => toUrl(input).endsWith('/strategies')).length).toBeGreaterThan(1)
    expect(fetchMock.mock.calls.some(([input]) => toUrl(input).includes('/oidc/'))).toBe(false)
  })

  it('a code with no matching strategy escalates with the platform-fault copy and its cause', async () => {
    // /strategies offers only an oidc method; the callback says oauth.
    const fetchMock = installFetchMock(200, '{}')
    renderCallback('/auth?code=the-code&kind=oauth')

    await waitFor(() => expect(screen.getByText('Sign-in unavailable')).toBeTruthy())
    expect(screen.getByText(/retrying will not help/i)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/retry shortly/i)
    expect(screen.queryByText(/authentication in progress/i)).toBeNull()
    expect(catchError).toHaveBeenCalledTimes(1)
    const [{ description, message }] = catchError.mock.calls[0] as [{ description: string; message: string }]
    expect(message).toBe('Sign-in unavailable')
    expect(description).toMatch(/\(NoMatchingStrategy\)$/)
    expect(fetchMock.mock.calls.some(([input]) => /\/(oidc|oauth)\//.test(toUrl(input)))).toBe(false)
  })

  it('an expired ID token (TokenExpired) offers to start again, and names the clocks if it repeats', async () => {
    installFetchMock(403, statusBody('TokenExpired'))
    renderCallback()

    await waitFor(() => expect(screen.getByRole('link', { name: /start the sign-in again/i })).toBeTruthy())
    expect(screen.getByText('Sign-in not completed')).toBeTruthy()
    expect(screen.getByText(/clocks of this platform and your identity provider disagree/i)).toBeTruthy()
  })
})
