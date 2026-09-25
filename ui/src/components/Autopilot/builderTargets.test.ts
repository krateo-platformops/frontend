import { describe, expect, it } from 'vitest'

import { builderTemplateUrl, resolveBuilderTarget, resolveBuilderTargets } from './builderTargets'

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

describe('builderTemplateUrl — the repo a NEW page-set or blueprint repository is seeded from', () => {
  const template = { owner: 'krateo-blueprints', repo: 'builder-scaffold' }

  it('builds the clone url the git-provider Repo takes', () => {
    expect(builderTemplateUrl(template, 'github.com')).toBe('https://github.com/krateo-blueprints/builder-scaffold.git')
  })

  it('seeds from the CONFIGURED host, not github.com', () => {
    // A self-hosted install has its template on its own server; defaulting the host here would send
    // the git-provider to a github.com repo that does not exist.
    expect(builderTemplateUrl(template, 'git.acme.internal')).toBe('https://git.acme.internal/krateo-blueprints/builder-scaffold.git')
  })

  it('falls back to github.com only when the host is unset or blank', () => {
    expect(builderTemplateUrl(template, undefined)).toContain('https://github.com/')
    expect(builderTemplateUrl(template, '   ')).toContain('https://github.com/')
  })

  it.each([
    ['no template configured', { owner: '', repo: '' }],
    ['owner only', { owner: 'krateo-blueprints', repo: '' }],
    ['repo only', { owner: '', repo: 'builder-scaffold' }],
  ])('returns NULL, not an empty string, when the template is %s', (_label, value) => {
    // Null and '' are not interchangeable downstream: null omits `source` from the claim and skips
    // seeding, while an empty url would render a Repo that clones nothing and fails the publish.
    expect(builderTemplateUrl(value, 'github.com')).toBeNull()
  })
})

describe('resolveBuilderTargets — which config key feeds which target', () => {
  it('seeds a BLUEPRINT from AUTOPILOT_BLUEPRINT_BUILDER_TEMPLATE, and a page from its own key', () => {
    // Two keys, two templates: wiring one to the other seeds every publish of one builder from the
    // other builder's template, which nothing downstream would notice until the repo is looked at.
    const targets = resolveBuilderTargets({
      AUTOPILOT_BLUEPRINT_BUILDER_TEMPLATE: 'acme/blueprint-scaffold',
      AUTOPILOT_PAGE_BUILDER_TEMPLATE: 'acme/page-scaffold',
    })
    expect(targets.blueprintTemplate).toEqual({ owner: 'acme', repo: 'blueprint-scaffold' })
    expect(targets.pageTemplate).toEqual({ owner: 'acme', repo: 'page-scaffold' })
  })

  it('an unset blueprint template is an EMPTY target — no seeding, no guessed repo', () => {
    expect(resolveBuilderTargets({ AUTOPILOT_PAGE_BUILDER_TEMPLATE: 'acme/page-scaffold' }).blueprintTemplate).toEqual({ owner: '', repo: '' })
    expect(resolveBuilderTargets(undefined).blueprintTemplate).toEqual({ owner: '', repo: '' })
  })

  it('the chart\'s blueprint default yields the OWNER — its repo segment is a placeholder nothing publishes to', () => {
    // `krateo-blueprints/<chart>`: the owner is what the composer shows and the form prefills; the
    // repository is always the chart's own name. `<chart>` still has to PARSE, or the owner would be
    // lost with it — resolveBuilderTarget empties a slug with an empty segment.
    expect(resolveBuilderTargets({ AUTOPILOT_BLUEPRINT_BUILDER_REPO: 'krateo-blueprints/<chart>' }).blueprint.owner).toBe('krateo-blueprints')
  })
})
