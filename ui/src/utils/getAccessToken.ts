import type { AuthResponseType } from '../pages/Login/Login.types'

let cachedAccessToken: string | null = null

export const getAccessToken = () => {
  if (cachedAccessToken) {
    return cachedAccessToken
  }

  const userData = localStorage.getItem('K_user')
  if (!userData) {
    throw new Error('No access token found')
  }

  const user = JSON.parse(userData) as NonNullable<AuthResponseType>
  cachedAccessToken = user.accessToken
  return cachedAccessToken
}

/** Run when the cached token is dropped — see `onAccessTokenInvalidated`. */
const invalidationListeners = new Set<() => void>()

/**
 * Be told when the stored session changes, so long-lived things holding a credential can
 * drop it. Returns an unsubscribe.
 *
 * This exists so the knowledge lives in ONE place. A credential change has consequences
 * beyond the next fetch — an open SSE stream authenticated with the old token keeps the
 * old identity on the server for as long as it stays open — and making each caller of
 * `invalidateAccessTokenCache` remember that is how one of them eventually won't.
 * Listeners register here instead; a new call site gets the behaviour for free.
 *
 * A listener that throws must not stop the others or the invalidation itself.
 */
export const onAccessTokenInvalidated = (listener: () => void): (() => void) => {
  invalidationListeners.add(listener)

  return () => { invalidationListeners.delete(listener) }
}

/**
 * Drop the module-level token cache so the next `getAccessToken()` re-reads `K_user`,
 * and tell every listener the session changed.
 *
 * MUST be called whenever the stored session changes without a full page reload — the
 * in-place session-resume modal (components/SessionResume) writes a fresh `K_user` and
 * relies on this to stop every subsequent fetch from replaying the stale cached token.
 * (Login/logout previously always went through a hard redirect, which reset this cache
 * for free; in-place resume deliberately does not.)
 */
export const invalidateAccessTokenCache = (): void => {
  cachedAccessToken = null
  invalidationListeners.forEach((listener) => {
    try {
      listener()
    } catch (error) {
      console.error('[auth] a token-invalidation listener threw:', error)
    }
  })
}
