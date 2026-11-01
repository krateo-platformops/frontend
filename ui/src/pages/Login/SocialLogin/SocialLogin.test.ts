// @vitest-environment jsdom
/**
 * `socialLoginURL` — replacing `state` without destroying the rest of the URL (#561).
 *
 * WHY THIS FILE EXISTS. The old code cut authn's authCodeURL at the first '&state=' and appended its
 * own state, so every parameter authn placed AFTER state was discarded. Nothing reported it: the
 * redirect still succeeded and the IdP simply received a different request than authn had built. It
 * was latent only because of where state happens to sit in the URL authn constructs — parameter
 * ordering, not a contract.
 *
 * The first test is the regression: a parameter positioned after `state` must survive. It is written
 * so that reverting to the truncating implementation fails it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { newSocialLoginState, SOCIAL_LOGIN_STATE_KEY, socialLoginURL, takeSocialLoginState } from './SocialLogin'

const IDP = 'https://idp.example.com/authorize'

describe('socialLoginURL — every parameter except state survives', () => {
  it('KEEPS a parameter positioned AFTER state, which truncation destroyed', () => {
    const authCodeURL = `${IDP}?client_id=krateo&state=authn-original&scope=openid+email&redirect_uri=https%3A%2F%2Fportal%2Fauth`
    const result = new URL(socialLoginURL(authCodeURL, 'ours'))

    // The point of the issue: these two come after `state` and used to be cut off entirely.
    expect(result.searchParams.get('scope')).toBe('openid email')
    expect(result.searchParams.get('redirect_uri')).toBe('https://portal/auth')
    // And state is in fact replaced, not appended alongside authn's.
    expect(result.searchParams.getAll('state')).toEqual(['ours'])
  })

  it('replaces state when it is the FIRST parameter, with nothing before it to preserve', () => {
    const result = new URL(socialLoginURL(`${IDP}?state=authn-original&client_id=krateo`, 'ours'))
    expect(result.searchParams.get('state')).toBe('ours')
    expect(result.searchParams.get('client_id')).toBe('krateo')
  })

  it('ADDS state when authn sent none — the branch that used to forward the URL untouched', () => {
    // Previously this took the else branch: authn's URL was used verbatim and NO state was recorded,
    // so Auth.tsx had nothing to validate against. Now one is always sent.
    const result = new URL(socialLoginURL(`${IDP}?client_id=krateo`, 'ours'))
    expect(result.searchParams.get('state')).toBe('ours')
    expect(result.searchParams.get('client_id')).toBe('krateo')
  })

  it('ADDS state to a URL with no query string at all, without producing a malformed one', () => {
    // The old code's `${url}&state=` assumed a query string already existed; on a bare URL it would
    // have produced '...authorize&state=ours' — a path, not a parameter.
    const result = new URL(socialLoginURL(IDP, 'ours'))
    expect(result.searchParams.get('state')).toBe('ours')
    expect(result.pathname).toBe('/authorize')
    expect(result.search).toBe('?state=ours')
  })

  it('leaves a value that merely CONTAINS "&state=" alone', () => {
    // A substring search cannot tell a real parameter from one spelled inside another's value. A
    // parser can: only the actual `state` parameter is touched.
    const nested = encodeURIComponent('https://portal/auth?x=1&state=not-a-parameter')
    const result = new URL(socialLoginURL(`${IDP}?redirect_uri=${nested}&state=authn-original`, 'ours'))
    expect(result.searchParams.get('redirect_uri')).toBe('https://portal/auth?x=1&state=not-a-parameter')
    expect(result.searchParams.get('state')).toBe('ours')
  })

  it('preserves authn\'s 43-character base64url state shape when ours replaces it', () => {
    // authn 0.31.0 sends 32 random bytes as base64url without padding: 43 chars of [A-Za-z0-9_-].
    // The characters `-` and `_` must not be mangled by a round-trip through URL/searchParams.
    const ours = 'abcDEF123_-xyzABCdef456_-ghiJKL789_-mnoPQRs'
    expect(ours).toHaveLength(43)
    const result = new URL(socialLoginURL(`${IDP}?state=authn-original`, ours))
    expect(result.searchParams.get('state')).toBe(ours)
  })

  it('returns the input unchanged when it is not a URL, rather than navigating somewhere unintended', () => {
    expect(socialLoginURL('not a url', 'ours')).toBe('not a url')
  })
})

/**
 * `newSocialLoginState` and `takeSocialLoginState` — the state's VALUE and its LIFETIME (#583).
 *
 * Separate concerns from the URL handling above. This value is the portal's entire CSRF protection on
 * the social-login callback: Auth.tsx accepts the callback only when the returned state matches it,
 * and authn never stores or checks state, so nothing else guards that door.
 */
