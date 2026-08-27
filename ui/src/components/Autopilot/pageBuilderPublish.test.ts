/**
 * UI-NATIVE PAGE BUILDER (item C) — pure-logic coverage of the import→build→publish WIRING
 * (compilePageBuilderPublish). Proves the UI-native import path reuses the EXACT Autopilot machinery:
 *   - a valid page tree compiles to the SAME gitref → repocontents(per file) → pullrequest op set
 *     buildPagePublishOps produces, that set passes the applyResourceSet scoping kernel, and the
 *     imported bytes are substituted into every $fileContent token (base64) — published == imported;
 *   - the slug (branch/paths/PR title) derives from the flex.page-<slug>.yaml root (pageRootSlug);
 *   - widget CRs route to chart/templates and the nav fragment to chart/files/nav-fragments;
 *   - a tree WITH a Chart.yaml is DENIED (that is a blueprint, not a page);
 *   - a tree with NO flex.page-<slug>.yaml root is DENIED (no route/slug/nav);
 *   - the repo coords default from PORTAL_CHART_REPO_DEFAULTS and are overridable.
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { isApplySetAllowed } from './applyResourceSet'
import { compilePageBuilderPublish } from './pageBuilderPublish'
import { PORTAL_CHART_REPO_DEFAULTS } from './pagePublish'

const decodeB64 = (b64: string): string => Buffer.from(b64, 'base64').toString('utf-8')

// A page tree as the user imports it: a root page flex, a widget CR, and an optional nav fragment.
const PAGE_TREE: Record<string, string> = {
  'card.cost-summary.yaml': 'apiVersion: widgets.templates.krateo.io/v1beta1\nkind: Card\nmetadata:\n  name: cost-summary\n',
  'flex.page-cost-report.yaml': 'apiVersion: widgets.templates.krateo.io/v1beta1\nkind: Flex\nmetadata:\n  name: page-cost-report\n',
  'nav-fragment.cost-report.yaml': 'item:\n  label: Cost Report\n  path: /cost-report\n  page: cost-report\n',
}

describe('compilePageBuilderPublish — valid page tree', () => {
  it('compiles the gitref → repocontents(per file) → pullrequest set and passes the safety kernel', () => {
    const res = compilePageBuilderPublish(PAGE_TREE, {})
    if (!res.ok) {
      throw new Error(`expected ok, got: ${res.errors.join('; ')}`)
    }
    expect(res.ops.map((op) => op.gvr.resource)).toEqual(['gitrefs', 'repocontents', 'repocontents', 'repocontents', 'pullrequests'])
    expect(isApplySetAllowed(res.ops)).toBe(true)
    expect(res.slug).toBe('cost-report')
    const gitref = res.ops[0].payload as { spec: { ref: string } }
    expect(gitref.spec.ref).toBe('refs/heads/builder/page-cost-report')
  })

  it('routes widget CRs to chart/templates and the nav fragment to chart/files/nav-fragments', () => {
    const res = compilePageBuilderPublish(PAGE_TREE, {})
    if (!res.ok) {
      throw new Error('expected ok')
    }
    const paths = res.ops
      .filter((op) => op.gvr.resource === 'repocontents')
      .map((op) => (op.payload as { spec: { path: string } }).spec.path)
      .sort()
    expect(paths).toEqual([
      'chart/files/nav-fragments/cost-report.yaml',
      'chart/templates/card.cost-summary.yaml',
      'chart/templates/flex.page-cost-report.yaml',
    ])
  })

  it('substitutes the IMPORTED bytes into every $fileContent token (base64) — published == imported', () => {
    const res = compilePageBuilderPublish(PAGE_TREE, {})
    if (!res.ok) {
      throw new Error('expected ok')
    }
    // The root flex CR round-trips as the imported YAML.
    const flexOp = res.ops
      .filter((op) => op.gvr.resource === 'repocontents')
      .find((op) => (op.payload as { spec: { path: string } }).spec.path.endsWith('flex.page-cost-report.yaml'))
    const { content } = (flexOp!.payload as { spec: { content: string } }).spec
    expect(decodeB64(content)).toBe(PAGE_TREE['flex.page-cost-report.yaml'])
    expect((load(decodeB64(content)) as { metadata: { name: string } }).metadata.name).toBe('page-cost-report')
  })

  it('defaults repo coords to the portal chart and honors overrides', () => {
    const def = compilePageBuilderPublish(PAGE_TREE, {})
    if (!def.ok) {
      throw new Error('expected ok')
    }
    const gitref = def.ops[0].payload as { spec: { owner: string; repo: string } }
    expect(gitref.spec.owner).toBe(PORTAL_CHART_REPO_DEFAULTS.owner)
    expect(gitref.spec.repo).toBe(PORTAL_CHART_REPO_DEFAULTS.repo)

    const over = compilePageBuilderPublish(PAGE_TREE, { base: 'develop', owner: 'acme', repo: 'my-portal', title: 't' })
    if (!over.ok) {
      throw new Error('expected ok')
    }
    const pr = over.ops[over.ops.length - 1].payload as { spec: { base: string; owner: string; title: string } }
    expect(pr.spec.owner).toBe('acme')
    expect(pr.spec.base).toBe('develop')
    expect(pr.spec.title).toBe('t')
  })
})

describe('compilePageBuilderPublish — denials', () => {
  it('DENIES a tree WITH a Chart.yaml (that is a blueprint, not a page)', () => {
    const res = compilePageBuilderPublish({ 'Chart.yaml': 'name: x\n', 'flex.page-x.yaml': 'kind: Flex\n' }, {})
    expect(res.ok).toBe(false)
    if (res.ok) {
      throw new Error('expected denial')
    }
    expect(res.errors.join('\n')).toMatch(/Chart\.yaml|Helm chart|blueprint/)
  })

  it('DENIES a tree with NO flex.page-<slug>.yaml root', () => {
    const res = compilePageBuilderPublish({ 'card.x.yaml': 'kind: Card\nmetadata:\n  name: x\n' }, {})
    expect(res.ok).toBe(false)
    if (res.ok) {
      throw new Error('expected denial')
    }
    expect(res.errors.join('\n')).toMatch(/flex\.page-<slug>\.yaml|root/)
  })

  it('DENIES an empty tree', () => {
    expect(compilePageBuilderPublish({}, {}).ok).toBe(false)
  })
})
