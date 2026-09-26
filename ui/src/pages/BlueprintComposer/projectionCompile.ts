/**
 * STATUS PROJECTION, COMPILED (S12). The descriptor's graph and its `status:` section become the two
 * things a CompositionDefinition needs to project each composition's state into its own `.status`:
 * the chart's `<chart>-status` RESTAction, and the `apiRef` + `statusDataTemplate` that point at it.
 *
 * WHY COMPILED, NOT AUTHORED. core-provider generates the RESTAction's RBAC from snowplow's
 * dispatch-free `GET /rbac`: a stage with `dependsOn`, a `${…}` left after the extras, or a non-kube
 * path is ErrIncomplete, and the composition gets no RBAC at all (core-provider
 * internal/tools/restactionrbac/restactionrbac.go:26-31). So the S11 page action — which chains
 * arch → comp → objs — cannot be the apiRef. This one has only stages whose path is built from the
 * CDC's extras (`compositionName`, `compositionNamespace`, apiresolver.go:29-44) and what the
 * descriptor already says: the architecture ConfigMap, and one namespaced LIST per node kind.
 *
 * ONE COMPUTATION. The top filter is the S11 filter VERBATIM (architectureStateJq.ts), preceded by
 * one step that folds the LISTs into the shape it reads. The composition's `status.managed` is not
 * read — its plural is flect's, which this side cannot derive — so the listed objects stand in for
 * it: an instance the LISTs did not find reads as withheld. level, waitingOn and allReady are the
 * same either way (a withheld and a missing instance are both unsatisfied); only the phase label of
 * a missing object differs.
 */
/* eslint-disable no-template-curly-in-string -- the compiled RESTAction and statusDataTemplate ARE literal ${ jq } substitutions (snowplow and CDC syntax). */
import { dump } from 'js-yaml'

import type { ChartArchitecture, ProjectionRow, ProjectionType } from './architecture'
import { S11_ARCH_STEP_FILTER, S11_TOP_FILTER } from './architectureStateJq'

/** Where the RESTAction lives — the CompositionDefinition's namespace (decision D1 in the S12 spec). */
export const STATUS_RESTACTION_NAMESPACE = 'krateo-system'

export const statusRestActionName = (chart: string): string => `${chart}-status`

/** The chart-root file the RESTAction is committed as — never under templates/, never rendered with the chart. */
export const statusRestActionPath = (chart: string): string => `restaction.${statusRestActionName(chart)}.yaml`

/** A row as the CompositionDefinition carries it. */
export interface StatusFieldMapping {
  forPath: string
  expression: string
  type?: ProjectionType
}

export type ProjectionCompile =
  | {
    ok: true
    /** The RESTAction manifest, as the chart-root file holds it. */
    restaction: string
    path: string
    apiRef: { name: string; namespace: string; extras?: Record<string, string> }
    statusDataTemplate: StatusFieldMapping[]
  }
  | { ok: false; reason: string }

/** The architecture rows, always first. Types pin the generated CRD's status schema (statusfields.go). */
export const ARCHITECTURE_ROWS: readonly StatusFieldMapping[] = [
  { expression: '${ .api.level // 0 }', forPath: 'architectureLevel', type: 'integer' },
  { expression: '${ [ .api.waitingOn[]?.id ] }', forPath: 'waitingOn', type: 'array' },
  { expression: '${ .api.allReady == true }', forPath: 'architectureReady', type: 'boolean' },
]

const NAMESPACE = '((.compositionNamespace // .namespace) // "")'
const COMPOSITION = '((.compositionName // .name) // "")'

/** A namespaced collection path for an apiVersion + plural: core kinds live under /api, the rest under /apis. */
const listPath = (apiVersion: string, plural: string): string => {
  const root = apiVersion.includes('/') ? `/apis/${apiVersion}` : `/api/${apiVersion}`
  return `\${ "${root}/namespaces/" + ${NAMESPACE} + "/${plural}" }`
}

/** A LIST step's filter: each item reduced as S11's objs filter reduces it, stamped with the step's apiVersion (LIST items carry none). */
const listFilter = (step: string, apiVersion: string): string => [
  `[ (.${step}.items // [])[] | select(type == "object" and (.metadata.name // "") != "")`,
  `  | { apiVersion: ${JSON.stringify(apiVersion)},`,
  '      metadata: { name: .metadata.name, namespace: (.metadata.namespace // ""), creationTimestamp: (.metadata.creationTimestamp // "") },',
  '      status: (.status // {}) } ]',
].join('\n')

/**
 * The fold in front of the S11 filter: the LISTs become `.objs`, and what they found stands in for
 * `.comp[0].managed`. A LIST is allowed or refused as a WHOLE, so a refused one must not read as
 * "nothing rendered" — that would report every instance of the kind as unsatisfied, a claim about
 * objects that were not seen. Instead every name the graph gives that kind is marked rendered, and a
 * denial is written as S11's per-name `"<name>" is forbidden`: the instance reads unreadable
 * (unknown), and S11's own proof — a rendered dependent proves what it waited for — applies.
 */
