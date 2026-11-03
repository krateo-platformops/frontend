import { faCircleCheck } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Result, Skeleton } from 'antd'
import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import logo from '../../assets/images/logo_big.svg'
import { useConfigContext } from '../../context/ConfigContext'
import useCatchError from '../../hooks/useCatchError'
import { loginFailureCauseOf } from '../../utils/loginFailureCause'
import { resolveNextPath, SESSION_RESUME_NEXT_KEY } from '../../utils/nextPath'

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
    queryFn: async () => {
      const res = await fetch(authUrl)
      return await res.json() as AuthModeType[]
    },
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
        const { reason, text } = loginFailureCauseOf(response.status, body)
        /*
         * The reason is appended rather than shown alone: it is authn's vocabulary, not the
         * person's, but without it a support conversation starts from "it didn't work".
         */
        catchError({
          message: reason === null ? text : `${text} (${reason})`,
          status: response.status,
        }, 'notification')
      }
    },
  })

  const onFormSubmit = useCallback(async (body: LoginFormType, type: FormType) => {
    const { password, username } = body
    const method = methods?.find(({ kind }) => kind === type)

    if (username && password && method?.path) {
      await login({ password, path: method.path, username })
    } else {
      catchError({ data: { message: 'Wrong username or password, try again with different credentials' }, status: 403 })
    }
  }, [catchError, login, methods])

  const content = useMemo(() => {
    if (isMethodLoading) {
      return <Skeleton active />
    }

    if (isMethodsError) {
      return <Result status='error' subTitle='Unable to retrieve authentication methods' title="Ops! Something didn't work" />
    }

    if (isLoginError) {
      return <Result status='error' subTitle='Error during the login operation' title="Ops! Something didn't work" />
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
  }, [isMethodLoading, isMethodsError, isLoginError, methods, isLoginLoading, onFormSubmit])

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
