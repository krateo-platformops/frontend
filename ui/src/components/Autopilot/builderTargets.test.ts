import { describe, expect, it } from 'vitest'

import { builderTemplateUrl, resolveBuilderTarget } from './builderTargets'

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

describe('builderTemplateUrl — the repo a NEW page-set repository is seeded from', () => {
  const template = { owner: 'krateo-blueprints', repo: 'portal-builder' }

  it('builds the clone url the git-provider Repo takes', () => {
    expect(builderTemplateUrl(template, 'github.com')).toBe('https://github.com/krateo-blueprints/portal-builder.git')
  })

  it('seeds from the CONFIGURED host, not github.com', () => {
    // A self-hosted install has its template on its own server; defaulting the host here would send
    // the git-provider to a github.com repo that does not exist.
    expect(builderTemplateUrl(template, 'git.acme.internal')).toBe('https://git.acme.internal/krateo-blueprints/portal-builder.git')
  })

  it('falls back to github.com only when the host is unset or blank', () => {
    expect(builderTemplateUrl(template, undefined)).toContain('https://github.com/')
    expect(builderTemplateUrl(template, '   ')).toContain('https://github.com/')
  })

  it.each([
    ['no template configured', { owner: '', repo: '' }],
    ['owner only', { owner: 'krateo-blueprints', repo: '' }],
    ['repo only', { owner: '', repo: 'portal-builder' }],
  ])('returns NULL, not an empty string, when the template is %s', (_label, value) => {
    // Null and '' are not interchangeable downstream: null omits `source` from the claim and skips
    // seeding, while an empty url would render a Repo that clones nothing and fails the publish.
    expect(builderTemplateUrl(value, 'github.com')).toBeNull()
  })
})
