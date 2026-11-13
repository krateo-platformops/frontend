import { useMutation, useQuery } from '@tanstack/react-query'
import { Result, Skeleton } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'

import { BrandBand, brandOf, brandTitleClass, InstallationLine } from '../../components/BrandFrame'
import { useConfigContext } from '../../context/ConfigContext'
import type { LoginFailureCause } from '../../utils/loginFailureCause'
import {
  CREDENTIALS_REQUIRED,
  credentialUrlFailureOf,
  LOGIN_FAILURE_TITLE,
  LOGIN_NO_ANSWER,
  loginFailureCauseOf,
  strategiesFailureOf,
} from '../../utils/loginFailureCause'
import { resolveNextPath, SESSION_RESUME_NEXT_KEY } from '../../utils/nextPath'
import { credentialLoginUrlOf, fetchStrategies, strategiesFailureFrom } from '../../utils/strategies'

import AuthMethods from './AuthMethods'
import styles from './Login.module.css'
import type { AuthModeType, AuthResponseType, LoginFormAlert, LoginFormType } from './Login.types'
import StartSignInAgain from './StartSignInAgain'

// The login screen renders BEFORE any backend identity, so its branding is config-driven
// (`config.login`, ConfigMap-mountable per install) rather than a snowplow widget — a login/auth
// widget would be bespoke behavior, which the antd-only widget registry deliberately excludes.
// The band and the installation line are shared with the Card widget's `brand` frame
// (components/BrandFrame), so a branded page draws the same ones.

/*
 * authn refused the username and password. The page used to say "Authentication error" over "Those
 * credentials were not accepted. Check them and try again." in a toast. authn sends one fixed cause
 * for an unknown user and a wrong password on purpose (no username enumeration), so the copy names
 * both and asks for both to be checked.
 */
const WRONG_CREDENTIALS = { text: 'Check both and try again.', title: 'Wrong username or password.' }

/**
 * The optional marketing copy, as one short paragraph, or null when an install sets none. Nothing
 * is shown by default: a sign-in page is for signing in, and the copy it used to ship ("Ship
 * platform resources without the YAML toil.") described a product, not this installation.
 */
const pitchOf = (login: { headline?: string; subtitle?: string; highlights?: string[] } | undefined): string | null => {
  const parts = [login?.headline, login?.subtitle, (login?.highlights ?? []).filter(Boolean).join(' · ')]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
  return parts.length ? parts.join(' ') : null
}

/*
 * What a successful credential sign-in answers: authn's login response (authn
 * internal/helpers/encode/success.go), which is what K_user holds and what getAccessToken and
 * getUserInfo read back. It was stored as `AuthModeType[]` — the /strategies list, a different
 * answer — through a cast, so nothing checked that the body was a session at all.
 *
 * Checks the one field a session cannot be without. authn refuses to start without its signing key,
 * so every 2xx it sends carries a token; a 2xx without one came from something in front of it.
 */
const isLoginResponse = (body: unknown): body is AuthResponseType => (
  typeof body === 'object' && body !== null
  && 'accessToken' in body && typeof body.accessToken === 'string' && body.accessToken !== ''
)

