import { describe, expect, it } from 'vitest'

import type { Config } from '../../context/ConfigContext'

import {
  buildBuilderPublishClaim,
  buildBuilderPublishOps,
  builderBranch,
  changeRequestDeepLink,
  resolveStructuredTarget,
  seededRepoProblem,
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
      expect(claimWith('https://github.com/krateo-blueprints/builder-scaffold.git').spec.source?.url)
        .toBe('https://github.com/krateo-blueprints/builder-scaffold.git')
    })

    it('seeds the BUILDER branch, never the base — the scaffold rides the change request', () => {
      // builder-publish's default seeds target.base. A chart named like an existing repository is
      // adopted by the publish, so seeding the base committed a release workflow and a .helmignore
      // straight onto that repository's main, unreviewed, where the workflow then ran on every push.
      const claim = claimWith('https://github.com/krateo-blueprints/builder-scaffold.git')
      expect(claim.spec.source?.intoBranch).toBe(claim.spec.branch)
      expect(claim.spec.source?.intoBranch).toBe('builder/fleet')
      expect(claim.spec.source?.intoBranch).not.toBe(target.base)
    })

    it('sends the ignore DIRECTORY, not the filename — git-provider appends the filename itself', () => {
      // Passing '.krateoignore' here makes git-provider look for '.krateoignore/.krateoignore' and
      // the seeding clone dies outright:
      //   failed to set krateo ignore: unable to open .krateoignore:
      //   lstat /tmp/git-provider-clone-<n>/.krateoignore/.krateoignore: not a directory
      // Observed on krateo-057: the BuilderPublish stuck at "2 of 2 managed children are not ready"
      // and committed nothing at all.
      //
      // What the ignore file does NOT do is keep a file out of the copy — git-provider copies every
      // file and only skips RENDERING the ignored ones. The example chart that used to arrive in
      // every seeded repo arrived because it was in the template; the builder scaffold has none.
      expect(claimWith('https://github.com/krateo-blueprints/builder-scaffold.git').spec.source?.krateoIgnorePath)
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

describe('seededRepoProblem — a seeded repository is named for its one chart', () => {
  it('accepts the chart\'s own name, whitespace aside', () => {
    expect(seededRepoProblem('orders-api', 'orders-api')).toBeNull()
    expect(seededRepoProblem('orders-api', '  orders-api ')).toBeNull()
  })

  it('refuses any other name, naming the repository it must be and why', () => {
    // A second chart in a repo that holds one keeps the FIRST chart's root files — the claim never
    // overwrites — so its templates would be merged into another chart. The reason has to say that,
    // or a person reads the refusal as arbitrary and types a third name.
    const problem = seededRepoProblem('orders-api', 'blueprints')
    expect(problem).toMatch(/^the repository must be "orders-api", not "blueprints"/)
    expect(problem).toMatch(/exactly one chart, at its root/)
    expect(problem).toMatch(/never overwrites a file/)
  })

  it('is case-sensitive — the claim creates the repository under exactly the name it is given', () => {
    expect(seededRepoProblem('orders-api', 'Orders-Api')).not.toBeNull()
  })
})
