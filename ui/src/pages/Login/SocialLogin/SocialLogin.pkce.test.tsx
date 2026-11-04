// @vitest-environment jsdom
/**
 * The PKCE GATE, clicked rather than called.
 *
 * `SocialLogin.test.ts` proves the pieces: the verifier's shape, the S256 digest against RFC 7636's
 * own worked vector, and that `socialLoginURL` adds the parameters iff given a challenge. None of
 * that proves the DECISION — whether this flow gets PKCE at all — and the decision is the part with
 * a blast radius:
 *
 *   authn forwards `X-Code-Verifier` from /oidc/login and /oidc/stepup but NOT from /oauth/login
 *   (authn#85, not yet released). A challenge on an OAuth flow therefore reaches the IdP with no
 *   verifier behind it, and EVERY login on that provider fails. demo's social login is GitHub
 *   OAuth, so getting this wrong takes demo's sign-in out entirely.
 *
 * So these tests click the button and read what was actually sent and stored. The pairing test is
 * the one that matters: it recomputes S256 over the stored verifier and requires it to equal the
 * challenge that went out, which is the only assertion that catches the two halves drifting apart.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthModeType } from '../Login.types'

import SocialLogin, { codeChallengeOf, SOCIAL_LOGIN_VERIFIER_KEY } from './SocialLogin'

/** Where the button sent us. jsdom has no navigation, so href is captured instead. */
let navigatedTo = ''

const method = (kind: string): AuthModeType => ({
  extensions: {
    authCodeURL: 'https://idp.test/authorize?client_id=krateo&scope=openid&state=authn-original',
    redirectURL: 'http://localhost/auth',
  },
  graphics: { backgroundColor: '#24292e', displayName: `Sign in with ${kind}`, icon: 'fa-github', textColor: '#fff' },
  kind,
  name: kind === 'oidc' ? 'keycloak' : 'github',
  path: kind === 'oidc' ? '/oidc/keycloak' : '/oauth/github',
})

/** Click and wait for the async digest + navigation to settle. */
const clickAndSettle = async (kind: string) => {
  // Unmount any previous button: the leak test clicks twice in one case, and two mounted buttons
  // make the query ambiguous rather than failing the behaviour under test.
  cleanup()
  render(<SocialLogin method={method(kind)} />)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`sign in with ${kind}`, 'i') }))
  /*
   * Wait for the NAVIGATION, not for a fixed delay. onSubmit awaits crypto.subtle.digest, which in
   * Node is threadpool-backed and so resolves on a later turn than a setTimeout(0) macrotask. A
   * sleep that is too short does not merely fail this test: the digest then settles DURING THE NEXT
   * test and writes its URL into that test's capture, which is how the OAuth case first "found" a
   * code_challenge it had never sent. Waiting on the condition removes the race rather than widening
   * the window on it.
   */
  await waitFor(() => expect(navigatedTo).not.toBe(''))
  return new URL(navigatedTo)
}

beforeEach(() => {
  navigatedTo = ''
  localStorage.clear()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      get href() { return navigatedTo },
      set href(next: string) { navigatedTo = next },
      protocol: 'http:',
    },
  })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('SocialLogin PKCE gate', () => {
  it('an OIDC flow sends a challenge AND keeps the matching verifier — the pairing, end to end', async () => {
    const url = await clickAndSettle('oidc')

    const challenge = url.searchParams.get('code_challenge')
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')

    const verifier = localStorage.getItem(SOCIAL_LOGIN_VERIFIER_KEY)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)

    // THE ASSERTION. The verifier kept here must be the pre-image of the challenge sent there. If
    // the two are generated independently, or one is stored and the other recomputed, every login
    // fails at the exchange — and it fails as AuthorizationCodeRejected, indistinguishable from an
    // expired code, so the portal would tell the person to retry something that can never succeed.
    expect(await codeChallengeOf(verifier!)).toBe(challenge)

    // And the state fix is not regressed by any of this.
    expect(url.searchParams.get('state')).not.toBe('authn-original')
    expect(url.searchParams.get('client_id')).toBe('krateo')
    expect(url.searchParams.get('scope')).toBe('openid')
  })

  it('an OAuth flow sends NO challenge and stores NO verifier, because authn cannot carry the other half yet', async () => {
    const url = await clickAndSettle('oauth')

    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect(url.searchParams.has('code_challenge_method')).toBe(false)
    // Nothing stored: Auth.tsx sends X-Code-Verifier only when something is here, so an empty slot
    // is what keeps the OAuth exchange byte-identical to today's.
    expect(localStorage.getItem(SOCIAL_LOGIN_VERIFIER_KEY)).toBeNull()
    // The rest of the flow is untouched.
    expect(url.searchParams.get('client_id')).toBe('krateo')
    expect(url.searchParams.get('state')).not.toBe('authn-original')
  })

  it('an abandoned OIDC attempt cannot leak its verifier into a later OAuth login', async () => {
    // Start an OIDC flow and never come back: its verifier is left in storage.
    await clickAndSettle('oidc')
    expect(localStorage.getItem(SOCIAL_LOGIN_VERIFIER_KEY)).not.toBeNull()

    // Now sign in with OAuth instead. Without the unconditional clear in onSubmit, that stale
    // verifier would be presented on the OAuth callback — where no challenge was ever issued — and
    // the exchange would be refused for a reason nobody could see.
    const url = await clickAndSettle('oauth')
    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect(localStorage.getItem(SOCIAL_LOGIN_VERIFIER_KEY)).toBeNull()
  })
})
