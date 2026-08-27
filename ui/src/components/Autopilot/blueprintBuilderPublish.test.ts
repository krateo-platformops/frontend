/**
 * UI-NATIVE BLUEPRINT BUILDER (item C) — pure-logic coverage of the import→build→publish WIRING
 * (compileBlueprintBuilderPublish). Proves the UI-native import path reuses the EXACT Autopilot
 * machinery:
 *   - a valid chart tree compiles to the SAME gitref → repocontents(per file) → pullrequest op set
 *     buildBlueprintPublishOps produces, that set passes the applyResourceSet scoping kernel, and the
 *     imported file bytes are substituted into every $fileContent token (base64) — published == imported;
 *   - the chart identity (branch/PR) derives from Chart.yaml's `name:` (draftDisplayName);
 *   - a tree with NO Chart.yaml is DENIED (a blueprint is a Helm chart);
 *   - an empty / over-512-KiB tree is DENIED via the SAME createBlueprintDraft cap;
 *   - the repo coords default from BLUEPRINTS_REPO_DEFAULTS and are overridable.
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { isApplySetAllowed } from './applyResourceSet'
import { compileBlueprintBuilderPublish } from './blueprintBuilderPublish'
import { BLUEPRINTS_REPO_DEFAULTS } from './blueprintPublish'

const decodeB64 = (b64: string): string => Buffer.from(b64, 'base64').toString('utf-8')

const CHART_TREE: Record<string, string> = {
  'Chart.yaml': 'apiVersion: v2\nname: my-blueprint\nversion: 0.1.0\n',
  'templates/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\n',
  'values.yaml': 'replicaCount: 1\n',
}

describe('compileBlueprintBuilderPublish — valid chart tree', () => {
  it('compiles the gitref → repocontents(per file) → pullrequest set and passes the safety kernel', () => {
    const res = compileBlueprintBuilderPublish(CHART_TREE, {})
    if (!res.ok) {
      throw new Error(`expected ok, got: ${res.errors.join('; ')}`)
    }
    // One gitref + one repocontent per file (3) + one pullrequest.
    expect(res.ops.map((op) => op.gvr.resource)).toEqual(['gitrefs', 'repocontents', 'repocontents', 'repocontents', 'pullrequests'])
    expect(isApplySetAllowed(res.ops)).toBe(true)
    // The chart identity is Chart.yaml's name — the branch derives from it.
    expect(res.chart).toBe('my-blueprint')
    const gitref = res.ops[0].payload as { spec: { ref: string } }
    expect(gitref.spec.ref).toBe('refs/heads/builder/my-blueprint')
  })

  it('substitutes the IMPORTED bytes into every $fileContent token (base64) — published == imported', () => {
    const res = compileBlueprintBuilderPublish(CHART_TREE, {})
    if (!res.ok) {
      throw new Error('expected ok')
    }
    const repoContents = res.ops.filter((op) => op.gvr.resource === 'repocontents')
    // No op still carries a raw {"$fileContent": …} token — all substituted to base64 of the held bytes.
    for (const op of repoContents) {
      const { spec } = (op.payload as { spec: { content: unknown; path: string } })
      expect(typeof spec.content).toBe('string')
      const path = spec.path.replace(/^blueprints\/my-blueprint\//, '')
      expect(decodeB64(spec.content as string)).toBe(CHART_TREE[path])
    }
  })

  it('defaults repo coords to the blueprints registry and honors overrides', () => {
    const def = compileBlueprintBuilderPublish(CHART_TREE, {})
    if (!def.ok) {
      throw new Error('expected ok')
    }
    const gitref = def.ops[0].payload as { spec: { owner: string; repo: string } }
    expect(gitref.spec.owner).toBe(BLUEPRINTS_REPO_DEFAULTS.owner)
    expect(gitref.spec.repo).toBe(BLUEPRINTS_REPO_DEFAULTS.repo)

    const over = compileBlueprintBuilderPublish(CHART_TREE, { base: 'develop', owner: 'acme', repo: 'charts', title: 'my PR' })
    if (!over.ok) {
      throw new Error('expected ok')
    }
    const pr = over.ops[over.ops.length - 1].payload as { spec: { base: string; owner: string; title: string } }
    expect(pr.spec.owner).toBe('acme')
    expect(pr.spec.base).toBe('develop')
    expect(pr.spec.title).toBe('my PR')
  })

  it('the committed Chart.yaml round-trips as YAML (the tree is published verbatim)', () => {
    const res = compileBlueprintBuilderPublish(CHART_TREE, {})
    if (!res.ok) {
      throw new Error('expected ok')
    }
    const chartOp = res.ops
      .filter((op) => op.gvr.resource === 'repocontents')
      .find((op) => (op.payload as { spec: { path: string } }).spec.path.endsWith('Chart.yaml'))
    const { content } = (chartOp!.payload as { spec: { content: string } }).spec
    expect((load(decodeB64(content)) as { name: string }).name).toBe('my-blueprint')
  })
})

describe('compileBlueprintBuilderPublish — denials', () => {
  it('DENIES a tree with no Chart.yaml (a blueprint is a Helm chart)', () => {
    const res = compileBlueprintBuilderPublish({ 'templates/x.yaml': 'kind: Deployment\n' }, {})
    expect(res.ok).toBe(false)
    if (res.ok) {
      throw new Error('expected denial')
    }
    expect(res.errors.join('\n')).toMatch(/Chart\.yaml/)
  })

  it('DENIES an empty tree via the shared createBlueprintDraft cap', () => {
    const res = compileBlueprintBuilderPublish({}, {})
    expect(res.ok).toBe(false)
  })

  it('DENIES an over-512-KiB tree via the shared held-tree cap', () => {
    const big = { 'Chart.yaml': 'name: big\n', 'values.yaml': 'x: '.padEnd(600 * 1024, 'y') }
    const res = compileBlueprintBuilderPublish(big, {})
    expect(res.ok).toBe(false)
    if (res.ok) {
      throw new Error('expected denial')
    }
    expect(res.errors.join('\n')).toMatch(/512 KiB/)
  })
})
