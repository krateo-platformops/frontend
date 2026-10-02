// Session helpers, shared by the UserMenu "Log out" action, the standalone `/logout`
// recovery route, and the session-resume flow's fallback/logout paths.
//
// Wave-1 session resume: a 401 from a widget/API fetch now goes through
// utils/sessionResume.raiseSessionExpired → the IN-PLACE SessionResumeModal
// (components/SessionResume), which re-authenticates via the basic authn flow without
// unmounting the app. `forceLogout` remains the DOCUMENTED FALLBACK for non-basic auth
// strategies, for 401s raised with no modal surface mounted, and for the modal's explicit
// "Log out" choice (`force: true`).
//
// The `/logout` route is the recovery escape hatch: when a stale token leaves the app in a
// broken render state (e.g. "Widget fetch failed: 401 Unauthorized") there's no usable menu,
// so the user (or a deep link) can hit `/logout` to force a clean session and return to login.
//
// Session-honesty change: a 401 from a background widget fetch no longer HARD-WIPES the whole
// client session out from under the user. It surfaces ONE in-place "session expired" prompt
// (`showSessionExpired`) offering Re-authenticate (preserving the current route via `?next=`)
// or Log out — so an expired token mid-session doesn't silently discard unsaved context.

/**
 * Clear every client-side session store: localStorage, sessionStorage, cookies, the Cache
 * Storage API and IndexedDB. Best-effort — each step is guarded so a logout always
 * completes even if one store is unavailable.
 */
export const clearClientSession = async (): Promise<void> => {
  try { localStorage.clear() } catch { /* ignore */ }
  try { sessionStorage.clear() } catch { /* ignore */ }

  // Expire all cookies on the current path.
  document.cookie.split(';').forEach((cookie) => {
    const eqPos = cookie.indexOf('=')
    const name = (eqPos > -1 ? cookie.slice(0, eqPos) : cookie).trim()
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
  })

  if ('caches' in window) {
    try {
      const names = await caches.keys()
      await Promise.all(names.map((name) => caches.delete(name)))
    } catch { /* ignore */ }
  }

  if (window.indexedDB && typeof indexedDB.databases === 'function') {
    try {
      const dbs = await indexedDB.databases()
      dbs.forEach((db) => {
        if (db.name) {
          indexedDB.deleteDatabase(db.name)
        }
      })
    } catch { /* ignore */ }
  }
}

// Guard so a burst of concurrent 401s (every widget on the page fails at once when the token
// expires) triggers exactly one logout/redirect, not a flurry of session-clears.
let loggingOut = false

// ────────────────────────────────────────────────────────────────────────────
// In-place "session expired" prompt (self-contained; no React tree required)
// ────────────────────────────────────────────────────────────────────────────

const MODAL_ID = 'krateo-session-expired'

/** A resume prompt is showing → coalesce a burst of 401s into the single open modal. */
let sessionPromptOpen: Promise<'resume' | 'logout'> | null = null

/**
 * Show a single, in-place "Session expired" modal and resolve with the user's choice.
 * Rendered as a self-contained DOM overlay (not an antd static modal) so it works from a
 * plain util with no React context, and styled purely with the theme's `:root` CSS vars
 * (theme/tokens.ts) so it tracks the active Petrol light/dark theme.
 *
 * Coalesced: a burst of simultaneous 401s (every widget failing at once) returns the SAME
 * pending promise, so exactly one modal is shown.
 */
