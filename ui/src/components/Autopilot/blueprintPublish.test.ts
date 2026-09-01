import { describe, expect, it } from 'vitest'

import { isApplySetAllowed } from './applyResourceSet'
import { FILE_CONTENT_KEY, type BlueprintDraftHeld } from './blueprintDraftStore'
import { BLUEPRINTS_REPO_DEFAULTS, buildBlueprintPublishOps } from './blueprintPublish'

const held = (files: Record<string, string>): BlueprintDraftHeld => ({ bytes: 1, files })
const payloadOf = (op: { payload?: unknown }): Record<string, unknown> => op.payload as Record<string, unknown>
const specOf = (op: { payload?: unknown }): Record<string, unknown> => payloadOf(op).spec as Record<string, unknown>

const CHART = 'aws-vpc'
const TREE = held({
  'Chart.yaml': 'apiVersion: v2\nname: aws-vpc\nversion: 0.1.0\n',
  'templates/vpc.yaml': 'kind: AwsVpcStack\n',
  'values.yaml': 'name: aws-vpc\n',
})

describe('buildBlueprintPublishOps', () => {
  it('fans one publishBlueprint verb into gitref → repocontents(per file) → pullrequest, in order', () => {
    const ops = buildBlueprintPublishOps({}, TREE, CHART)
    expect(ops.map((op) => op.gvr.resource)).toEqual(['gitrefs', 'repocontents', 'repocontents', 'repocontents', 'pullrequests'])
    expect(ops.every((op) => op.verb === 'POST')).toBe(true)
    expect(ops.every((op) => op.gvr.group === 'github.krateo.io' && op.gvr.version === 'v1alpha1')).toBe(true)
    expect(ops.every((op) => op.namespace === 'krateo-system')).toBe(true)
  })

  it('each op payload is a FULL CR object — apiVersion + kind + metadata.name + spec (no bare {spec})', () => {
    const ops = buildBlueprintPublishOps({}, TREE, CHART)
    const kinds = ops.map((op) => payloadOf(op).kind)
    expect(kinds).toEqual(['GitRef', 'RepoContent', 'RepoContent', 'RepoContent', 'PullRequest'])
    for (const op of ops) {
      const pl = payloadOf(op)
      expect(pl.apiVersion).toBe('github.krateo.io/v1alpha1')
      expect(typeof pl.kind).toBe('string')
      const md = pl.metadata as Record<string, unknown>
      expect(typeof md.name).toBe('string')
      expect((md.name as string).length).toBeGreaterThan(0)
      expect(md.namespace).toBe('krateo-system')
      expect(pl.spec).toBeTypeOf('object')
    }
    // RepoContent names are unique per file (chart-prefixed, DNS-1123 slug of the path).
    const rcNames = ops.filter((op) => payloadOf(op).kind === 'RepoContent').map((op) => (payloadOf(op).metadata as { name: string }).name)
    expect(new Set(rcNames).size).toBe(rcNames.length)
    expect(rcNames).toContain('aws-vpc-templates-vpc-yaml')
  })

  it('creates the builder branch from the chart name and OMITS sha (provider auto-resolves)', () => {
    const spec = specOf(buildBlueprintPublishOps({}, TREE, CHART)[0])
    expect(spec.ref).toBe('refs/heads/builder/aws-vpc')
    expect(spec).not.toHaveProperty('sha')
    expect(spec.configurationRef).toEqual({ name: BLUEPRINTS_REPO_DEFAULTS.configurationRef })
  })

  it('emits a $fileContent substitution token (never bytes) per held file, under blueprints/<chart>/', () => {
    const specs = buildBlueprintPublishOps({}, TREE, CHART).filter((op) => op.gvr.resource === 'repocontents').map(specOf)
    expect(specs.map((spec) => spec.path).sort()).toEqual([
      'blueprints/aws-vpc/Chart.yaml',
      'blueprints/aws-vpc/templates/vpc.yaml',
      'blueprints/aws-vpc/values.yaml',
    ])
    for (const spec of specs) {
      expect(spec.branch).toBe('builder/aws-vpc')
      const token = spec.content as Record<string, unknown>
      expect(Object.keys(token)).toEqual([FILE_CONTENT_KEY])
      expect(Object.keys(TREE.files)).toContain(token[FILE_CONTENT_KEY])
    }
  })

  it('opens the PR from the builder branch into the base branch', () => {
    const ops = buildBlueprintPublishOps({}, TREE, CHART)
    const spec = specOf(ops[ops.length - 1])
    expect(spec.head).toBe('builder/aws-vpc')
    expect(spec.base).toBe('main')
    expect(spec.title).toContain('aws-vpc')
  })

  it('emits EMPTY owner/repo when the verb omits them — no hardcoded fallback (#163)', () => {
    const spec = specOf(buildBlueprintPublishOps({}, TREE, CHART)[0])
    expect(spec.owner).toBe('')
    expect(spec.repo).toBe('')
  })

  it('honors overrides supplied by the verb', () => {
    const ops = buildBlueprintPublishOps(
      { base: 'develop', body: 'b', configurationRef: 'other-config', message: 'm', namespace: 'kr', owner: 'acme', repo: 'my-blueprints', title: 't' },
      TREE,
      CHART,
    )
    const spec = specOf(ops[ops.length - 1])
    expect(spec.owner).toBe('acme')
    expect(spec.repo).toBe('my-blueprints')
    expect(spec.base).toBe('develop')
    expect(spec.title).toBe('t')
    expect(spec.body).toBe('b')
    expect(ops.every((op) => op.namespace === 'kr')).toBe(true)
  })

  it('produces a set that passes the applyResourceSet safety kernel', () => {
    expect(isApplySetAllowed(buildBlueprintPublishOps({}, TREE, CHART))).toBe(true)
  })

  it('a single-file chart still produces gitref + 1 repocontents + pullrequest', () => {
    const ops = buildBlueprintPublishOps({}, held({ 'Chart.yaml': 'name: x\n' }), 'x')
    expect(ops.map((op) => op.gvr.resource)).toEqual(['gitrefs', 'repocontents', 'pullrequests'])
  })
})
