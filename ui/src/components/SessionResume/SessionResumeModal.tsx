/**
 * App-level "Session expired" modal — the in-place session-resume surface (Wave-1 session
 * honesty). Mounted ONCE inside the Shell next to the global Drawer/Modal overlays and
 * opened via the `SESSION_RESUME_EVENT` window CustomEvent (utils/sessionResume), so any
 * fetch layer can raise it on a 401 without prop drilling; concurrent 401s coalesce into
 * this single modal.
 *
 * It reflects EVERY enabled authn strategy — the same set the Login page renders (shared via
 * pages/Login/AuthMethods) — not just basic:
 *   - `basic` / `ldap` → a credentials form that re-authenticates IN PLACE: Basic-auth GET to
 *     the strategy path, store the fresh login in `K_user`, invalidate the module-level token
 *     cache (utils/getAccessToken), settle the pending resume 'resumed', and invalidate ALL
 *     react-query queries so the 401-errored widget queries refetch with the fresh token and
 *     the page resumes exactly where it was — no navigation, no state loss.
 *   - social / OIDC → the branded redirect button (SocialLogin). An IdP round-trip cannot
 *     resume in place, so on open we stash the pre-expiry route in `K_sessionResumeNext`; the
 *     /auth callback consumes it and lands the user back where they were.
 *
 * Fallbacks:
 *   - `/strategies` returns an empty list (no way to authenticate) → legacy `forceLogout()`,
 *     which preserves the route via `/login?next=`.
 *   - Explicit "Log out" choice → `forceLogout('/login', { force: true })` hard wipe.
 */

import { useQueryClient } from '@tanstack/react-query'
import { Alert, Button, theme } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import logo from '../../assets/images/logo_big.svg'
import { useConfigContext } from '../../context/ConfigContext'
import AuthMethods from '../../pages/Login/AuthMethods'
import type { AuthModeType, AuthResponseType, FormType, LoginFormType } from '../../pages/Login/Login.types'
import { invalidateAccessTokenCache } from '../../utils/getAccessToken'
import { forceLogout } from '../../utils/logout'
import { SESSION_RESUME_NEXT_KEY } from '../../utils/nextPath'
import { registerSessionResumeSurface, SESSION_RESUME_EVENT, settleSessionResume } from '../../utils/sessionResume'

