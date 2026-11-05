import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveNavigationTarget } from './useHandleActions'

/**
 * Pins the same-path query MERGE, which had no test despite being load-bearing.
 *
 * Every independent filter control navigates with only its OWN param — the compositions status
 * chips emit `?status=failed`, the range chips `?range=7d`. Without merging, each click would
 * clobber the others and filters could never compose. Agentiko's `setExtras` rides the same
 * dispatcher, and `buildExtrasPath` deliberately builds a bare `pathname?whitelisted-only` URL
 * BECAUSE this merge restores the rest.
 *
 * That indirection is exactly why an audit read `buildExtrasPath` in isolation, saw
 * `new URLSearchParams()`, and reported that Agentiko silently discards every other URL param.
 * It does not — but nothing in the codebase demonstrated that, and a plausible "fix" would have
 * double-merged. These tests make the contract visible at the seam where it actually lives.
 */
describe('resolveNavigationTarget — same-path query merge', () => {
  const setLocation = (pathname: string, search: string) => {
    vi.stubGlobal('window', { location: { pathname, search } })
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it('merges a single new param into the params already on the URL', () => {
    setLocation('/compositions', '?scope=platform&projects=foo&status=failed')
    const out = resolveNavigationTarget('/compositions?range=7d')

    // The incoming param lands…
    expect(out).toContain('range=7d')
    // …and nothing already there is lost. This is the claim the audit got wrong.
    expect(out).toContain('scope=platform')
    expect(out).toContain('projects=foo')
    expect(out).toContain('status=failed')
  })

  it('overwrites a param of the same key rather than duplicating it', () => {
    setLocation('/compositions', '?status=failed')
    const out = resolveNavigationTarget('/compositions?status=healthy')

    expect(out).toBe('/compositions?status=healthy')
  })

  it('does NOT merge across pathnames — a filter must not leak to another page', () => {
    setLocation('/compositions', '?status=failed')
    const out = resolveNavigationTarget('/incidents?range=7d')

    expect(out).toBe('/incidents?range=7d')
    expect(out).not.toContain('status=failed')
  })

  it('passes a query-less target through untouched', () => {
    setLocation('/compositions', '?status=failed')
    expect(resolveNavigationTarget('/compositions')).toBe('/compositions')
  })
})
