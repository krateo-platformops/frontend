import { describe, expect, it } from 'vitest'

import { BUILDER_TARGET_FALLBACKS, resolveBuilderTarget } from './builderTargets'

const FB = { owner: 'fallback-owner', repo: 'fallback-repo' }

describe('resolveBuilderTarget — owner/repo slug from install config', () => {
  it('parses a valid owner/repo slug', () => {
    expect(resolveBuilderTarget('krateo-platformops/krateo-oas', FB)).toEqual({ owner: 'krateo-platformops', repo: 'krateo-oas' })
  })

  it('trims surrounding whitespace', () => {
    expect(resolveBuilderTarget('  acme/widgets  ', FB)).toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['no slash', 'krateo-oas'],
    ['empty owner', '/krateo-oas'],
    ['empty repo', 'krateo-platformops/'],
    ['three segments', 'a/b/c'],
  ])('falls back on a malformed value (%s)', (_label, value) => {
    expect(resolveBuilderTarget(value, FB)).toBe(FB)
  })

  it('the KOG fallback is krateo-platformops (not the dead krateo-blueprints from #105)', () => {
    expect(BUILDER_TARGET_FALLBACKS.kog).toEqual({ owner: 'krateo-platformops', repo: 'krateo-oas' })
  })
})
