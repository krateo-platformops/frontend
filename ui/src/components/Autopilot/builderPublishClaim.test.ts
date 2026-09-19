import { describe, expect, it } from 'vitest'

import type { Config } from '../../context/ConfigContext'

import {
  buildBuilderPublishClaim,
  buildBuilderPublishOps,
  builderBranch,
  changeRequestDeepLink,
  resolveStructuredTarget,
  type StructuredTarget,
} from './builderPublishClaim'

const cfg = (api: Partial<Config['api']>): Config => ({ api } as Config)

// A resolved GVR stands in for the live CompositionDefinition lookup (composition.krateo.io /
// chart-derived served version / builderpublishes) — see builderPublishGvr.test.ts for resolution.
const GVR = { group: 'composition.krateo.io', resource: 'builderpublishes', version: 'v1-7-17' } as const
const API_VERSION = 'composition.krateo.io/v1-7-17'

describe('resolveStructuredTarget', () => {
  it('defaults to github / github.com with EMPTY repo when config is empty — no hardcoded fallback (#163)', () => {
    const tgt = resolveStructuredTarget('page', cfg({}))
    expect(tgt).toEqual({ base: 'main', host: 'github.com', namespace: '', repo: '', scm: 'github' })
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

  it('resolves to EMPTY namespace/repo on a malformed slug — the human supplies it (#163)', () => {
    const tgt = resolveStructuredTarget('controller', cfg({ AUTOPILOT_KOG_BUILDER_REPO: 'no-slash' }))
    expect(tgt).toMatchObject({ namespace: '', repo: '' })
  })
})

describe('buildBuilderPublishClaim', () => {
  const target: StructuredTarget = { base: 'main', host: 'github.com', namespace: 'acme', repo: 'my-oas', scm: 'github' }

  describe('source — seeding a NEW repo from a template', () => {
    const claimWith = (sourceUrl?: string | null) => buildBuilderPublishClaim({
      apiVersion: API_VERSION, builder: 'page', files: [{ content: 'name: fleet\n', path: 'Chart.yaml' }], slug: 'fleet', sourceUrl, target,
    })

    it('carries the template clone url when one is configured', () => {
      expect(claimWith('https://github.com/krateo-blueprints/portal-builder.git').spec.source?.url)
        .toBe('https://github.com/krateo-blueprints/portal-builder.git')
    })

    it('sends the ignore DIRECTORY, not the filename — git-provider appends the filename itself', () => {
      // Passing '.krateoignore' here makes git-provider look for '.krateoignore/.krateoignore' and
      // the seeding clone dies outright:
      //   failed to set krateo ignore: unable to open .krateoignore:
      //   lstat /tmp/git-provider-clone-<n>/.krateoignore/.krateoignore: not a directory
      // Observed on krateo-057: the BuilderPublish stuck at "2 of 2 managed children are not ready"
      // and committed nothing at all.
      //
      // It is still sent EXPLICITLY rather than omitted: the documented default is the repo root,
      // but with the path unset the template's ignore file was skipped entirely and its example
      // chart was copied into the new repo — leaving TWO Chart.yaml files for a release workflow
      // that packages every chart it finds, and an "Example" page in the sidebar of whoever installs
      // the result.
      expect(claimWith('https://github.com/krateo-blueprints/portal-builder.git').spec.source?.krateoIgnorePath)
        .toBe('/')
    })

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty', ''],
    ])('OMITS the key entirely when the template is %s — absent, not present-and-undefined', (_label, value) => {
      // The BuilderPublish CRD is strict, and the chart decides whether to render the git-provider
      // Repo by testing source.url for emptiness. A key carrying undefined is a different thing to
      // the apiserver than a key that is not there.
      const claim = claimWith(value)
      expect(claim.spec.source).toBeUndefined()
      expect('source' in claim.spec).toBe(false)
    })
  })

  it('builds a BuilderPublish claim with a derived branch + name and full-path files', () => {
    const claim = buildBuilderPublishClaim({
      apiVersion: API_VERSION,
      builder: 'controller',
      files: [{ content: 'apiVersion: swaggergen.krateo.io/v1alpha1\n', path: 'apis/githubrepo/restdefinition.yaml' }],
      slug: 'githubrepo',
      target,
    })
    expect(claim.apiVersion).toBe('composition.krateo.io/v1-7-17')
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

  it('carries the publisher\u2019s repo visibility into spec.target', () => {
    const claim = buildBuilderPublishClaim({
      apiVersion: API_VERSION,
      builder: 'page',
      files: [{ content: 'x', path: 'a.yaml' }],
      slug: 'p',
      target: { ...target, visibility: 'private' },
    })
    expect(claim.spec.target.visibility).toBe('private')
  })

  it('OMITS the key entirely when no visibility was chosen \u2014 absent is not the same as public', () => {
    // The chart reads three states off this one field: "private", "public", and NOTHING (fall back
    // to the install-level repository.private). A key present-and-undefined collapses the third
    // into the second, silently overriding an operator who deliberately set private at install —
    // and the BuilderPublish CRD is generated additionalProperties:false, so an undefined value is
    // not merely redundant, it is a field the apiserver may reject.
    const claim = buildBuilderPublishClaim({
      apiVersion: API_VERSION, builder: 'page', files: [{ content: 'x', path: 'a.yaml' }], slug: 'p', target,
    })
    expect('visibility' in claim.spec.target).toBe(false)
    expect(JSON.stringify(claim.spec.target)).not.toContain('visibility')
  })

  it('derives the builder branch from the slug', () => {
    expect(builderBranch('my-dashboard')).toBe('builder/my-dashboard')
  })

  it('emits ONE gated POST op for the claim (replacing the 3-op github set), at the resolved GVR', () => {
    const claim = buildBuilderPublishClaim({ apiVersion: API_VERSION, builder: 'page', files: [{ content: 'x', path: 'a.yaml' }], slug: 'p', target })
    const ops = buildBuilderPublishOps(claim, GVR)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ gvr: GVR, namespace: 'krateo-system', payload: claim, verb: 'POST' })
    // The op targets the live composition group + served version — NOT a hardcoded apps.krateo.io/v1alpha1.
    expect(ops[0].gvr).toEqual({ group: 'composition.krateo.io', resource: 'builderpublishes', version: 'v1-7-17' })
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
