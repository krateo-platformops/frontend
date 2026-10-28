/**
 * planEdge — one legality check, whoever asks, and every accepted edge is the descriptor AND the gate
 * in one plan. Each chart here is the screen-6 chart the composer itself builds (__fixtures__/s4b).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { lintBlueprintDraft } from '../../components/Autopilot/blueprintDraft'

import { applyPlan, edgeChart, editDescriptor, gatedGolden, nodeIn } from './__fixtures__/s4b'
import { ARCHITECTURE_API_VERSION, ARCHITECTURE_KIND, ARCHITECTURE_TEMPLATE_PATH, serializeArchitecture, wrapAsConfigMapTemplate, type ChartArchitecture, type ResourceNode } from './architecture'
import { GATE_BEGIN } from './gateGen'
import { graphBlockIn } from './graphCompile'
import { placedNameExpression } from './naming'
import { legalEdgeTargets, planEdge, planReadyWhen, planRemoveNode, planSetForEach, type EdgePlan, type EdgeRefusal } from './planEdge'
import { conditionReadyWhen } from './readyWhen'

const refusal = (plan: { ok: boolean }): EdgeRefusal => {
  if (plan.ok) { throw new Error('expected a refusal') }
  return plan as EdgeRefusal
}

const accepted = (plan: EdgePlan): Extract<EdgePlan, { ok: true }> => {
  if (!plan.ok) { throw new Error(plan.reason) }
  return plan
}

/** Screen 7's edge, on the screen-6 chart. */
const SCREEN_07 = { from: 'localresource', op: 'add', ready: true, readyWhen: '.status.default_branch', to: 'repository' } as const

describe('planEdge — refusals, each in words', () => {
  const files = edgeChart()

  it('ready: true onto a custom resource with no readyWhen', () => {
    expect(refusal(planEdge(files, { from: 'localresource', op: 'add', ready: true, to: 'repository' }))).toEqual({
      code: 'needs-readyWhen',
      ok: false,
      reason: 'Pick what “ready” means for repository — a custom resource has no default. Or turn off Wait for readiness: then it only has to exist.',
      where: ['repository', 'repo', 'mongodb'],
    })
  })

  it('a self edge, a duplicate, a lifecycle target and a lifecycle source', () => {
    expect(refusal(planEdge(files, { from: 'repo', op: 'add', to: 'repo' })).code).toBe('self')
    expect(refusal(planEdge(files, { from: 'repo', op: 'add', to: 'repo' })).reason).toBe('repo cannot depend on itself. Nothing was written.')
    expect(refusal(planEdge(files, { from: 'pullrequest', op: 'add', to: 'localresource' })))
      .toMatchObject({ code: 'duplicate', reason: 'pullrequest already depends on localresource — change that edge in the inspector instead.' })
    const shimmed = editDescriptor(files, (nodes) => nodes.map((node) => (node.id === 'mongodb' ? { ...node, lifecycle: 'shim' } : node)))
    expect(refusal(planEdge(shimmed, { from: 'repo', op: 'add', to: 'mongodb' })))
      .toMatchObject({ code: 'lifecycle', reason: '"mongodb" is lifecycle: shim — orthogonal to the sequence, so nothing can wait on it' })
    expect(refusal(planEdge(shimmed, { from: 'mongodb', op: 'add', to: 'repo' })))
      .toMatchObject({ code: 'lifecycle-source', reason: '"mongodb" is lifecycle: shim — outside the sequence, so it waits for nothing. Nothing was written.' })
  })

  it('a cycle: the loop named from the target, and exactly where it could go instead', () => {
    const plan = refusal(planEdge(files, { from: 'localresource', op: 'add', to: 'pullrequest' }))
    expect(plan).toEqual({
      code: 'cycle',
      cycle: ['pullrequest', 'localresource', 'pullrequest'],
      ok: false,
      reason: 'pullrequest → localresource → pullrequest would be a cycle. Nothing was written. It could depend on repository, repo or mongodb instead.',
      where: ['repository', 'repo', 'mongodb'],
    })
    // A longer loop, rotated to start at the target: repo → localresource → pullrequest → repo.
    const chained = applyPlan(files, planEdge(files, { from: 'localresource', op: 'add', to: 'repo' }))
    expect(refusal(planEdge(chained, { from: 'repo', op: 'add', to: 'pullrequest' })).reason)
      .toBe('pullrequest → localresource → repo → pullrequest would be a cycle. Nothing was written. It could depend on repository or mongodb instead.')
  })

  it('an unknown node, and an edge that is not there', () => {
    expect(refusal(planEdge(files, { from: 'localresource', op: 'add', to: 'nope' })).code).toBe('unknown-node')
    expect(refusal(planEdge(files, { from: 'repo', op: 'remove', to: 'mongodb' })))
      .toMatchObject({ code: 'missing-edge', reason: 'repo does not depend on mongodb — there is no edge to remove. Nothing was written.' })
  })

  it('a readyWhen outside the grammar', () => {
    expect(refusal(planEdge(files, { from: 'localresource', op: 'add', ready: true, readyWhen: '.status.a | not', to: 'repository' })).code).toBe('bad-readyWhen')
  })

  it('a hand-written gate is never touched — the refusal names its line', () => {
    const fixture = readFileSync(join(__dirname, '__fixtures__', 'builder-publish', 'templates', 'localresources.yaml'), 'utf8')
    const migrated = { ...files, 'templates/localresource.yaml': fixture }
    expect(refusal(planEdge(migrated, SCREEN_07))).toEqual({
      code: 'unmanaged-gate',
      line: 41,
      ok: false,
      path: 'templates/localresource.yaml',
      reason: 'templates/localresource.yaml already gates itself with a hand-written lookup (line 41), so the composer will not add a second gate there. Nothing was written.',
      where: [],
    })
  })

  it('a dependent with no template has nothing to gate', () => {
    const { 'templates/repo.yaml': _gone, ...without } = files
    expect(refusal(planEdge(without, { from: 'repo', op: 'add', to: 'mongodb' }))).toMatchObject({
      code: 'no-template',
      reason: 'repo\'s template templates/repo.yaml is not in the chart, so there is nothing to gate. Nothing was written.',
    })
  })
})