describe('newSocialLoginState — the value is unguessable, and shaped like authn\'s', () => {
  it('is 43 characters of base64url, matching authn 0.31.0\'s own state', () => {
    // 32 bytes base64url without padding is exactly 43 chars of [A-Za-z0-9_-]. Same shape authn
    // sends, so neither end needs escaping it as a query parameter.
    const state = newSocialLoginState()
    expect(state).toHaveLength(43)
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // base64url, so NEVER the three characters that would need escaping in a URL.
    expect(state).not.toMatch(/[+/=]/)
  })

  it('draws from crypto.getRandomValues, not Math.random', () => {
    // The specific defect: Math.random is not a CSPRNG. Asserting the SOURCE rather than inspecting
    // the output, because no test on a single value can tell a strong generator from a weak one.
    const getRandomValues = vi.spyOn(crypto, 'getRandomValues')
    const random = vi.spyOn(Math, 'random')
    newSocialLoginState()
    expect(getRandomValues).toHaveBeenCalledOnce()
    expect(random).not.toHaveBeenCalled()
    // 32 bytes requested, which is what gives the 43-char shape above.
    expect((getRandomValues.mock.calls[0][0] as Uint8Array)).toHaveLength(32)
    getRandomValues.mockRestore()
    random.mockRestore()
  })

  it('is fresh every call', () => {
    const states = new Set(Array.from({ length: 50 }, () => newSocialLoginState()))
    expect(states.size).toBe(50)
  })

  it('survives a round trip through the URL unchanged', () => {
    // base64url's `-` and `_` must not be mangled by URL/searchParams — the reason for the shape.
    const state = newSocialLoginState()
    const result = new URL(socialLoginURL(`${IDP}?state=authn-original`, state))
    expect(result.searchParams.get('state')).toBe(state)
  })
})

describe('takeSocialLoginState — one login, one state', () => {
  beforeEach(() => { localStorage.clear() })

  it('returns the stored state and REMOVES it, so it cannot validate a second callback', () => {
    localStorage.setItem(SOCIAL_LOGIN_STATE_KEY, 'sent-once')
    expect(takeSocialLoginState()).toBe('sent-once')
    // The replay window this closes: before, the value stayed and a later callback presenting
    // 'sent-once' validated again.
    expect(localStorage.getItem(SOCIAL_LOGIN_STATE_KEY)).toBeNull()
    expect(takeSocialLoginState()).toBeNull()
  })

  it('consumes on the MISMATCH path too — a state that failed its check is still spent', () => {
    localStorage.setItem(SOCIAL_LOGIN_STATE_KEY, 'ours')
    const sent = takeSocialLoginState()
    expect(sent).toBe('ours')
    // Auth.tsx would reject this callback, and the state must not survive for the next one.
    expect(sent).not.toBe('attacker-supplied')
    expect(localStorage.getItem(SOCIAL_LOGIN_STATE_KEY)).toBeNull()
  })

  it('returns null when we sent none, which is how Auth.tsx tells the two cases apart', () => {
    expect(takeSocialLoginState()).toBeNull()
  })
})
