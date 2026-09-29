import type { AuthResponseType } from '../pages/Login/Login.types'

/**
 * The logged-in user's profile, read from the `K_user` login payload.
 *
 * There is NO runtime `/me` endpoint — authn does not consume its own token; the
 * profile is delivered only in the login response — so this localStorage read IS
 * the identity source. This is the single accessor over it; prefer it to ad-hoc
 * `localStorage.getItem('K_user')` reads (Shell/UserMenu to be migrated onto it).
 */
export type UserInfo = {
  displayName?: string
  username?: string
  avatarURL?: string
  groups?: string[]
}

export const getUserInfo = (): UserInfo => {
  // Storage can be missing (a non-browser runtime) or throw on access (a private window, storage
  // blocked by policy). No identity is the honest answer there — never an exception out of a read
  // that callers make on the way to something else (a draft's owner, a preview's names).
  let raw: string | null = null
  try {
    raw = typeof localStorage === 'undefined' ? null : localStorage.getItem('K_user')
  } catch {
    return {}
  }
  if (!raw) {
    return {}
  }

  try {
    const data = JSON.parse(raw) as NonNullable<AuthResponseType>
    return { ...(data.user ?? {}), groups: data.groups }
  } catch {
    return {}
  }
}