describe('planEdge — an accepted edge is the descriptor and the gate, in one plan', () => {
  const files = edgeChart()

  it('screen 7: two files — the dependent gets ready: true, the target its readyWhen, and the template its gate (golden)', () => {
    const plan = accepted(planEdge(files, SCREEN_07))
    expect(Object.keys(plan.edit).sort()).toEqual([ARCHITECTURE_TEMPLATE_PATH, 'templates/localresource.yaml'])
    expect(plan.expect).toEqual({ [ARCHITECTURE_TEMPLATE_PATH]: files[ARCHITECTURE_TEMPLATE_PATH], 'templates/localresource.yaml': files['templates/localresource.yaml'] })
    expect(plan.edit['templates/localresource.yaml']).toBe(gatedGolden('localresource'))
    expect(plan.regated).toEqual([])
    const after = applyPlan(files, plan)
    expect(nodeIn(after, 'localresource').dependsOn).toEqual([{ ready: true, ref: 'repository' }])
    expect(nodeIn(after, 'repository').readyWhen).toBe('.status.default_branch')
    // Nothing else moved, and the chart is clean under every rule — the graph block the store
    // regenerated carries the edge, and every node is named as its template names its object.
    expect(Object.keys(after).filter((path) => after[path] !== files[path]).sort()).toEqual([ARCHITECTURE_TEMPLATE_PATH, 'templates/localresource.yaml'])
    expect(lintBlueprintDraft(after, 'blueprint')).toEqual([])
    expect(graphBlockIn(after[ARCHITECTURE_TEMPLATE_PATH])).toContain('"dependsOn" (list (dict "ref" "repository" "ready" true "all" false "active" true))')
  })

  it('the edge\'s when defaults to the target\'s own', () => {
    const plan = accepted(planEdge(files, { from: 'localresource', op: 'add', to: 'repo' }))
    expect(nodeIn(applyPlan(files, plan), 'localresource').dependsOn).toEqual([{ ref: 'repo', when: '.Values.source.url' }])
    expect(plan.edit['templates/localresource.yaml']).toContain('{{- if not (empty (dig "source" "url" "" ($.Values.AsMap))) -}}')
  })

  it('all is set whenever the target ranges', () => {
    const plan = accepted(planEdge(files, { from: 'mongodb', op: 'add', to: 'localresource' }))
    expect(nodeIn(applyPlan(files, plan), 'mongodb').dependsOn).toEqual([{ all: true, ref: 'localresource' }])
    expect(plan.edit['templates/mongodb.yaml']).toContain('{{- range $i, $f := (dig "files" (list) ($.Values.AsMap)) -}}\n{{- with $ -}}')
  })

  it('a readyWhen belongs to the target: every dependent waiting on it is re-gated, and listed', () => {
    const waited = applyPlan(files, planEdge(files, SCREEN_07))
    const second = applyPlan(waited, planEdge(waited, { from: 'repo', op: 'add', ready: true, to: 'repository' }))
    const plan = accepted(planEdge(second, { from: 'mongodb', op: 'add', ready: true, readyWhen: conditionReadyWhen('Ready'), to: 'repository' }))
    expect(plan.regated).toEqual(['repo', 'localresource'])
    expect(Object.keys(plan.edit).sort()).toEqual([ARCHITECTURE_TEMPLATE_PATH, 'templates/localresource.yaml', 'templates/mongodb.yaml', 'templates/repo.yaml'])
    for (const path of ['templates/localresource.yaml', 'templates/mongodb.yaml', 'templates/repo.yaml']) {
      expect(plan.edit[path]).toContain('(eq (toString .type) "Ready") (eq (toString .status) "True")')
      expect(plan.edit[path]).not.toContain('default_branch')
    }
    expect(lintBlueprintDraft(applyPlan(second, plan), 'blueprint')).toEqual([])
  })

  it('switching readiness off is one edit of the edge and the gate — an existence guard', () => {
    const waited = applyPlan(files, planEdge(files, SCREEN_07))
    const plan = accepted(planEdge(waited, { from: 'localresource', op: 'set', ready: false, to: 'repository' }))
    const after = applyPlan(waited, plan)
    expect(nodeIn(after, 'localresource').dependsOn).toEqual([{ ref: 'repository' }])
    expect(after['templates/localresource.yaml']).toContain('{{- if not $dep0 -}}{{- $gate = false -}}{{- end -}}')
    expect(after['templates/localresource.yaml']).not.toContain('default_branch')
  })

  it('removing the last dependency unwraps the template to its bytes before the gate; removing one of two regenerates', () => {
    const before = files['templates/localresource.yaml']
    const one = applyPlan(files, planEdge(files, SCREEN_07))
    const two = applyPlan(one, planEdge(one, { from: 'localresource', op: 'add', to: 'mongodb' }))
    const back = applyPlan(two, planEdge(two, { from: 'localresource', op: 'remove', to: 'mongodb' }))
    expect(back['templates/localresource.yaml']).toBe(one['templates/localresource.yaml'])
    const bare = applyPlan(back, planEdge(back, { from: 'localresource', op: 'remove', to: 'repository' }))
    expect(bare['templates/localresource.yaml']).toBe(before)
    expect(nodeIn(bare, 'localresource').dependsOn).toBeUndefined()
    // readyWhen stays the target's: removing an edge does not un-declare what "ready" means for it.
    expect(nodeIn(bare, 'repository').readyWhen).toBe('.status.default_branch')
  })

  it('a target with no name gets its template\'s — into the descriptor, so the graph block evaluates what the gate looks up', () => {
    const unnamed = editDescriptor(files, (nodes) => nodes.map((node) => (node.id === 'repository' ? { ...node, name: undefined } : node)))
    const after = applyPlan(unnamed, planEdge(unnamed, SCREEN_07))
    expect(nodeIn(after, 'repository').name).toBe(placedNameExpression('repository', false))
    expect(graphBlockIn(after[ARCHITECTURE_TEMPLATE_PATH])).toContain(`{{- $names = append $names (${placedNameExpression('repository', false)}) }}`)
    expect(lintBlueprintDraft(after, 'blueprint')).toEqual([])
    const nameless = { ...unnamed, 'templates/repository.yaml': unnamed['templates/repository.yaml'].replace(/ {2}name: \{\{[^\n]*/, '  name: {{ $x }}') }
    expect(refusal(planEdge(nameless, SCREEN_07))).toMatchObject({ code: 'no-name', path: 'templates/repository.yaml' })
  })
})

describe('planReadyWhen — a node\'s own readiness', () => {
  const files = edgeChart()
  const waited = applyPlan(files, planEdge(files, SCREEN_07))

  it('re-gates every dependent that waits for it to be ready', () => {
    const plan = accepted(planReadyWhen(waited, 'repository', '.status.html_url'))
    expect(plan.regated).toEqual(['localresource'])
    expect(plan.edit['templates/localresource.yaml']).toContain('dig "status" "html_url" "" $dep0')
  })

  it('refuses clearing it while something waits for it, and a no-op', () => {
    expect(refusal(planReadyWhen(waited, 'repository', null))).toMatchObject({
      code: 'needs-readyWhen',
      reason: 'localresource waits for repository to be ready, and without a readyWhen there is nothing to wait for — turn off their Wait for readiness first. Nothing was written.',
    })
    expect(refusal(planReadyWhen(waited, 'repository', '.status.default_branch')).code).toBe('unchanged')
  })
})

describe('planRemoveNode — Remove from chart (D19)', () => {
  it('drops the node, its template and every edge onto it — and re-gates (or ungates) its dependents', () => {
    const files = edgeChart()
    const before = files['templates/localresource.yaml']
    const waited = applyPlan(files, planEdge(files, SCREEN_07))
    const plan = planRemoveNode(waited, 'repository')
    if (!plan.ok) { throw new Error(plan.reason) }
    expect(plan.remove).toEqual(['templates/repository.yaml'])
    expect(plan.regated).toEqual(['localresource'])
    expect(plan.expect['templates/repository.yaml']).toBe(waited['templates/repository.yaml'])
    const after = applyPlan(waited, plan)
    expect(after['templates/repository.yaml']).toBeUndefined()
    expect(after['templates/localresource.yaml']).toBe(before)
    expect(nodeIn(after, 'localresource').dependsOn).toBeUndefined()
    expect(lintBlueprintDraft(after, 'blueprint')).toEqual([])
    // pullrequest still waits for localresource; removing that re-gates nothing it does not have to.
    const dropped = planRemoveNode(after, 'localresource')
    if (!dropped.ok) { throw new Error(dropped.reason) }
    expect(dropped.regated).toEqual(['pullrequest'])
    expect(applyPlan(after, dropped)['templates/pullrequest.yaml']).not.toContain(GATE_BEGIN)
  })
})

describe('planSetForEach — ranging a node an edge touches keeps every gate true', () => {
  const files = edgeChart()
  const waited = applyPlan(files, planEdge(files, SCREEN_07))

  it('a gated node: its gate comes off, the range changes, and the gate goes back INSIDE it', () => {
    const single = applyPlan(waited, accepted(planSetForEach(waited, 'localresource', null)))
    expect(single['templates/localresource.yaml']).not.toContain('{{- range')
    expect(single['templates/localresource.yaml'].startsWith('{{- /* krateo:placed')).toBe(true)
    expect(single['templates/localresource.yaml']).toContain(`${GATE_BEGIN}\n`)
    expect(lintBlueprintDraft(single, 'blueprint')).toEqual([])
    const ranged = applyPlan(single, accepted(planSetForEach(single, 'localresource', '.Values.files')))
    expect(ranged['templates/localresource.yaml']).toBe(gatedGolden('localresource'))
  })

  it('its dependents: every edge onto it gains or loses `all`, and their gates look up the names the chart now creates', () => {
    const plan = accepted(planSetForEach(waited, 'localresource', null))
    expect(plan.regated).toEqual(['pullrequest'])
    expect(Object.keys(plan.expect).sort()).toEqual([ARCHITECTURE_TEMPLATE_PATH, 'templates/localresource.yaml', 'templates/pullrequest.yaml'])
    expect(plan.expect['templates/pullrequest.yaml']).toBe(waited['templates/pullrequest.yaml'])
    const single = applyPlan(waited, plan)
    expect(nodeIn(single, 'pullrequest').dependsOn).toEqual([{ ref: 'localresource' }])
    expect(single['templates/pullrequest.yaml']).not.toContain('range $i, $f')
    expect(single['templates/pullrequest.yaml']).toContain(`lookup "git.krateo.io/v1alpha1" "LocalResource" $.Release.Namespace (${placedNameExpression('localresource', false)})`)
    expect(lintBlueprintDraft(single, 'blueprint')).toEqual([])
    const back = applyPlan(single, accepted(planSetForEach(single, 'localresource', '.Values.files')))
    expect(nodeIn(back, 'pullrequest').dependsOn).toEqual([{ all: true, ref: 'localresource' }])
    expect(back['templates/pullrequest.yaml']).toBe(waited['templates/pullrequest.yaml'])
  })

  it('a reshaped template is still refused in placing\'s words', () => {
    const reshaped = { ...waited, 'templates/localresource.yaml': `${waited['templates/localresource.yaml']}---\napiVersion: v1\nkind: ConfigMap\n` }
    expect(refusal(planSetForEach(reshaped, 'localresource', null))).toMatchObject({
      code: 'for-each',
      reason: 'templates/localresource.yaml has changed shape since it was placed — set forEach in Chart files.',
    })
  })
})

describe('legalEdgeTargets', () => {
  it('screen 6: from localresource — repository, repo and mongodb; pullrequest would be a cycle', () => {
    const files = edgeChart()
    const arch = { apiVersion: ARCHITECTURE_API_VERSION, chart: 'orders', kind: ARCHITECTURE_KIND, resources: ['repository', 'repo', 'localresource', 'pullrequest', 'mongodb'].map((id) => nodeIn(files, id)) }
    expect(legalEdgeTargets(arch, 'localresource')).toEqual({ legal: ['repository', 'repo', 'mongodb'], refused: { pullrequest: 'would be a cycle' } })
    expect(legalEdgeTargets(arch, 'pullrequest')).toEqual({ legal: ['repository', 'repo', 'mongodb'], refused: { localresource: 'already a dependency' } })
  })

  it('is O(V+E): over a 50-node chain, each node\'s edges are read a bounded number of times', () => {
    let reads = 0
    const chain: ResourceNode[] = Array.from({ length: 50 }, (_, idx) => {
      const resource: ResourceNode = { apiVersion: 'v1', class: 'native', id: `n${idx}`, kind: 'ConfigMap', name: `"n${idx}"`, template: `templates/n${idx}.yaml` }
      const deps = idx ? [{ ref: `n${idx - 1}` }] : undefined
      Object.defineProperty(resource, 'dependsOn', {
        enumerable: true,
        get: () => {
          reads += 1
          return deps
        },
      })
      return resource
    })
    const arch: ChartArchitecture = { apiVersion: ARCHITECTURE_API_VERSION, chart: 'chain', kind: ARCHITECTURE_KIND, resources: chain }
    const { legal, refused } = legalEdgeTargets(arch, 'n0')
    expect(legal).toEqual([])
    expect(Object.keys(refused)).toHaveLength(49)
    expect(reads).toBeLessThanOrEqual(chain.length)
    reads = 0
    expect(legalEdgeTargets(arch, 'n49')).toEqual({ legal: chain.slice(0, 48).map((resource) => resource.id), refused: { n48: 'already a dependency' } })
    expect(reads).toBeLessThanOrEqual(chain.length)
    // and the chart itself still parses and wraps — the chain is a real descriptor.
    expect(wrapAsConfigMapTemplate(serializeArchitecture(arch), 'chain')).toContain('n49')
  })
})
