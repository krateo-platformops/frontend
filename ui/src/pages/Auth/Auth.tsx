import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Result, Space, Spin, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { useConfigContext } from '../../context/ConfigContext'
import useCatchError from '../../hooks/useCatchError'
import { invalidateAccessTokenCache } from '../../utils/getAccessToken'
import type { LoginFailureCause } from '../../utils/loginFailureCause'
import {
  CALLBACK_NO_STRATEGY,
  CALLBACK_STATE_MISMATCH,
  callbackFailureOf,
  LOGIN_FAILURE_TITLE,
  loginFailureCauseOf,
  strategiesFailureOf,
} from '../../utils/loginFailureCause'
import { resolveNextPath, SESSION_RESUME_NEXT_KEY } from '../../utils/nextPath'
import { fetchStrategies, strategiesFailureFrom } from '../../utils/strategies'
import type { AuthModeType, AuthRequestType, AuthResponseType } from '../Login/Login.types'
import { takeSocialLoginState, takeSocialLoginVerifier } from '../Login/SocialLogin/SocialLogin'
import StartSignInAgain from '../Login/StartSignInAgain'

const Auth = () => {
  const navigate = useNavigate()
  const { catchError } = useCatchError()

  const [searchParams] = useSearchParams()
  const [showError, setShowError] = useState<boolean>(false)
  /*
   * Why the round trip failed: from authn's answer to the exchange, or from the IdP's `?error=`
   * when the callback carried no code, or from this page's own refusal of a callback it will not
   * exchange (a state mismatch, no matching strategy). Null covers only /strategies itself failing,
   * so the Result below keeps its generic subtitle for that rather than inventing a cause.
   */
  const [failure, setFailure] = useState<LoginFailureCause | null>(null)

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const kind = searchParams.get('kind')
  const idpError = searchParams.get('error')
  // An empty `?code=` is no code: there is nothing to exchange, and sending it would only earn
  // authn's MissingAuthorizationCode for a fault that is not the install's.
  const hasCode = code !== null && code !== ''
  /*
   * Set once this callback's fate is decided — exchanged, or refused below. The main effect below
   * re-runs whenever its dependencies change — a /strategies refetch that returns a changed list is
   * enough — and the state and verifier it reads are SPENT on the first run: a second run would find
   * no state, take the unvalidated branch, and exchange a code this page had just refused for a
   * state mismatch. One callback, one decision.
   */
  const decided = useRef(false)

  /*
   * A callback with no `?code=` — the IdP sent back `?error=` (a cancelled consent, a refused
   * request), or the page was opened directly. It used to sit on "Authentication in progress..."
   * forever: the exchange below runs only with a code, so nothing ever failed, and nothing moved
   * the page off its spinner.
   *
   * Classified from `error` alone. `error_description` is NOT read: it is free text from the URL,
   * and any link can write it — see callbackFailureOf.
   *
   * No notification, unlike the exchange path. The <Result> is the whole message, and an
   * error-styled toast reads as blame for what is most often the person pressing Cancel.
   *
   * The stored state and verifier are spent HERE, independent of /strategies: this attempt is over
   * whatever that query does, and a state or verifier left behind would stay valid for a later
   * callback that is not this one (#583).
   */
  useEffect(() => {
    if (hasCode) { return }
    takeSocialLoginState()
    takeSocialLoginVerifier()
    setFailure(callbackFailureOf(idpError))
    setShowError(true)
  }, [hasCode, idpError])

  const { config } = useConfigContext()

  const authUrl = `${config!.api.AUTHN_API_BASE_URL}/strategies`

  const {
    data: methods,
    error: isMethodsError,
    isSuccess: isMethodSuccess,
  } = useQuery({
    // Shared with Login.tsx under the same key — see utils/strategies.ts.
    queryFn: () => fetchStrategies(authUrl),
    queryKey: ['methods', authUrl],
  })

  const {
    isError: isSocialAuthError,
    mutateAsync: socialsAuthentication,
  } = useMutation({
    mutationFn: async (body: AuthRequestType) => {
      /*
       * The name is ENCODED. It is a Kubernetes object name from /strategies, so today it is DNS-safe —
       * but it went into the query raw, and a name carrying `&`, `#`, `?`, `%` or `/` would have cut
       * or reshaped the request: `a&b` asks authn for config `a`. Nothing here should depend on what
       * names happen to look like.
       */
      const response = await fetch(`${config!.api.AUTHN_API_BASE_URL}${body.url}?name=${encodeURIComponent(body.name)}`, {
        headers: {
          'X-Auth-Code': body.code,
          /*
           * Sent IFF the authorization request carried a challenge — SocialLogin stashes the
           * verifier only in that case. authn forwards this to the token endpoint as
           * `code_verifier`; it holds nothing itself, which is why the verifier has to make the
           * round trip through the browser that started the flow. That is also the whole protection:
           * a code intercepted from the redirect is useless without a verifier that never left this
           * browser, and authn WILL redeem any code posted to it with its own client secret.
           */
          ...(body.codeVerifier === undefined ? {} : { 'X-Code-Verifier': body.codeVerifier }),
        },
        method: 'GET',
      })

      /*
       * Read the body ONCE, as `unknown`, and only then decide what it is. It used to be parsed as
       * AuthResponseType unconditionally — a cast that is a lie on the failure path, where authn
       * sends a Kubernetes Status, not a token — and the failure branch then ignored it entirely
       * and printed `Login error (${status}: ${statusText})`. That is verbatim the defect
       * loginFailureCause exists to remove, left in place on this path because before authn 0.35.0
       * these routes answered 417/500 with no cause and there was nothing to classify.
       *
       * `.catch(() => null)` because a proxy between us and authn may answer with something that is
       * not JSON at all; the classifier takes `unknown` and never throws, so a failed parse still
       * produces the right advice from the status code.
       */
      const parsed: unknown = await response.json().catch(() => null)

      if (response.ok) {
        return parsed as AuthResponseType
      }

      /*
       * `redirect`, not `password`: nobody typed anything to get here. That argument is what stops
       * an unrecognised 4xx — including every cause authn adds after this file — from telling the
       * person to check credentials on a page that has no password field.
       */
      const cause = loginFailureCauseOf(response.status, parsed, 'redirect')
      setFailure(cause)
      /*
       * The notification says what the <Result> says: its title, then the classified text with
       * authn's cause appended for support. Passing `description` keeps useCatchError's status-based
       * defaults out of it — they appended "Please check your input or permissions." to every 4xx
       * here, and replaced a 500's text with "The server hit an unexpected error".
       *
       * NOT for a restart. A restart is an attempt that did not finish — a spent code, a lost
       * verifier, a stale ID token — and the <Result> with its "Start the sign-in again" link is the
       * whole message. A red error toast beside it reads as blame, and the callback's own restarts
       * (no code, a state mismatch) never raised one; this path now matches them.
       */
      if (cause.action !== 'restart') {
        catchError({
          description: cause.reason === null ? cause.text : `${cause.text} (${cause.reason})`,
          message: LOGIN_FAILURE_TITLE[cause.action],
          status: response.status,
        }, 'notification')
      }

      /*
       * THROW, so react-query marks the mutation as failed and `isSocialAuthError` becomes true.
       *
       * This branch used to fall off the end and return undefined, which react-query reads as a
       * SUCCESSFUL mutation. `isSocialAuthError` therefore stayed false, `showError` was only ever
       * set by the /strategies query failing, and a refused code left this page on
       * "Authentication in progress..." indefinitely — the spinner below is the component's
       * default state and nothing moved it. The only trace was a notification that dismisses
       * itself, so the end state of a failed sign-in was a page that looked like it was still
       * working. The <Result> was unreachable on this path.
       *
       * The message is for a developer reading the console; everything the person sees comes from
       * `failure` above.
       */
      throw new Error(`social login failed (${response.status}${cause.reason === null ? '' : `: ${cause.reason}`})`)
    },
  })

  useEffect(() => {
    const socialAuth = async (code: string, methodData: AuthModeType, codeVerifier: string | null) => {
      const request: AuthRequestType = {
        code,
        name: methodData.name,
        url: methodData.path,
        ...(codeVerifier === null ? {} : { codeVerifier }),
      }
      /*
       * mutateAsync REJECTS when the exchange fails (see mutationFn). The rejection is deliberately
       * swallowed here: react-query has already recorded it, `isSocialAuthError` drives the error
       * view, and the person has been told in the <Result> (and, unless it is a restart, in the
       * notification). Letting it
       * escape would only produce an unhandled rejection in the console.
       */
      const userData = await socialsAuthentication(request).catch(() => undefined)

      if (userData) {
        localStorage.setItem('K_user', JSON.stringify(userData))
        // Uphold the invariant that a K_user write drops the module-level token cache so the next
        // fetch reads the fresh token (mirrors SessionResumeModal / getAccessToken's contract).
        invalidateAccessTokenCache()
        // If this OIDC round-trip was a mid-session re-auth (the SessionResume modal stashed the
        // pre-expiry route), land the user back where they were; otherwise home. Consume-once +
        // open-redirect-sanitized.
        const stashedNext = localStorage.getItem(SESSION_RESUME_NEXT_KEY)
        localStorage.removeItem(SESSION_RESUME_NEXT_KEY)
        void navigate(resolveNextPath(stashedNext))
      }
    }

    if (hasCode && !decided.current && !isSocialAuthError && isMethodSuccess) {
      decided.current = true
      const methodData = methods
        ?.find((el) => (el.kind === kind) && el.extensions?.redirectURL && (el.extensions.redirectURL.indexOf(window.location.protocol) > -1))

      // Validate the returned state iff WE SENT ONE, which is exactly when SocialLogin recorded it.
      // This used to key off `authCodeURL.indexOf('&state=')` — a substring search of authn's URL —
      // which answers a different question: whether authn's URL mentioned state, not whether the
      // portal issued one. Those came apart in both directions. authn now always sends a state, so
      // the search always matched and the unvalidated branch was dead; and had authn stopped sending
      // one, the search would have stopped matching even though SocialLogin still sent its own,
      // skipping the check on a flow that had one to check.
      // Takes the state AND consumes it (#583) — see takeSocialLoginState. One login, one state.
      const sentState = takeSocialLoginState()
      /*
       * Taken HERE, beside the state, and on every path — including the mismatch path below that
       * never reaches the exchange. One login, one verifier: a verifier left behind stays valid and
       * would be presented by a later callback that is not the one it was issued for. Spending both
       * together is what keeps "did we send a state" and "did we send a challenge" answering about
       * the same flow.
       */
      const sentVerifier = takeSocialLoginVerifier()
      /*
       * Neither refusal below exchanges the code, and both used to stop here silently — the page
       * stayed on its spinner forever. See CALLBACK_STATE_MISMATCH and CALLBACK_NO_STRATEGY.
       *
       * The state mismatch gets no notification, like the code-less callback: nobody did anything
       * wrong, and the <Result> says all there is. The missing strategy does, because it carries a
       * cause an administrator needs to see.
       */
      if (sentState !== null && state !== sentState) {
        setFailure(CALLBACK_STATE_MISMATCH)
        setShowError(true)
      } else if (!methodData) {
        setFailure(CALLBACK_NO_STRATEGY)
        catchError({
          description: `${CALLBACK_NO_STRATEGY.text} (${CALLBACK_NO_STRATEGY.reason})`,
          // No `status`: there was no HTTP failure to report, and inventing one would mislabel it.
          message: LOGIN_FAILURE_TITLE[CALLBACK_NO_STRATEGY.action],
        }, 'notification')
        setShowError(true)
      } else {
        void socialAuth(code, methodData, sentVerifier)
      }
    }

    /*
     * /strategies could not be read, on a callback that carries a code. This used to show only the
     * generic "There seems to be an authentication problem using this method", and it left the
     * stored state and verifier behind: the branch above that spends them runs only on success.
     * This attempt is over either way, so they are spent here too — one login, one state (#583) —
     * and the failure is classified: a gateway's 502/503/504 or an unreachable authn is a restart
     * worth trying again in a moment; anything else is the install's (see strategiesFailureOf).
     * A code-less callback already has its classified failure from the effect above.
     */
    if (hasCode && !decided.current && isMethodsError) {
      decided.current = true
      takeSocialLoginState()
      takeSocialLoginVerifier()
      const cause = strategiesFailureOf(strategiesFailureFrom(isMethodsError), 'callback')
      setFailure(cause)
      if (cause.action !== 'restart') {
        catchError({
          description: `${cause.text} (${cause.reason})`,
          message: LOGIN_FAILURE_TITLE[cause.action],
        }, 'notification')
      }
    }

    if (isMethodsError || isSocialAuthError) {
      setShowError(true)
    }
  }, [catchError, code, hasCode, methods, isSocialAuthError, isMethodsError, isMethodSuccess, navigate, socialsAuthentication, state, kind])

  return (
    showError
      ? (
        <Result
          /*
           * On `restart` the link IS the remedy, so it says so. Labelling it "Return to the Login
           * page" would describe the navigation rather than the action, and this is the one failure
           * on this page where the person can finish the job themselves.
           */
          extra={failure?.action === 'restart'
            ? <StartSignInAgain />
            : <Link to='/login'>Return to the Login page</Link>}
          status={failure?.action === 'escalate' ? 'error' : 'warning'}
          /*
           * Every failure path now sets `failure` before `showError`. The generic fallback stays only
           * so the page can never render an empty subtitle if a future path forgets to.
           */
          subTitle={failure?.text ?? 'There seems to be an authentication problem using this method'}
          title={failure === null ? 'Authentication error' : LOGIN_FAILURE_TITLE[failure.action]}
        />
      )
      : (
        <Space
          direction='vertical'
          size='large'
          style={{ alignItems: 'center', height: '100vh', justifyContent: 'center', width: '100%' }}
        >
          <Spin indicator={<FontAwesomeIcon icon={['fas', 'spinner'] as IconProp} spin />} size='large' />
          <Typography.Text>Authentication in progress...</Typography.Text>
        </Space>
      )
  )
}

export default Auth
