import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button } from 'antd'

import type { AuthModeType } from '../Login.types'

import styles from './SocialLogin.module.css'

/**
 * Where the state we sent is recorded, so Auth.tsx can tell "we sent a state" from "we did not".
 * Exported because that check is the other half of this contract and must not re-spell the key.
 */
export const SOCIAL_LOGIN_STATE_KEY = 'KrateoSL'

/**
 * authn's authCodeURL with `state` replaced by ours, every other parameter untouched.
 *
 * Separate from the component so it can be tested without a DOM: the bug this fixes was in string
 * handling, and the regression test for it should not need a rendered button to exercise.
 *
 * Falls back to string handling only if the URL cannot be parsed at all, which would mean authn sent
 * something that is not a URL — in that case there is nothing better to do than send it on and let
 * the browser report it, rather than navigating somewhere unintended.
 */
export const socialLoginURL = (authCodeURL: string, state: string): string => {
  try {
    const url = new URL(authCodeURL)
    url.searchParams.set('state', state)
    return url.toString()
  } catch {
    return authCodeURL
  }
}

/**
 * A fresh OAuth `state`: 32 crypto-random bytes, base64url, 43 characters.
 *
 * WHY NOT Math.random (#583). This value is the portal's ENTIRE CSRF protection on the social-login
 * callback — Auth.tsx accepts the callback only when the returned state matches it — and authn never
 * stores or checks state, so nothing else is guarding that door. It used to be
 * `Math.floor(Math.random() * Date.now()).toString(36)`, which is not a CSPRNG and is not required
 * to be unpredictable.
 *
 * The part that made it worth changing rather than tolerating: authn 0.31.0 already sends 32
 * crypto-random bytes in the same shape, and the portal was overwriting that with the weaker value.
 * A strong state was available and being discarded.
 *
 * base64url rather than base64 so the value needs no escaping as a query parameter, and so it
 * matches the shape authn uses — 43 chars of [A-Za-z0-9_-], no padding.
 */
/**
 * The state we sent, removed as it is read. Null when we sent none.
 *
 * Read-and-remove in one place because the two must not come apart: leaving the value behind keeps
 * it valid indefinitely, so a later callback presenting the same state validates again (#583). It
 * removes on EVERY path, including a mismatch — a state that failed its check is spent either way,
 * and keeping it would leave exactly the window this closes.
 *
 * Here rather than in Auth.tsx so the whole contract — the key, the value, writing it, taking it —
 * lives in one file, and so it can be tested without rendering the callback page.
 */
export const takeSocialLoginState = (): string | null => {
  const sent = localStorage.getItem(SOCIAL_LOGIN_STATE_KEY)
  localStorage.removeItem(SOCIAL_LOGIN_STATE_KEY)
  return sent
}

export const newSocialLoginState = (): string => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

type SocialLoginType = {
  method: AuthModeType
}
const SocialLogin = ({ method }: SocialLoginType) => {
  if (!method.extensions?.authCodeURL || !method.graphics?.displayName) {
    return <></>
  }

  const getRandomString = () => {
    const rnd = newSocialLoginState()
    localStorage.setItem(SOCIAL_LOGIN_STATE_KEY, rnd)
    return rnd
  }

  const onSubmit = () => {
    if (!method.extensions?.authCodeURL) {
      return
    }
    // Replace `state` by PARSING the URL, never by cutting the string at '&state='. The old code
    // truncated at the first '&state=' and appended its own, so every parameter authn placed AFTER
    // state was discarded — silently, because the redirect still succeeded and the IdP simply
    // received a different request than authn built. It was latent only because of where state
    // happens to sit in authn's URL, which is parameter ordering, not a contract.
    //
    // `searchParams.set` adds the parameter when absent and replaces it when present, so the two
    // branches this replaces collapse into one: there is no longer a case where we forward authn's
    // URL unchanged and store no state. We always send our own state and always record it, which is
    // what makes the check in Auth.tsx able to key off having sent one.
    window.location.href = socialLoginURL(method.extensions.authCodeURL, getRandomString())
  }

  return (
    <Button
      className={styles.button}
      icon={method.graphics?.icon && <FontAwesomeIcon icon={method.graphics.icon as IconProp} />}
      onClick={onSubmit}
      size='large'
      style={
        method.graphics?.backgroundColor && method.graphics?.textColor
          ? { backgroundColor: method.graphics.backgroundColor, color: method.graphics.textColor }
          : undefined
      }
    >
      {method.graphics?.displayName}
    </Button>
  )
}

export default SocialLogin
