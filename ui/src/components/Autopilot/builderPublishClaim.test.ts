import { describe, expect, it } from 'vitest'

import type { Config } from '../../context/ConfigContext'

import {
  buildBuilderPublishClaim,
  builderBranch,
  changeRequestDeepLink,
  resolveStructuredTarget,
  type StructuredTarget,
} from './builderPublishClaim'

const cfg = (api: Partial<Config['api']>): Config => ({ api } as Config)

describe('resolveStructuredTarget', () => {
  it('defaults to github / github.com with the builder canonical repo when config is empty', () => {
    const tgt = resolveStructuredTarget('page', cfg({}))
    expect(tgt).toEqual({ base: 'main', host: 'github.com', namespace: 'krateo-platformops', repo: 'krateo-portal-chart', scm: 'github' })
  })

  it('takes the per-builder repo slug from install config', () => {
    const tgt = resolveStructuredTarget('controller', cfg({ AUTOPILOT_KOG_BUILDER_REPO: 'acme/my-oas' }))
    expect(tgt).toMatchObject({ namespace: 'acme', repo: 'my-oas' })
  })

  it('honours a custom SCM + host (self-hosted) — org AND repo are configurable', () => {
    const tgt = resolveStructuredTarget('blueprint', cfg({
      AUTOPILOT_BLUEPRINT_BUILDER_REPO: 'platform/blueprints',
      AUTOPILOT_GIT_HOST: 'gitlab.acme.io',
      AUTOPILOT_GIT_SCM: 'gitlab',
    }))
    expect(tgt).toEqual({ base: 'main', host: 'gitlab.acme.io', namespace: 'platform', repo: 'blueprints', scm: 'gitlab' })
  })

  it('supports a GitLab nested-group namespace (multi-segment slug)', () => {
    const tgt = resolveStructuredTarget('page', cfg({ AUTOPILOT_PAGE_BUILDER_REPO: 'group/sub/pages' }))
    expect(tgt).toMatchObject({ namespace: 'group/sub', repo: 'pages' })
  })

  it('falls back to the canonical owner/repo on a malformed slug', () => {
    const tgt = resolveStructuredTarget('controller', cfg({ AUTOPILOT_KOG_BUILDER_REPO: 'no-slash' }))
    expect(tgt).toMatchObject({ namespace: 'krateo-platformops', repo: 'krateo-oas' })
  })
})

describe('buildBuilderPublishClaim', () => {
  const target: StructuredTarget = { base: 'main', host: 'github.com', namespace: 'acme', repo: 'my-oas', scm: 'github' }

  it('builds a BuilderPublish claim with a derived branch + name and full-path files', () => {
    const claim = buildBuilderPublishClaim({
      builder: 'controller',
      files: [{ content: 'apiVersion: swaggergen.krateo.io/v1alpha1\n', path: 'apis/githubrepo/restdefinition.yaml' }],
      slug: 'githubrepo',
      target,
    })
    expect(claim.apiVersion).toBe('apps.krateo.io/v1alpha1')
    expect(claim.kind).toBe('BuilderPublish')
    expect(claim.metadata).toEqual({ name: 'publish-githubrepo', namespace: 'krateo-system' })
    expect(claim.spec).toMatchObject({
      branch: 'builder/githubrepo',
      builder: 'controller',
      name: 'publish-githubrepo',
      target: { base: 'main', namespace: 'acme', repo: 'my-oas' },
    })
    // Full path is preserved — the composition splits it into fileName + toRepo.path.
    expect(claim.spec.files[0].path).toBe('apis/githubrepo/restdefinition.yaml')
    // No credentials / host / scm — those are install-level, supplied by the composition.
    expect(JSON.stringify(claim)).not.toContain('credentials')
    expect(JSON.stringify(claim)).not.toContain('secretRef')
  })

  it('derives the builder branch from the slug', () => {
    expect(builderBranch('my-dashboard')).toBe('builder/my-dashboard')
  })
})

describe('changeRequestDeepLink', () => {
  const mkTarget = (scm: string, host = 'github.com'): StructuredTarget => ({ base: 'main', host, namespace: 'acme', repo: 'my-oas', scm })
  const branch = 'builder/githubrepo'

  it('github → the compare/open-PR page', () => {
    expect(changeRequestDeepLink(mkTarget('github'), branch)).toBe('https://github.com/acme/my-oas/compare/main...builder/githubrepo?expand=1')
  })

  it('gitlab → the new-merge-request page with encoded branches', () => {
    const url = changeRequestDeepLink(mkTarget('gitlab', 'gitlab.acme.io'), branch)
    expect(url).toContain('https://gitlab.acme.io/acme/my-oas/-/merge_requests/new?')
    expect(url).toContain('source_branch%5D=builder%2Fgithubrepo')
    expect(url).toContain('target_branch%5D=main')
  })

  it('bitbucket → the new-pull-request page', () => {
    expect(changeRequestDeepLink(mkTarget('bitbucket', 'bitbucket.org'), branch))
      .toBe('https://bitbucket.org/acme/my-oas/pull-requests/new?source=builder%2Fgithubrepo&dest=main')
  })

  it('azure devops → the create-pr path', () => {
    expect(changeRequestDeepLink(mkTarget('ado', 'dev.azure.com'), branch))
      .toContain('/_git/my-oas/pullrequestcreate?sourceRef=builder%2Fgithubrepo&targetRef=main')
  })

  it('an unknown scm falls back to the github form', () => {
    expect(changeRequestDeepLink(mkTarget('unknown'), branch)).toContain('/compare/main...builder/githubrepo')
  })
})
