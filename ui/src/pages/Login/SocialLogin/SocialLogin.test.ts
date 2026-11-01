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
import { describe, expect, it } from 'vitest'

import { socialLoginURL } from './SocialLogin'

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
