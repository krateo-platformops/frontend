/**
 * A placement, held — S4a's batch on S11a's graph block.
 *
 * Placing writes two files at once (the template and the descriptor) through the draft store's
 * `applyFiles`, and the descriptor is rewritten in place (rewrapDescriptor), which leaves the
 * `krateo:graph` block as it was. The block is the store's to regenerate, on a batch as on a
 * single-file save — and the placed node must be NAMED as its template names its object, or the lint
 * refuses the chart (L1, L4) and the detail page would look for objects the chart never creates.
 *
 * So, for each class the palette places — native, custom, composition — and for a node ranged over
 * a Values path and over a helper: the chart the store holds after the gesture lints clean under
 * every rule, and its graph block evaluates the node's own name expression.
 */
import { describe, expect, it } from 'vitest'

import { lintBlueprintDraft } from '../../components/Autopilot/blueprintDraft'
import { createBlueprintDraftStore } from '../../components/Autopilot/blueprintDraftStore'
import { extractCrdSpecFields } from '../../components/Autopilot/describeResource'

import { CRDS } from './__fixtures__/s4a'
import { ARCHITECTURE_TEMPLATE_PATH, parseArchitecture, unwrapFromConfigMapTemplate, wrapAsConfigMapTemplate, type ResourceNode } from './architecture'
import { extractNameExpression } from './gateExtract'
import { graphBlockIn } from './graphCompile'
import { placedNameExpression } from './naming'
import { planPlace, setForEach, type PalettePick, type PlacePlan } from './planPlace'
import { startChart } from './startChart'

const CHART = 'orders'
/** The helper a helper-ranged node ranges over — a chart's own, as builder-publish's `builder-publish.files` is. */
const HELPERS = `{{- define "${CHART}.files" -}}\n{{- toYaml (.Values.files | default list) }}\n{{- end }}\n`

const repository: PalettePick = { apiVersion: 'github.krateo.io/v2022-11-28', cls: 'custom', group: 'github.krateo.io', kind: 'Repository', plural: 'repositories' }
const localResource: PalettePick = { apiVersion: 'git.krateo.io/v1alpha1', cls: 'custom', group: 'git.krateo.io', kind: 'LocalResource', plural: 'localresources' }
const builderPublish: PalettePick = { apiVersion: 'composition.krateo.io/v1-8-40', blueprint: 'builder-publish', cls: 'composition', kind: 'BuilderPublish', plural: 'builderpublishes' }
const deployment: PalettePick = { apiVersion: 'apps/v1', cls: 'native', kind: 'Deployment', plural: 'deployments' }

const specOf = (crd: string, version: string) => extractCrdSpecFields(CRDS[crd], version)

/** A started chart, held as the provider holds it — with a helpers file for the helper range. */
const heldChart = () => {
  const started = startChart({ description: '', name: CHART, version: '0.1.0' })
  if (!started.ok) { throw new Error('fixture chart refused') }
  const store = createBlueprintDraftStore()
  store.set({ ...started.files, 'templates/_helpers.tpl': HELPERS }, 'blueprint')
  return store
}

type Store = ReturnType<typeof heldChart>

const files = (store: Store): Record<string, string> => store.get()?.files ?? {}

/** The plan, applied as the provider's batch handler applies it: one applyFiles. */
const apply = (store: Store, plan: PlacePlan): void => {
  if (!plan.ok) { throw new Error(plan.reason) }
  const result = store.applyFiles({ add: plan.add, edit: plan.edit })
  if (!result.ok) { throw new Error(result.error) }
}

const nodeOf = (store: Store, id: string): ResourceNode | undefined => {
  const parsed = parseArchitecture(unwrapFromConfigMapTemplate(files(store)[ARCHITECTURE_TEMPLATE_PATH]) ?? '')
  return parsed.ok ? parsed.architecture.resources.find((node) => node.id === id) : undefined
}

/**
 * What Helm evaluates a placed name to, for release `release` and item `index` — `printf`, Sprig's
 * `trunc` and `trimSuffix "-"` (one dash), for the two shapes naming.ts writes.
 */
const evaluate = (expression: string, release: string, index: number): string => {
  const trimmed = (text: string, width: string) => text.slice(0, Number(width)).replace(/-$/, '')
  const single = /^printf "%s-([^"%]+)" \$\.Release\.Name \| trunc (\d+) \| trimSuffix "-"$/.exec(expression)
  if (single) { return trimmed(`${release}-${single[1]}`, single[2]) }
  const item = /^printf "%s-([^"%]*)%d" \(printf "%s-([^"%]+)" \$\.Release\.Name \| trunc (\d+) \| trimSuffix "-"\) \(int \$i\)$/.exec(expression)
  if (item) { return `${trimmed(`${release}-${item[2]}`, item[3])}-${item[1]}${index}` }
  throw new Error(`not a placed name: ${expression}`)
}

/** The block's line that collects a single node's names. */
const namesLine = (name: string): string => `{{- $names = append $names (${name}) }}`

