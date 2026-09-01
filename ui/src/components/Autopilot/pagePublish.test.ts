import { describe, expect, it } from 'vitest'

import { isApplySetAllowed } from './applyResourceSet'
import { FILE_CONTENT_KEY, type BlueprintDraftHeld } from './blueprintDraftStore'
import { buildPagePublishOps, PORTAL_CHART_REPO_DEFAULTS } from './pagePublish'

const held = (files: Record<string, string>): BlueprintDraftHeld => ({ bytes: 1, files })
const payloadOf = (op: { payload?: unknown }): Record<string, unknown> => op.payload as Record<string, unknown>
const specOf = (op: { payload?: unknown }): Record<string, unknown> => payloadOf(op).spec as Record<string, unknown>

const SLUG = 'cost-report'
// A page draft as recordPagePreview/pageDraftFiles holds it: widget CRs keyed <kind-lower>.<name>.yaml
// (root page flex first, then children) and the auto-generated nav fragment keyed nav-fragment.<slug>.yaml.
const TREE = held({
  'card.cost-summary.yaml': 'kind: Card\nmetadata:\n  name: cost-summary\n',
  'flex.page-cost-report.yaml': 'kind: Flex\nmetadata:\n  name: page-cost-report\n',
  'nav-fragment.cost-report.yaml': 'item:\n  label: Cost Report\n  path: /cost-report\n  page: cost-report\n',
})

describe('buildPagePublishOps', () => {
  it('fans one publishPage verb into gitref → repocontents(per file) → pullrequest, in order', () => {
    const ops = buildPagePublishOps({}, TREE, SLUG)
    expect(ops.map((op) => op.gvr.resource)).toEqual(['gitrefs', 'repocontents', 'repocontents', 'repocontents', 'pullrequests'])
    expect(ops.every((op) => op.verb === 'POST')).toBe(true)
    expect(ops.every((op) => op.gvr.group === 'github.krateo.io' && op.gvr.version === 'v1alpha1')).toBe(true)
    expect(ops.every((op) => op.namespace === 'krateo-system')).toBe(true)
  })

  it('each op payload is a FULL CR object — apiVersion + kind + metadata.name + spec (no bare {spec})', () => {
    const ops = buildPagePublishOps({}, TREE, SLUG)
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
    // RepoContent names are unique per file (page-slug-prefixed, DNS-1123 slug of the held key).
    const rcNames = ops.filter((op) => payloadOf(op).kind === 'RepoContent').map((op) => (payloadOf(op).metadata as { name: string }).name)
    expect(new Set(rcNames).size).toBe(rcNames.length)
    expect(rcNames).toContain('page-cost-report-flex-page-cost-report-yaml')
  })

  it('creates the builder branch from the page slug and OMITS sha (provider auto-resolves)', () => {
    const spec = specOf(buildPagePublishOps({}, TREE, SLUG)[0])
    expect(spec.ref).toBe('refs/heads/builder/page-cost-report')
    expect(spec).not.toHaveProperty('sha')
    expect(spec.configurationRef).toEqual({ name: PORTAL_CHART_REPO_DEFAULTS.configurationRef })
  })

  it('routes widget CRs to chart/templates and the nav fragment to chart/files/nav-fragments', () => {
    const specs = buildPagePublishOps({}, TREE, SLUG).filter((op) => op.gvr.resource === 'repocontents').map(specOf)
    expect(specs.map((spec) => spec.path).sort()).toEqual([
      'chart/files/nav-fragments/cost-report.yaml',
      'chart/templates/card.cost-summary.yaml',
      'chart/templates/flex.page-cost-report.yaml',
    ])
    for (const spec of specs) {
      expect(spec.branch).toBe('builder/page-cost-report')
    }
  })

  it('emits a $fileContent substitution token (never bytes) keyed by the held file slug', () => {
    const specs = buildPagePublishOps({}, TREE, SLUG).filter((op) => op.gvr.resource === 'repocontents').map(specOf)
    for (const spec of specs) {
      const token = spec.content as Record<string, unknown>
      expect(Object.keys(token)).toEqual([FILE_CONTENT_KEY])
      expect(Object.keys(TREE.files)).toContain(token[FILE_CONTENT_KEY])
    }
  })

  it('opens the PR from the builder branch into the base branch', () => {
    const ops = buildPagePublishOps({}, TREE, SLUG)
    const spec = specOf(ops[ops.length - 1])
    expect(spec.head).toBe('builder/page-cost-report')
    expect(spec.base).toBe('main')
    expect(spec.title).toContain('cost-report')
  })

  it('emits EMPTY owner/repo when the verb omits them — no hardcoded fallback (#163)', () => {
    const spec = specOf(buildPagePublishOps({}, TREE, SLUG)[0])
    expect(spec.owner).toBe('')
    expect(spec.repo).toBe('')
  })

  it('honors overrides supplied by the verb', () => {
    const ops = buildPagePublishOps(
      { base: 'develop', body: 'b', configurationRef: 'other-config', message: 'm', namespace: 'kr', owner: 'acme', repo: 'my-portal', title: 't' },
      TREE,
      SLUG,
    )
    const spec = specOf(ops[ops.length - 1])
    expect(spec.owner).toBe('acme')
    expect(spec.repo).toBe('my-portal')
    expect(spec.base).toBe('develop')
    expect(spec.title).toBe('t')
    expect(spec.body).toBe('b')
    expect(ops.every((op) => op.namespace === 'kr')).toBe(true)
  })

  it('produces a set that passes the applyResourceSet safety kernel', () => {
    expect(isApplySetAllowed(buildPagePublishOps({}, TREE, SLUG))).toBe(true)
  })

  it('a single-widget page (no nav fragment) still produces gitref + 1 repocontents + pullrequest', () => {
    const ops = buildPagePublishOps({}, held({ 'flex.page-x.yaml': 'kind: Flex\n' }), 'x')
    expect(ops.map((op) => op.gvr.resource)).toEqual(['gitrefs', 'repocontents', 'pullrequests'])
    expect(specOf(ops[1]).path).toBe('chart/templates/flex.page-x.yaml')
  })
})