const SessionResumeModal = () => {
  const { config } = useConfigContext()
  const queryClient = useQueryClient()
  const { token } = theme.useToken()

  const [open, setOpen] = useState(false)
  const [methods, setMethods] = useState<AuthModeType[] | null>(null)
  const [strategiesError, setStrategiesError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const authBaseUrl = config?.api.AUTHN_API_BASE_URL
  // Config-driven branding, mirroring the real Login page (falls back to the built-in logo).
  const logoSrc = config?.login?.logoUrl || logo
  const logoAlt = config?.login?.logoAlt ?? 'Krateo | PlatformOps'

  // Single app-level mount: open on the module-level event, and register this surface so
  // raiseSessionExpired knows an in-place resume is possible (otherwise it falls back).
  useEffect(() => {
    const handleOpen = () => {
      setSubmitError(null)
      setMethods(null)
      // Stash where the user was so a social/OIDC re-auth (a full IdP redirect) can land them
      // back here via the /auth callback. Harmless for the in-place basic/ldap flows, which
      // clear it on success; a fresh visit to /login clears it too.
      try { localStorage.setItem(SESSION_RESUME_NEXT_KEY, window.location.pathname + window.location.search) } catch { /* ignore */ }
      setOpen(true)
    }
    window.addEventListener(SESSION_RESUME_EVENT, handleOpen)
    const unregister = registerSessionResumeSurface()
    return () => {
      window.removeEventListener(SESSION_RESUME_EVENT, handleOpen)
      unregister()
    }
  }, [])

  // On open, discover the enabled strategies via the same `/strategies` call Login uses. The
  // token is dead, but `/strategies` is the pre-auth endpoint so it needs no Authorization.
  useEffect(() => {
    if (!open || !authBaseUrl) { return }
    let cancelled = false
    const discover = async () => {
      setStrategiesError(false)
      try {
        const res = await fetch(`${authBaseUrl}/strategies`)
        if (!res.ok) { throw new Error(`strategies ${res.status}`) }
        const list = await res.json() as AuthModeType[]
        if (cancelled) { return }
        if (!Array.isArray(list) || list.length === 0) {
          // No way to authenticate → legacy fallback (forceLogout preserves the route via
          // /login?next= and offers its own re-authenticate/logout prompt). Drop the stash we
          // set on open so it can't leak into a later session's social callback.
          setOpen(false)
          try { localStorage.removeItem(SESSION_RESUME_NEXT_KEY) } catch { /* ignore */ }
          settleSessionResume('logout')
          void forceLogout()
          return
        }
        setMethods(list)
      } catch {
        if (!cancelled) { setStrategiesError(true) }
      }
    }
    void discover()
    return () => { cancelled = true }
  }, [open, authBaseUrl])

  const onLogout = useCallback(() => {
    setOpen(false)
    try { localStorage.removeItem(SESSION_RESUME_NEXT_KEY) } catch { /* ignore */ }
    settleSessionResume('logout')
    // Explicit user choice → the old hard wipe (clean session, back to login).
    void forceLogout('/login', { force: true })
  }, [])

  // In-place resume for the credential strategies (basic AND ldap): the same authn flow the
  // Login page uses — a Basic-auth GET against the chosen strategy's path.
  const onCredentialSubmit = useCallback(async (
    { password, username }: LoginFormType,
    _kind: FormType,
    method: AuthModeType,
  ) => {
    if (!authBaseUrl) { return }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`${authBaseUrl}${method.path}`, {
        headers: {
          Authorization: `Basic ${btoa(`${username}:${password}`)}`,
        },
        method: 'GET',
      })
      if (!res.ok) {
        setSubmitError(res.status === 401 || res.status === 403
          ? 'Wrong username or password, try again.'
          : `Sign-in failed (${res.status}: ${res.statusText}), please retry.`)
        return
      }
      const data = await res.json() as AuthResponseType
      // Store the fresh session exactly where Login puts it…
      localStorage.setItem('K_user', JSON.stringify(data))
      // …and drop the module-level token cache so the very next fetch uses the new token.
      invalidateAccessTokenCache()
      // In-place resume: no IdP round-trip, so the stashed route is not needed.
      try { localStorage.removeItem(SESSION_RESUME_NEXT_KEY) } catch { /* ignore */ }
      setOpen(false)
      settleSessionResume('resumed')
      // Resume in place: invalidate everything — active queries (including the 401-errored
      // widget queries on screen) refetch with the fresh token; no navigation, no state loss.
      await queryClient.invalidateQueries()
    } catch {
      setSubmitError('Could not reach the authentication service, please retry.')
    } finally {
      setSubmitting(false)
    }
  }, [authBaseUrl, queryClient])

  // A background 401 must NOT leave the errored dashboard peeking through a floating modal
  // (that read as "broken"). Instead this renders a FULL-VIEWPORT opaque login surface that
  // fully covers the stale/errored content — visually a clean login page — while the in-place
  // resume still preserves the route + state (queryClient.invalidateQueries on success, no nav).
  if (!open) {
    return null
  }
  return (
    <div
      aria-label='Session expired'
      aria-modal='true'
      role='dialog'
      style={{
        alignItems: 'center',
        background: token.colorBgLayout,
        display: 'flex',
        inset: 0,
        justifyContent: 'center',
        overflow: 'auto',
        padding: 'var(--spacing-lg)',
        position: 'fixed',
        zIndex: 2000,
      }}
    >
      <div
        style={{
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowSecondary,
          maxWidth: 400,
          padding: 'var(--spacing-xl)',
          width: '100%',
        }}
      >
        <img alt={logoAlt} src={logoSrc} style={{ display: 'block', height: 40, marginBottom: 'var(--spacing-lg)' }} />
        <h2 style={{ color: token.colorText, marginBottom: 'var(--spacing-sm)', marginTop: 0 }}>Session expired</h2>
        <p style={{ color: token.colorTextSecondary, marginBottom: 'var(--spacing-lg)', marginTop: 0 }}>
          Your session has expired. Sign in to continue right where you left off.
        </p>
        {strategiesError && (
          <Alert
            message='Unable to reach the authentication service. Retry in a moment, or log out.'
            showIcon
            style={{ marginBottom: 'var(--spacing-md)' }}
            type='error'
          />
        )}
        {submitError && (
          <Alert message={submitError} showIcon style={{ marginBottom: 'var(--spacing-md)' }} type='error' />
        )}
        {methods && (
          <AuthMethods
            isLoading={submitting}
            methods={methods}
            onCredentialSubmit={(values, kind, method) => { void onCredentialSubmit(values, kind, method) }}
          />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-sm)' }}>
          <Button onClick={onLogout} type='text'>Log out</Button>
        </div>
      </div>
    </div>
  )
}

export default SessionResumeModal
