import { describe, expect, it } from 'vitest'

import { resolveBuilderTarget } from './builderTargets'

describe('resolveBuilderTarget — owner/repo slug from install config (no hardcoded fallback, #163)', () => {
  it('parses a valid owner/repo slug', () => {
    expect(resolveBuilderTarget('krateo-platformops/krateo-oas')).toEqual({ owner: 'krateo-platformops', repo: 'krateo-oas' })
  })

  it('trims surrounding whitespace', () => {
    expect(resolveBuilderTarget('  acme/widgets  ')).toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['no slash', 'krateo-oas'],
    ['empty owner', '/krateo-oas'],
    ['empty repo', 'krateo-platformops/'],
    ['three segments', 'a/b/c'],
  ])('resolves to an EMPTY target on a malformed value (%s) — no baked-in repo; the human supplies it', (_label, value) => {
    expect(resolveBuilderTarget(value)).toEqual({ owner: '', repo: '' })
  })
})