const fold = (steps: readonly { step: string; ids: string[] }[]): string => [
  `${JSON.stringify(steps)} as $steps`,
  '| . as $in',
  '| ($in.arch.graph.nodes // []) as $gn',
  '| [ $steps[] | . as $s',
  '    | { ids: $s.ids,',
  '        items: ($in[$s.step] // [] | if type == "array" then . else [.] end),',
  '        errs: ([ $in[$s.step + "Err"] // [] ] | flatten) } ] as $by',
  '| [ $by[] | .items[] ] as $objs',
  '| [ $by[] | select(.errs | length > 0) | . as $b',
  '    | any(.errs[]; (type == "object" and ((.code // 0) == 403 or .reason == "Forbidden"))',
  '                   or (type == "string" and test("forbidden|not authorized"; "i"))) as $denied',
  '    | $gn[] | select(.present == true) | select(.id as $i | $b.ids | index($i) != null)',
  '    | { apiVersion, names: (.names // []), denied: $denied } ] as $unlisted',
  '| $in + { objs: $objs,',
  '          objErr: [ $unlisted[] | select(.denied) | .names[] | "\\"\\(.)\\" is forbidden: its kind could not be listed" ],',
  '          comp: [ { conditions: [],',
  '                    managed: ([ $objs[] | { apiVersion, name: .metadata.name, path: "listed" } ]',
  '                              + [ $unlisted[] | .apiVersion as $v | .names[] | { apiVersion: $v, name: ., path: "unlisted" } ]) } ] }',
].join('\n')

/**
 * Compile the projection for a chart, or say why not. A node with no `resource` (plural) cannot be
 * listed and is refused by id; a chart with nothing sequenced has no machine to project.
 */
export const compileProjection = (arch: ChartArchitecture): ProjectionCompile => {
  const sequenced = arch.resources.filter((node) => !node.lifecycle)
  if (!sequenced.length) {
    return { ok: false, reason: 'Nothing to project — the chart has no sequenced resources.' }
  }
  const unlisted = sequenced.filter((node) => !node.resource).map((node) => node.id)
  if (unlisted.length) {
    return { ok: false, reason: `Status projection lists each resource by its plural — add resource: to ${unlisted.join(', ')} in templates/architecture.yaml.` }
  }
  // One LIST per distinct (apiVersion, plural), in the descriptor's order.
  const kinds: { apiVersion: string; plural: string }[] = []
  for (const node of sequenced) {
    if (!kinds.some((kind) => kind.apiVersion === node.apiVersion && kind.plural === node.resource)) {
      kinds.push({ apiVersion: node.apiVersion, plural: node.resource as string })
    }
  }
  const steps = kinds.map((_, idx) => `o${idx}`)
  // Which nodes each LIST serves — the fold marks them when their LIST fails.
  const served = kinds.map((kind, idx) => ({
    ids: sequenced.filter((node) => node.apiVersion === kind.apiVersion && node.resource === kind.plural).map((node) => node.id),
    step: steps[idx],
  }))

  const api: Record<string, unknown>[] = []
  const archStep: Record<string, unknown> = {}
  archStep.name = 'arch'
  archStep.path = `\${ "/api/v1/namespaces/" + ${NAMESPACE} + "/configmaps/" + ${COMPOSITION} + "-architecture" }`
  archStep.verb = 'GET'
  archStep.headers = ['Accept: application/json']
  archStep.continueOnError = true
  archStep.errorKey = 'archErr'
  archStep.filter = S11_ARCH_STEP_FILTER
  api.push(archStep)
  kinds.forEach((kind, idx) => {
    const step: Record<string, unknown> = {}
    step.name = steps[idx]
    step.path = listPath(kind.apiVersion, kind.plural)
    step.verb = 'GET'
    step.headers = ['Accept: application/json']
    step.continueOnError = true
    step.errorKey = `${steps[idx]}Err`
    step.filter = listFilter(steps[idx], kind.apiVersion)
    api.push(step)
  })

  const name = statusRestActionName(arch.chart)
  const manifest: Record<string, unknown> = {}
  manifest.apiVersion = 'templates.krateo.io/v1'
  manifest.kind = 'RESTAction'
  const metadata: Record<string, unknown> = {}
  metadata.name = name
  metadata.namespace = STATUS_RESTACTION_NAMESPACE
  metadata.annotations = { 'krateo.io/generated-from': 'templates/architecture.yaml' }
  manifest.metadata = metadata
  const spec: Record<string, unknown> = {}
  spec.api = api
  spec.filter = `(\n${fold(served)}\n)\n| (\n${S11_TOP_FILTER}\n)\n`
  manifest.spec = spec

  const author: ProjectionRow[] = arch.status?.project ?? []
  const extras = arch.status?.extras
  return {
    apiRef: { name, namespace: STATUS_RESTACTION_NAMESPACE, ...(extras && Object.keys(extras).length ? { extras } : {}) },
    ok: true,
    path: statusRestActionPath(arch.chart),
    restaction: dump(manifest, { lineWidth: -1, noRefs: true, sortKeys: false }),
    statusDataTemplate: [...ARCHITECTURE_ROWS, ...author.map((row) => ({ ...row }))],
  }
}
