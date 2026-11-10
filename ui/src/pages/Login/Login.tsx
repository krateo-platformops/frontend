import { faCircleCheck } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Result, Skeleton } from 'antd'
import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import logo from '../../assets/images/logo_big.svg'
import { useConfigContext } from '../../context/ConfigContext'
import useCatchError from '../../hooks/useCatchError'
import type { LoginFailureCause } from '../../utils/loginFailureCause'
import {
  LOGIN_FAILURE_TITLE,
  LOGIN_NO_ANSWER,
  loginFailureCauseOf,
  STRATEGY_WITHOUT_PATH,
  strategiesFailureOf,
} from '../../utils/loginFailureCause'
import { resolveNextPath, SESSION_RESUME_NEXT_KEY } from '../../utils/nextPath'
import { fetchStrategies, strategiesFailureFrom } from '../../utils/strategies'

import AuthMethods from './AuthMethods'
import styles from './Login.module.css'
import type { AuthModeType, FormType, LoginFormType } from './Login.types'

// Branding-panel defaults. The login screen renders BEFORE any backend identity,
// so its copy is config-driven (`config.login`, ConfigMap-mountable per install)
// rather than a snowplow widget — a login/auth widget would be bespoke behavior,
// which the antd-only widget registry deliberately excludes. These constants are
// the fallback when a config omits the keys. (Marketing copy, not portal data —
// the mockup's fabricated "128 compositions" stat stays dropped.)
const DEFAULT_LOGO_ALT = 'Krateo | PlatformOps'
const DEFAULT_HEADLINE = 'Ship platform resources without the YAML toil.'
const DEFAULT_SUBTITLE = 'Self-service infrastructure for your developers — compose, provision and observe cloud resources from a single control plane.'
const DEFAULT_HIGHLIGHTS = [
  'Compose cloud resources across your clusters',
  'GitOps reconciliation in real time',
  'Policy-guarded self-service catalog',
]

const Login = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { catchError } = useCatchError()
  const { config } = useConfigContext()

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

  // Config-driven branding (falls back to the built-in defaults when absent).
  const branding = config?.login
  const logoSrc = branding?.logoUrl || logo
  const logoAlt = branding?.logoAlt ?? DEFAULT_LOGO_ALT
  const headline = branding?.headline ?? DEFAULT_HEADLINE
  const subtitle = branding?.subtitle ?? DEFAULT_SUBTITLE
  const highlights = branding?.highlights?.length ? branding.highlights : DEFAULT_HIGHLIGHTS
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
  } = useMutation({
    mutationFn: async (credentials: { username: string; password: string; path: string }) => {
      const authUrl = `${config!.api.AUTHN_API_BASE_URL}${credentials.path}`

      const response = await fetch(authUrl, {
        headers: {
          Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
        },
        method: 'GET',
      })

      if (response.ok) {
        const data = await response.json() as AuthModeType[]
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
        const { action, reason, text } = loginFailureCauseOf(response.status, body, 'password')
        /*
         * The reason is appended rather than shown alone: it is authn's vocabulary, not the
         * person's, but without it a support conversation starts from "it didn't work".
         *
         * Passed as `description`, with the action's title as `message`, so useCatchError shows it
         * as given. As `message` alone it met the hook's status defaults: a 4xx got "Please check
         * your input or permissions." added under it, and a 500 had it REPLACED by "The server hit
         * an unexpected error" — on a page where this notification is the only failure surface, so
         * every classified 5xx (LDAPUnavailable, IssuanceFailed …) reached nobody.
         */
        catchError({
          description: reason === null ? text : `${text} (${reason})`,
          message: LOGIN_FAILURE_TITLE[action],
          status: response.status,
        }, 'notification')
      }
    },
  })

  const onFormSubmit = useCallback(async (body: LoginFormType, type: FormType) => {
    const { password, username } = body
    const method = methods?.find(({ kind }) => kind === type)

    /*
     * A strategy with no `path` has nowhere to send the credentials: a broken /strategies entry,
     * never the person's typing. This used to fall into the same branch as empty fields and say
     * "Wrong username or password, try again with different credentials" — sending someone to
     * retype a password that was never even sent. Checked FIRST, so it cannot be read that way.
     */
    if (!method?.path) {
      catchError({
        description: `${STRATEGY_WITHOUT_PATH.text} (${STRATEGY_WITHOUT_PATH.reason})`,
        message: LOGIN_FAILURE_TITLE[STRATEGY_WITHOUT_PATH.action],
      }, 'notification')
      return
    }

    if (username && password) {
      /*
       * mutateAsync REJECTS when the call gets no answer (see LOGIN_NO_ANSWER), and this handler is
       * invoked as `void onFormSubmit(...)`, so the rejection used to escape as an unhandled promise
       * rejection. react-query has already recorded it and `isLoginError` drives the <Result>, as
       * Auth.tsx does for its own exchange; there is nothing more to do with it here.
       */
      await login({ password, path: method.path, username }).catch(() => undefined)
    } else {
      catchError({ data: { message: 'Wrong username or password, try again with different credentials' }, status: 403 })
    }
  }, [catchError, login, methods])

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
          isLoading={isLoginLoading}
          methods={methods}
          onCredentialSubmit={(values, kind) => { void onFormSubmit(values, kind) }}
        />
      )
    }
  }, [isMethodLoading, pageFailure, methods, isLoginLoading, onFormSubmit])

  return (
    <div className={styles.login}>
      <aside className={styles.aside}>
        <img alt={logoAlt} className={styles.logo} src={logoSrc} />
        <div className={styles.pitch}>
          <h1 className={styles.headline}>{headline}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
          <ul className={styles.highlights}>
            {highlights.map((highlight) => (
              <li key={highlight}>
                <FontAwesomeIcon icon={faCircleCheck} /> {highlight}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className={styles.section}>
        <div className={styles.formPanel}>
          <h2 className={styles.welcome}>Welcome back</h2>
          <p className={styles.welcomeSub}>Sign in to your Krateo control plane.</p>
          {content}
          {requestAccountUrl && (
            <p className={styles.requestAccount}>
              Need access? <a href={requestAccountUrl}>Request an account</a>
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

export default Login