const Login = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { config } = useConfigContext()
  // The failed sign-in the submitted form shows above its button. Cleared on the next submit.
  // A counter, not the previous alert's: the alert is cleared on every submit.
  const [alert, setAlert] = useState<LoginFormAlert | null>(null)
  const attempts = useRef(0)
  const showAlert = useCallback((method: AuthModeType, cause: LoginFailureCause, retype = false) => {
    attempts.current += 1
    setAlert({
      attempt: attempts.current,
      method,
      reason: cause.reason,
      retype,
      text: retype ? WRONG_CREDENTIALS.text : cause.text,
      title: retype ? WRONG_CREDENTIALS.title : LOGIN_FAILURE_TITLE[cause.action],
    })
  }, [])

  // A fresh visit to the login page is NOT a mid-session resume: drop any route the
  // SessionResume modal stashed for a social/OIDC round-trip, so a plain social sign-in here
  // lands on home rather than inheriting a stale pre-expiry route through the /auth callback.
  useEffect(() => {
    try { localStorage.removeItem(SESSION_RESUME_NEXT_KEY) } catch { /* ignore */ }
  }, [])

  // Where to land after a successful login: the session-resume flow parks the pre-expiry
  // route in `?next=` (see utils/logout.forceLogout); fall back to home. Sanitized against
  // open-redirects by resolveNextPath.
  const nextPath = resolveNextPath(searchParams.get('next'))

  // Config-driven branding. The logo and its alt fall back to the bundled ones; the rest is absent
  // unless an install sets it.
  const branding = config?.login
  const { installationName, logoAlt, logoSrc } = brandOf(branding)
  const pitch = pitchOf(branding)
  const requestAccountUrl = branding?.requestAccountUrl

  const authUrl = `${config!.api.AUTHN_API_BASE_URL}/strategies`

  const {
    data: methods,
    error: isMethodsError,
    isLoading: isMethodLoading,
  } = useQuery({
    // Shared with Auth.tsx under the same key — see utils/strategies.ts.
    queryFn: () => fetchStrategies(authUrl),
    queryKey: ['methods', authUrl],
  })

  const {
    error: isLoginError,
    isPending: isLoginLoading,
    mutateAsync: login,
    reset: resetLogin,
  } = useMutation({
    mutationFn: async (credentials: { username: string; password: string; url: string; method: AuthModeType }) => {
      const response = await fetch(credentials.url, {
        headers: {
          Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
        },
        method: 'GET',
      })

      if (response.ok) {
        const data: unknown = await response.json()
        // Not a session: throwing makes it the no-answer case, as a body that is not JSON already is.
        if (!isLoginResponse(data)) { throw new Error('sign-in answered 2xx without an access token') }
        localStorage.setItem('K_user', JSON.stringify(data))
        // Resume the pre-expiry route when the session-resume flow supplied ?next=; home otherwise.
        void navigate(nextPath)
      } else {
        // This used to show `Login error (${status}: ${statusText})` and nothing else, which made a
        // misconfigured cluster and a mistyped password look identical: someone whose LDAP server
        // was down was told to check their password. authn 0.32.0 separates them — a refusal of the
        // caller is 401/403, authn's own inability to check is 5xx — with the cause in
        // details.causes[0].reason. loginFailureCause turns that into the one distinction a login
        // form can act on.
        //
        // The body is read defensively because a proxy between us and authn may answer with
        // something that is not a Kubernetes Status at all; the classifier takes `unknown` and
        // never throws, so a failed parse still produces the right advice from the status code.
        const body: unknown = await response.json().catch(() => null)
        const cause = loginFailureCauseOf(response.status, body, 'password')
        /*
         * Shown inline, above the button of the form that was submitted. It used to be a toast: away
         * from the fields it was about, and gone after a few seconds. authn's reason goes with it,
         * small — it is authn's vocabulary, not the person's, but without it a support conversation
         * starts from "it didn't work". A refused password gets the retype copy and an emptied,
         * focused password field; every other cause keeps its classified copy.
         */
        showAlert(credentials.method, cause, cause.action === 'retype')
      }
    },
  })

  /*
   * `method` is the /strategies entry whose form was submitted. AuthMethods renders one form per
   * credential strategy and passes its own entry back; this used to drop it and re-find the method
   * by `kind`, so with two LDAPConfigs every sign-in went to whichever came first.
   */
  const onFormSubmit = useCallback(async (body: LoginFormType, method: AuthModeType) => {
    const { password, username } = body
    setAlert(null)

    /*
     * A strategy with no `path`, or an LDAP strategy with no `name`, has nowhere to send the
     * credentials: a broken /strategies entry, never the person's typing. The first used to fall
     * into the same branch as empty fields and say "Wrong username or password, try again with
     * different credentials" — sending someone to retype a password that was never even sent.
     * Checked FIRST, so neither can be read that way. See credentialLoginUrlOf.
     */
    const target = credentialLoginUrlOf(config!.api.AUTHN_API_BASE_URL, method)
    if (!target.ok) {
      showAlert(method, credentialUrlFailureOf(target.reason))
      return
    }

    if (username && password) {
      /*
       * mutateAsync REJECTS when the call gets no answer (see LOGIN_NO_ANSWER), and this handler is
       * invoked as `void onFormSubmit(...)`, so the rejection used to escape as an unhandled promise
       * rejection. react-query has already recorded it and `isLoginError` drives the <Result>, as
       * Auth.tsx does for its own exchange; there is nothing more to do with it here.
       */
      await login({ method, password, url: target.url, username }).catch(() => undefined)
    } else {
      showAlert(method, CREDENTIALS_REQUIRED)
    }
  }, [config, login, showAlert])

  /*
   * What the page shows in place of the form when it cannot offer one. These used to read "Ops!
   * Something didn't work" over "Unable to retrieve authentication methods" / "Error during the
   * login operation" — an apology that named nothing and gave nothing to do. They are classified
   * now, like every other failure on the two sign-in pages, and the cause is appended because this
   * <Result> is the only place these failures surface: there is no notification beside it.
   */
  const pageFailure = useMemo((): LoginFailureCause | null => {
    if (isMethodsError) { return strategiesFailureOf(strategiesFailureFrom(isMethodsError), 'login') }
    return isLoginError ? LOGIN_NO_ANSWER : null
  }, [isMethodsError, isLoginError])

  const content = useMemo(() => {
    if (isMethodLoading) {
      return <Skeleton active />
    }

    if (pageFailure !== null) {
      return (
        <Result
          /*
           * A sign-in call that got no answer may well get one next time, so it offers the same
           * action the callback page offers for an attempt that did not finish. This page used to
           * replace the form with the <Result> and leave a reload as the only way back. The link
           * keeps the URL (with its ?next=) and clears the failed attempt, which brings back an
           * empty form. A /strategies failure has no form to go back to, so it gets no link.
           */
          extra={pageFailure === LOGIN_NO_ANSWER
            ? <StartSignInAgain onClick={resetLogin} to={{ pathname: location.pathname, search: location.search }} />
            : undefined}
          status={pageFailure.action === 'escalate' ? 'error' : 'warning'}
          subTitle={pageFailure.reason === null ? pageFailure.text : `${pageFailure.text} (${pageFailure.reason})`}
          title={LOGIN_FAILURE_TITLE[pageFailure.action]}
        />
      )
    }

    if (methods) {
      if (methods.length === 0) {
        return (
          <Result
            status='warning'
            subTitle='Please create some authentication methods and try again'
            title='There are no authentication methods'
          />
        )
      }

      return (
        <AuthMethods
          alert={alert ?? undefined}
          isLoading={isLoginLoading}
          methods={methods}
          onCredentialSubmit={(values, _kind, method) => { void onFormSubmit(values, method) }}
        />
      )
    }
  }, [isMethodLoading, pageFailure, location.pathname, location.search, resetLogin, methods, alert, isLoginLoading, onFormSubmit])

  /*
   * One card, form first (2026-11 redesign). The brand gradient is a 64px band at the top of the
   * card, carrying the logo: the gradient's stops are mode-invariant, so the light logo mark — and a
   * tenant's `login.logoUrl`, documented as a light mark — reads in both themes. The band, the
   * heading and the installation name stay on every width; the old split screen hid the logo below
   * 768px.
   */
  return (
    <div className={styles.login}>
      <main className={styles.card}>
        <BrandBand logoAlt={logoAlt} logoSrc={logoSrc} />
        <div className={styles.body}>
          <h1 className={brandTitleClass}>Sign in</h1>
          <InstallationLine installationName={installationName} />
          {pitch && <p className={styles.pitch}>{pitch}</p>}
          {content}
          {requestAccountUrl && (
            <p className={styles.requestAccount}>
              Need access? <a href={requestAccountUrl}>Request an account</a>
            </p>
          )}
        </div>
      </main>
    </div>
  )
}

export default Login