describe('a placement regenerates the graph block and names its objects', () => {
  const classes: [string, PalettePick, ReturnType<typeof specOf>][] = [
    ['a native Deployment', deployment, null],
    ['a custom Repository (repositories.github.krateo.io)', repository, specOf('repositories.github.krateo.io', 'v2022-11-28')],
    ['a composition, BuilderPublish at v1-8-40', builderPublish, specOf('builderpublishes.composition.krateo.io', 'v1-8-40')],
  ]
  for (const [what, pick, spec] of classes) {
    it(`${what}: the held chart lints clean, and its block names the object as the template does`, () => {
      const store = heldChart()
      const plan = planPlace(files(store), pick, spec)
      apply(store, plan)
      const id = plan.ok ? plan.id : ''
      const name = placedNameExpression(id, false)
      expect(nodeOf(store, id)?.name).toBe(name)
      expect(extractNameExpression(files(store)[`templates/${id}.yaml`])).toBe(name)
      const block = graphBlockIn(files(store)[ARCHITECTURE_TEMPLATE_PATH]) ?? ''
      expect(block).toContain(`"id" "${id}" "apiVersion" "${pick.apiVersion}" "kind" "${pick.kind}" "class" "${pick.cls}"`)
      expect(block).toContain(namesLine(name))
      // Exactly the file a single-file save of the same descriptor holds: a fresh wrap of it.
      const descriptor = unwrapFromConfigMapTemplate(files(store)[ARCHITECTURE_TEMPLATE_PATH]) ?? ''
      expect(files(store)[ARCHITECTURE_TEMPLATE_PATH]).toBe(wrapAsConfigMapTemplate(descriptor, CHART))
      expect(lintBlueprintDraft(files(store), 'blueprint')).toEqual([])
    })
  }

  const ranges: [string, string, string][] = [
    ['a Values path', '.Values.files', `range $i, $f := (dig "files" (list) $v)`],
    ['a named helper', `${CHART}.files`, `range $i, $f := (include "${CHART}.files" $ | fromYamlArray)`],
  ]
  for (const [what, forEach, range] of ranges) {
    it(`a node ranged over ${what}: the per-item name, in the descriptor and the block, and the chart lints clean`, () => {
      const store = heldChart()
      apply(store, planPlace(files(store), localResource, specOf('localresources.git.krateo.io', 'v1alpha1')))
      apply(store, setForEach(files(store), 'localresource', forEach))
      const name = placedNameExpression('localresource', true)
      expect(nodeOf(store, 'localresource')).toMatchObject({ forEach, name })
      expect(extractNameExpression(files(store)['templates/localresource.yaml'])).toBe(name)
      expect(graphBlockIn(files(store)[ARCHITECTURE_TEMPLATE_PATH])).toContain(`{{- ${range} }}{{- with $ }}${namesLine(name)}{{- end }}{{- end }}`)
      expect(lintBlueprintDraft(files(store), 'blueprint')).toEqual([])

      // …and cleared again: the single name back in both, still clean.
      apply(store, setForEach(files(store), 'localresource', null))
      expect(nodeOf(store, 'localresource')?.name).toBe(placedNameExpression('localresource', false))
      expect(graphBlockIn(files(store)[ARCHITECTURE_TEMPLATE_PATH])).toContain(namesLine(placedNameExpression('localresource', false)))
      expect(lintBlueprintDraft(files(store), 'blueprint')).toEqual([])
    })
  }

  it('two Deployments, the first ranged: no item of it is named what the second names its object', () => {
    const store = heldChart()
    apply(store, planPlace(files(store), deployment, null))
    apply(store, planPlace(files(store), deployment, null))
    apply(store, setForEach(files(store), 'deployment', '.Values.envs'))
    const ranged = nodeOf(store, 'deployment')?.name ?? ''
    const second = nodeOf(store, 'deployment-2')?.name ?? ''
    // The names as the templates write them — what the cluster gets.
    expect(extractNameExpression(files(store)['templates/deployment.yaml'])).toBe(ranged)
    expect(extractNameExpression(files(store)['templates/deployment-2.yaml'])).toBe(second)
    const items = Array.from({ length: 12 }, (_, index) => evaluate(ranged, 'orders-1', index))
    expect(items.slice(0, 3)).toEqual(['orders-1-deployment-i0', 'orders-1-deployment-i1', 'orders-1-deployment-i2'])
    expect(evaluate(second, 'orders-1', 0)).toBe('orders-1-deployment-2')
    expect(items).not.toContain(evaluate(second, 'orders-1', 0))
    expect(lintBlueprintDraft(files(store), 'blueprint')).toEqual([])

    // A chart whose ranged name is the bare index — S4a's first form, or one the agent writes — is
    // refused by the lint (L5, per item), since item 2 would be deployment-2's object.
    const bare = 'printf "%s-%d" (printf "%s-deployment" $.Release.Name | trunc 56 | trimSuffix "-") (int $i)'
    const rewritten = Object.fromEntries(Object.entries(files(store)).map(([path, text]) => [path, text.split(ranged).join(bare)]))
    store.set(rewritten, 'blueprint')
    expect(evaluate(bare, 'orders-1', 2)).toBe(evaluate(second, 'orders-1', 0))
    expect(lintBlueprintDraft(files(store), 'blueprint')).toEqual([
      `${ARCHITECTURE_TEMPLATE_PATH}: resources[0].name — one object per item of .Values.envs, and item 2 is named <release>-deployment-2, the name resources[1] (deployment-2) gives its object: the cluster would hold one object for both, and the detail page could not tell them apart. Rename one of them — in its template and here, together.`,
    ])
  })

  it('two of a kind, and one of each class, in one chart: every name distinct (L5) and the chart clean', () => {
    const store = heldChart()
    for (const [pick, spec] of [[repository, specOf('repositories.github.krateo.io', 'v2022-11-28')], [repository, specOf('repositories.github.krateo.io', 'v2022-11-28')], [deployment, null], [builderPublish, null]] as const) {
      apply(store, planPlace(files(store), pick, spec))
    }
    const block = graphBlockIn(files(store)[ARCHITECTURE_TEMPLATE_PATH]) ?? ''
    for (const id of ['repository', 'repository-2', 'deployment', 'builderpublish']) {
      expect(block).toContain(namesLine(placedNameExpression(id, false)))
    }
    expect(lintBlueprintDraft(files(store), 'blueprint')).toEqual([])
  })
})