export const showSessionExpired = (): Promise<'resume' | 'logout'> => {
  if (sessionPromptOpen) { return sessionPromptOpen }
  if (typeof document === 'undefined') { return Promise.resolve('logout') }

  sessionPromptOpen = new Promise<'resume' | 'logout'>((resolve) => {
    const overlay = document.createElement('div')
    overlay.id = MODAL_ID
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', 'Session expired')
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2000',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,0.55)',
      'font-family:var(--font-family, system-ui, sans-serif)',
    ].join(';')

    const card = document.createElement('div')
    card.style.cssText = [
      'min-width:320px', 'max-width:420px', 'box-sizing:border-box',
      'padding:24px', 'border-radius:var(--radius-lg, 8px)',
      'background:var(--panelbg-color, #0E1620)', 'color:var(--text-color, #E6EDF3)',
      'border:1px solid var(--border-color, rgba(230,237,243,0.10))',
      'box-shadow:var(--elevation-lg, 0 10px 28px rgba(0,0,0,0.55))',
    ].join(';')

    const title = document.createElement('h2')
    title.textContent = 'Session expired'
    title.style.cssText = [
      'margin:0 0 8px', 'font-size:var(--krateo-text-body-lg, 18px)',
      'font-family:var(--font-display, inherit)', 'color:var(--text-color, #E6EDF3)',
    ].join(';')

    const body = document.createElement('p')
    body.textContent = 'Your session has expired. Re-authenticate to pick up where you left off, or log out to start over.'
    body.style.cssText = 'margin:0 0 20px;font-size:var(--krateo-text-body-sm, 13px);color:var(--gray-color, #8A97A6);line-height:1.5'

    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end'

    const finish = (choice: 'resume' | 'logout') => {
      overlay.remove()
      sessionPromptOpen = null
      resolve(choice)
    }

    const logoutBtn = document.createElement('button')
    logoutBtn.type = 'button'
    logoutBtn.textContent = 'Log out'
    logoutBtn.style.cssText = [
      'cursor:pointer', 'padding:6px 16px', 'border-radius:var(--radius-md, 6px)',
      'background:transparent', 'color:var(--text-color, #E6EDF3)',
      'border:1px solid var(--border-color, rgba(230,237,243,0.10))',
      'font-size:var(--krateo-text-body-sm, 13px)',
    ].join(';')
    logoutBtn.addEventListener('click', () => finish('logout'))

    const resumeBtn = document.createElement('button')
    resumeBtn.type = 'button'
    resumeBtn.textContent = 'Re-authenticate'
    resumeBtn.style.cssText = [
      'cursor:pointer', 'padding:6px 16px', 'border-radius:var(--radius-md, 6px)',
      'background:var(--amber-color, #F2A33C)', 'color:var(--background-color, #070C12)',
      'border:1px solid var(--amber-color, #F2A33C)', 'font-weight:600',
      'font-size:var(--krateo-text-body-sm, 13px)',
    ].join(';')
    resumeBtn.addEventListener('click', () => finish('resume'))

    actions.append(logoutBtn, resumeBtn)
    card.append(title, body, actions)
    overlay.append(card)
    document.body.append(overlay)
    resumeBtn.focus()
  })

  return sessionPromptOpen
}

/**
 * Clear the client session and hard-redirect to the login screen. The hard redirect (not a
 * client-side navigate) is deliberate: it drops the in-memory access-token cache and any
 * broken React tree, guaranteeing a clean reload. Idempotent: only the first call acts.
 *
 * Behavior split by caller:
 * - From the explicit `/logout` recovery route (or any explicit call passing `force: true`):
 *   immediate hard-wipe — the app may be un-renderable, so no modal is attempted.
 * - Otherwise (a background 401): surface ONE in-place "session expired" prompt first
 *   (`showSessionExpired`). Re-authenticate preserves the current route via `?next=`;
 *   Log out performs the full hard-wipe.
 */
export const forceLogout = async (redirectTo = '/login', options: { force?: boolean } = {}): Promise<void> => {
  if (loggingOut) { return }
  loggingOut = true

  const isRecoveryRoute = typeof window !== 'undefined' && window.location.pathname === '/logout'
  if (options.force || isRecoveryRoute) {
    try {
      await clearClientSession()
    } finally {
      window.location.replace(redirectTo)
    }
    return
  }

  // Background 401 path: offer in-place resume before wiping anything.
  const choice = await showSessionExpired()
  if (choice === 'resume') {
    // Preserve where the user was so re-auth can land them back on the same route.
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    // Drop just the stale token/session state, keep the browser on a login that carries `?next=`.
    await clearClientSession()
    window.location.replace(`/login?next=${next}`)
    return
  }

  try {
    await clearClientSession()
  } finally {
    window.location.replace(redirectTo)
  }
}

/** Test-only: reset the one-shot guards so each test starts clean. */
export const __resetLogoutGuards = (): void => {
  loggingOut = false
  sessionPromptOpen = null
}
