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
 * Where the PKCE `code_verifier` is kept between the redirect and the callback.
 *
 * It lives beside the state on purpose: the two have identical lifetimes, identical
 * take-once-and-remove semantics, and the same single-writer rule. authn cannot hold either — it is
 * stateless between the two legs and serves one `authCodeURL` to every caller, so it has nowhere to
 * keep a verifier and no way to tie one to a browser. That is why the challenge is the client's to
 * build (authn docs/behavior.md), and why this key exists here rather than server-side.
 */
export const SOCIAL_LOGIN_VERIFIER_KEY = 'KrateoSLV'

/** base64url, unpadded. Separate from the generator because the S256 challenge encodes a digest. */
const base64UrlOf = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * base64url of `count` crypto-random bytes, unpadded — the shape both the state and the PKCE
 * verifier need (RFC 7636 §4.1 requires exactly this alphabet for a verifier).
 *
 * `crypto.getRandomValues` and NOT `crypto.randomUUID`/`crypto.subtle`: getRandomValues is the one
 * crypto API available in an INSECURE context, and an install reached over a bare http://<LB-IP> is
 * not a secure context. Calling a secure-context-only API on the login path blanked the entire
 * portal once already; nothing here may repeat that.
 */
const randomBase64Url = (count: number): string => {
  const bytes = new Uint8Array(count)
  crypto.getRandomValues(bytes)
  return base64UrlOf(bytes)
}

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
export const socialLoginURL = (
  authCodeURL: string,
  state: string,
  codeChallenge: string | null,
): string => {
  try {
    const url = new URL(authCodeURL)
    url.searchParams.set('state', state)
    /*
     * The challenge goes on ONLY when one was computed, and the caller stashes the verifier ONLY
     * when it went on. Those two must not come apart in either direction: a challenge sent without
     * a verifier returned fails the exchange, and a verifier returned for a flow that carried no
     * challenge is itself an error (RFC 7636 §4.6). Both arrive as AuthorizationCodeRejected, which
     * is indistinguishable from an expired code — so a mismatch here would read as "try again" and
     * never terminate.
     */
    if (codeChallenge !== null) {
      url.searchParams.set('code_challenge', codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
    }
    return url.toString()
  } catch {
    return authCodeURL
  }
}

/**
 * A fresh PKCE `code_verifier`: 32 crypto-random bytes, base64url, 43 characters — inside RFC 7636's
 * 43..128 range and using its required alphabet.
 */
export const newCodeVerifier = (): string => randomBase64Url(32)

/**
 * The S256 challenge for a verifier, or NULL when this browser cannot compute one.
 *
 * Null is not a failure to handle later; it is the signal that PKCE must be skipped for this flow.
 * `crypto.subtle` is secure-context-only, so over a bare `http://<LB-IP>` install it is `undefined`
 * — and the honest response there is to run the flow exactly as it ran before, not to fall back to
 * `code_challenge_method=plain`, which RFC 9700 tells you not to use and which would offer the
 * appearance of protection without it.
 *
 * It is logged rather than silent: a security control that turns itself off should say so, and the
 * only reachable cause is a non-HTTPS deployment, which is actionable.
 */
export const codeChallengeOf = async (verifier: string): Promise<string | null> => {
  if (typeof crypto.subtle?.digest !== 'function') {
    console.warn(
      '[login] PKCE disabled: crypto.subtle is unavailable, which means this portal is not served '
      + 'over a secure context (HTTPS, or localhost). Serve it over HTTPS to enable PKCE.'
    )
    return null
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlOf(new Uint8Array(digest))
}

/**
 * The verifier we sent a challenge for, removed as it is read. Null when we sent none.
 *
 * Read-and-remove for the same reason as the state: one login, one verifier. Leaving it behind would
 * let a later callback — including an OAuth one that carried no challenge — present a verifier that
 * is not its own, which the exchange then rejects.
 */
export const takeSocialLoginVerifier = (): string | null => {
  const sent = localStorage.getItem(SOCIAL_LOGIN_VERIFIER_KEY)
  localStorage.removeItem(SOCIAL_LOGIN_VERIFIER_KEY)
  return sent
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

export const newSocialLoginState = (): string => randomBase64Url(32)

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

  /**
   * Whether to add PKCE to THIS flow.
   *
   * OIDC only, deliberately, and this is not caution — it is a hard constraint with a date on it.
   * authn forwards `X-Code-Verifier` to the token endpoint from `/oidc/login` and `/oidc/stepup`
   * but NOT from `/oauth/login`, which still calls Exchange with no verifier option. Sending a
   * challenge on an OAuth flow would therefore give the IdP a challenge and no verifier, and EVERY
   * such login would fail — demo's social login is GitHub OAuth, so this would take demo's sign-in
   * out entirely. authn is adding the forwarding; turn this on for `oauth` only once a release with
   * that fix is pinned, and not before.
   *
   * An IdP that does not implement PKCE ignores both parameters (RFC 7636 §5), so there is no
   * provider to exclude here — only the authn route that cannot carry the other half yet.
   */
  const usesPkce = method.kind === 'oidc'

  const onSubmit = async () => {
    if (!method.extensions?.authCodeURL) {
      return
    }

    /*
     * Drop any verifier from an earlier attempt BEFORE deciding, so the one thing that cannot
     * happen is a verifier outliving the flow it belongs to. Without this, an abandoned OIDC
     * attempt followed by an OAuth login would send that stale verifier on the OAuth callback,
     * where no challenge was ever issued, and the exchange would be refused.
     */
    localStorage.removeItem(SOCIAL_LOGIN_VERIFIER_KEY)

    let codeChallenge: string | null = null
    if (usesPkce) {
      const verifier = newCodeVerifier()
      codeChallenge = await codeChallengeOf(verifier)
      // Stash the verifier IFF the challenge will actually be sent — see socialLoginURL.
      if (codeChallenge !== null) {
        localStorage.setItem(SOCIAL_LOGIN_VERIFIER_KEY, verifier)
      }
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
    window.location.href = socialLoginURL(method.extensions.authCodeURL, getRandomString(), codeChallenge)
  }

  return (
    <Button
      className={styles.button}
      icon={method.graphics?.icon && <FontAwesomeIcon icon={method.graphics.icon as IconProp} />}
      onClick={() => { void onSubmit() }}
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
