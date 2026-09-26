/**
 * The chart architecture file — parse, serialise, derive the state machine.
 *
 * WHAT THIS IS. A blueprint chart already contains a state machine: `builder-publish` renders five
 * different resource sets depending on `lookup` results that CDC re-evaluates every reconcile
 * (Repository first; LocalResources once it has a default branch; the PullRequest once every file
 * reports a commit). That machine lives only in `{{- if lookup }}` blocks spread across five
 * files, and `helm template` renders every `lookup` as nil, exit 0, so it cannot even be previewed
 * without a cluster. This module gives it a declared form.
 *
 * ONE SOURCE OF TRUTH. Authors declare EDGES (`dependsOn`) and READINESS (`readyWhen`). The
 * states are DERIVED — topological levels over the edges — never authored. `states[]` may only
 * NAME the levels the graph computes, so the picture and the text cannot disagree.
 *
 * WHERE IT LIVES. As the `data.architecture` block of `templates/architecture.yaml`, which renders a
 * ConfigMap per composition — so the composition detail page can read it through snowplow `/call`
 * under the user's own RBAC. The descriptor itself is plain text there; the generated
 * `krateo:graph` block after it (graphCompile.ts) is what resolves `.Values` and each node's
 * object names for the composition. `wrap`/`unwrap` below are that packaging; everything else here
 * works on the plain descriptor text.
 */
/* eslint-disable no-template-curly-in-string -- the status section's messages quote the ${ jq } syntax an expression must use. */
import { dump, load } from 'js-yaml'

import { compileGraphBlock, graphBlockIn } from './graphCompile'
import { parseReadyWhen, READY_WHEN_EXPECTED } from './readyWhen'

export const ARCHITECTURE_API_VERSION = 'architecture.krateo.io/v1alpha1'
export const ARCHITECTURE_KIND = 'ChartArchitecture'
export const ARCHITECTURE_TEMPLATE_PATH = 'templates/architecture.yaml'

/** What the palette placed. Decides the readiness DEFAULT when `readyWhen` is omitted. */
export type ResourceClass = 'native' | 'custom' | 'composition'

export interface Dependency {
  ref: string
  /** true: wait for the target's `readyWhen`; absent: the target only has to exist. */
  ready?: boolean
  /** Over a `forEach` target: every instance must satisfy the edge. */
  all?: boolean
  /** The edge applies only when this Values path is truthy (a Helm/jq path, e.g. `.Values.source.url`). */
  when?: string
}

export interface ResourceNode {
  id: string
  class: ResourceClass
  apiVersion: string
  kind: string
  template: string
  /**
   * The kind's plural, as the apiserver serves it (`repositories`, `deployments`) — the palette
   * writes it at placement. Status projection lists a node's objects by it, and a plural cannot be
   * derived from the kind: flect's rules and every CRD's own `names.plural` differ.
   */
  resource?: string
  /**
   * The Helm pipeline that names the object, bare — `printf "%s-repo" .Values.name | trunc 63 |
   * trimSuffix "-"` — exactly as the template's `metadata.name` writes it. Required on a sequenced
   * node (the lint's rule, not the parser's): the detail page finds a node's objects by it.
   */
  name?: string
  /** The resource renders only when this Values path is truthy. */
  when?: string
  /** The resource is rendered once per item of this list (the helper or Values path ranged over). */
  forEach?: string
  dependsOn?: Dependency[]
  /** jq path over the live object that means "ready", e.g. `.status.default_branch`. */
  readyWhen?: string
  /** `shim`: renders while a legacy reference exists — orthogonal to the sequence. */
  lifecycle?: 'shim' | 'descriptor'
}

/** A projected field's JSON-schema type (core-provider StatusFieldMapping.type; object/array keep any shape). */
export type ProjectionType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array'

/**
 * One `statusDataTemplate` row an author adds: a dotted path UNDER `.status` (core-provider's
 * `forPath`: `endpoint`, `network.host`) and the `${ jq }` that fills it.
 */
export interface ProjectionRow {
  forPath: string
  expression: string
  type?: ProjectionType
}

/**
 * Status projection (S12) — what the chart's CompositionDefinition projects into each composition's
 * `.status`, from the chart's `<chart>-status` RESTAction. The architecture rows are generated; these
 * are the author's own, plus the static `apiRef.extras` the RESTAction reads.
 */
export interface StatusProjection {
  extras?: Record<string, string>
  project?: ProjectionRow[]
}

export interface ChartArchitecture {
  apiVersion: string
  kind: string
  chart: string
  resources: ResourceNode[]
  states?: { name: string }[]
  status?: StatusProjection
}

export interface ArchitectureProblem {
  path: string
  message: string
}

export type ParseResult =
  | { ok: true; architecture: ChartArchitecture }
  | { ok: false; problems: ArchitectureProblem[] }

const CLASSES: ResourceClass[] = ['native', 'custom', 'composition']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The one id refused for its spelling. Ids key records here and in every consumer to come, and
 * `obj['__proto__'] = x` does not add a key — it tries to swap the object's prototype — so a
 * resource named that would silently vanish from any plain-object index. The code in this
 * directory survives it (deriveStates builds with a Map, `levelOf` reads own keys only); the next
 * consumer might not, and no chart needs the name. The other Object.prototype names (`constructor`,
 * `toString` …) are ordinary ids and must work: `levelOf` is what makes them.
 */
const RESERVED_ID = '__proto__'

/**
 * `when`, `forEach` and `readyWhen` are PATHS, written bare. The descriptor is itself a Helm
 * template, so an author reaching for `{{ .Values.x }}` gets one of two wrong things: unquoted, YAML
 * reads the braces as a flow mapping and the field silently becomes an object; quoted, Helm renders
 * the VALUE into the ConfigMap and the detail page reads `true` where it expected a path. Both are
 * refused with the same message, for an agent and a person alike.
 *
 * Each path also has a SHAPE, because the graph block compiles it: a `when` becomes a `dig` over the
 * values map one key per segment, a `readyWhen` a guard over the live object (readyWhen.ts: a status
 * field, or a True condition — the two forms both Helm and jq can compile), and a `forEach` either
 * that `dig` (a Values path) or an `include` (a named helper, as builder-publish ranges over
 * `builder-publish.files`). Anything else would compile to a template that does not render.
 */
const VALUES_PATH = /^\.Values(\.[A-Za-z0-9_-]+)+$/
const HELPER_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/

interface FieldRule {
  expected: string
  /** The shape a well-formed value has. Absent: any text that is not a Helm action. */
  shape?: (value: string) => boolean
}

const PATH_FIELDS: Record<'when' | 'forEach' | 'readyWhen', FieldRule> = {
  forEach: { expected: 'a bare path (.Values.files) or a named helper (builder-publish.files)', shape: (value) => VALUES_PATH.test(value) || HELPER_NAME.test(value) },
  readyWhen: { expected: READY_WHEN_EXPECTED, shape: (value) => parseReadyWhen(value).ok },
  when: { expected: 'a bare path, e.g. .Values.a.b', shape: (value) => VALUES_PATH.test(value) },
}

/**
 * `name` is a pipeline, not a path, so it has no shape to hold — but it is text Helm never
 * evaluates in the descriptor, and the graph block splices it into an action of its own, where a
 * brace pair or a line break would end that action early. Those are refused with the same message.
 */
const NAME_FIELD: FieldRule = { expected: 'a bare Helm pipeline, e.g. printf "%s-repo" .Values.name | trunc 63 | trimSuffix "-"' }

const HELM_ACTION = /\{\{|\}\}|\n/

/**
 * `template` is an ACTION, not a function, so it cannot sit where a name goes: the graph block and
 * the gate evaluate a name inside parentheses, and Helm refuses the whole chart when a `template` is
 * there — every render fails in architecture.yaml, not at the node. `include` names the same object
 * and can sit there; gateExtract reads `{{ template "x" . }}` as that.
 */
const TEMPLATE_ACTION = /^template\s/

const pathProblem = (value: unknown, { expected, shape }: FieldRule): string | null => {
  if (value === undefined) { return null }
  if (typeof value !== 'string' || HELM_ACTION.test(value)) {
    return `must be ${expected} — the descriptor takes only bare paths such as .Values.a.b, never a Helm action ({{ … }})`
  }
  return !shape || shape(value) ? null : `must be ${expected}`
}

/** Faults inside one resource's own fields that do not need the other resources to judge. */
const fieldProblems = (entry: Record<string, unknown>, at: string): ArchitectureProblem[] => {
  const problems: ArchitectureProblem[] = []
  for (const [field, rule] of [...Object.entries(PATH_FIELDS), ['name', NAME_FIELD] as const]) {
    const message = pathProblem(entry[field], rule)
    if (message) { problems.push({ message, path: `${at}.${field}` }) }
  }
  if (typeof entry.name === 'string' && TEMPLATE_ACTION.test(entry.name)) {
    problems.push({ message: 'must name the object with include, not template — include "x" . is the same object; template is an action, and Helm refuses one where the graph block evaluates the name', path: `${at}.name` })
  }
  if (Array.isArray(entry.dependsOn)) {
    const firstAt = new Map<string, number>()
    entry.dependsOn.forEach((dep, depIdx) => {
      if (!isRecord(dep) || typeof dep.ref !== 'string') { return }
      const message = pathProblem(dep.when, PATH_FIELDS.when)
      if (message) { problems.push({ message, path: `${at}.dependsOn[${depIdx}].when` }) }
      // One edge per dependency: a repeat is either a mistake or a second, conflicting `ready`.
      const first = firstAt.get(dep.ref)
      if (first !== undefined) {
        problems.push({ message: `"${dep.ref}" is already listed at dependsOn[${first}] — one entry per dependency`, path: `${at}.dependsOn[${depIdx}]` })
      } else {
        firstAt.set(dep.ref, depIdx)
      }
    })
  }
  return problems
}

/** Why nothing can wait on a lifecycle node — the parser's words, and planEdge's. */
export const lifecycleRefusal = (id: string, lifecycle: string): string =>
  `"${id}" is lifecycle: ${lifecycle} — orthogonal to the sequence, so nothing can wait on it`

/** A DNS-1123 label: what the apiserver serves a resource's plural as. */
const PLURAL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

/** A projection row's forPath: dotted keys under `.status`, written without it (`endpoint`, `network.host`). */
const STATUS_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/

/** The status fields the controller owns — core-provider refuses a forPath whose top segment is one (statusfields.go:26-34). */
const RESERVED_STATUS = ['helmChartUrl', 'helmChartVersion', 'digest', 'previousDigest', 'managed', 'conditions', 'observedGeneration']

const PROJECTION_TYPES: ProjectionType[] = ['string', 'integer', 'number', 'boolean', 'object', 'array']

/** A projection expression: one `${ … }` substitution, the CDC's own syntax. */
const JQ_SUBSTITUTION = /^\$\{[\s\S]*\}$/

/**
 * The forPaths the architecture rows write — an author row may not take one. Not `workloadHealthy`:
 * the portal's compositions tile reads `workloadHealthy: false` as failed (portal 1.5.51), and a
 * machine that is still moving through its states is not failing.
 */
export const GENERATED_STATUS_PATHS = ['architectureLevel', 'waitingOn', 'architectureReady']

/** The `status:` section, or undefined when absent. Faults are appended to `problems`. */
const parseStatus = (raw: unknown, problems: ArchitectureProblem[]): StatusProjection | undefined => {
  if (raw === undefined) { return undefined }
  if (!isRecord(raw)) {
    problems.push({ message: 'must be a mapping', path: 'status' })
    return undefined
  }
  const out: StatusProjection = {}
  if (raw.extras !== undefined) {
    if (!isRecord(raw.extras) || Object.values(raw.extras).some((value) => typeof value !== 'string')) {
      problems.push({ message: 'must map names to strings — the static extras the RESTAction reads', path: 'status.extras' })
    } else {
      out.extras = raw.extras as Record<string, string>
    }
  }
  if (raw.project !== undefined) {
    if (!Array.isArray(raw.project)) {
      problems.push({ message: 'must be a list of { forPath, expression }', path: 'status.project' })
    } else {
      const rows: ProjectionRow[] = []
      raw.project.forEach((row, idx) => {
        const at = `status.project[${idx}]`
        if (!isRecord(row)) {
          problems.push({ message: 'must be a mapping', path: at })
          return
        }
        if (typeof row.forPath !== 'string' || !STATUS_PATH.test(row.forPath)) {
          problems.push({ message: 'must be dotted keys under .status, written without it — e.g. endpoint or network.host', path: `${at}.forPath` })
        } else if (GENERATED_STATUS_PATHS.includes(row.forPath)) {
          problems.push({ message: `${row.forPath} is generated from the architecture — project another field`, path: `${at}.forPath` })
        } else if (RESERVED_STATUS.includes(row.forPath.split('.')[0])) {
          problems.push({ message: `${row.forPath.split('.')[0]} is the controller's own status field — core-provider refuses the CompositionDefinition`, path: `${at}.forPath` })
        } else if (rows.some((taken) => taken.forPath === row.forPath)) {
          problems.push({ message: `${row.forPath} is already projected — one row per field`, path: `${at}.forPath` })
        }
        if (row.type !== undefined && !PROJECTION_TYPES.includes(row.type as ProjectionType)) {
          problems.push({ message: `one of ${PROJECTION_TYPES.join(' | ')}`, path: `${at}.type` })
        }
        if (typeof row.expression !== 'string' || !JQ_SUBSTITUTION.test(row.expression.trim())) {
          problems.push({ message: 'must be one ${ jq } substitution — e.g. ${ .api.nodes | length }', path: `${at}.expression` })
        }
        if (typeof row.forPath === 'string' && typeof row.expression === 'string') {
          rows.push({ expression: row.expression.trim(), forPath: row.forPath, ...(PROJECTION_TYPES.includes(row.type as ProjectionType) ? { type: row.type as ProjectionType } : {}) })
        }
      })
      out.project = rows
    }
  }
  return out
}

/** Parse the descriptor text. Every structural fault is reported by path; nothing is guessed. */
export const parseArchitecture = (text: string): ParseResult => {
  let raw: unknown
  try {
    raw = load(text)
  } catch (err) {
    return { ok: false, problems: [{ message: `not YAML: ${err instanceof Error ? err.message : String(err)}`, path: '' }] }
  }
  const problems: ArchitectureProblem[] = []
  if (!isRecord(raw)) {
    return { ok: false, problems: [{ message: 'the descriptor must be a mapping', path: '' }] }
  }
  if (raw.apiVersion !== ARCHITECTURE_API_VERSION) {
    problems.push({ message: `expected ${ARCHITECTURE_API_VERSION}`, path: 'apiVersion' })
  }
  if (raw.kind !== ARCHITECTURE_KIND) {
    problems.push({ message: `expected ${ARCHITECTURE_KIND}`, path: 'kind' })
  }
  if (typeof raw.chart !== 'string' || !raw.chart) {
    problems.push({ message: 'chart name is required', path: 'chart' })
  }
  if (!Array.isArray(raw.resources)) {
    problems.push({ message: 'resources must be a list', path: 'resources' })
    return { ok: false, problems }
  }
  const ids = new Set<string>()
  const resources: ResourceNode[] = []
  // Each kept resource's index in the RAW list, so a path still names the right entry when a
  // malformed one before it was skipped.
  const positions: number[] = []
  raw.resources.forEach((entry, idx) => {
    const at = `resources[${idx}]`
    if (!isRecord(entry)) {
      problems.push({ message: 'must be a mapping', path: at })
      return
    }
    for (const key of ['id', 'apiVersion', 'kind', 'template'] as const) {
      if (typeof entry[key] !== 'string' || !entry[key]) {
        problems.push({ message: 'required', path: `${at}.${key}` })
      }
    }
    if (!CLASSES.includes(entry.class as ResourceClass)) {
      problems.push({ message: `one of ${CLASSES.join(' | ')}`, path: `${at}.class` })
    }
    if (typeof entry.id === 'string') {
      if (ids.has(entry.id)) {
        problems.push({ message: `duplicate id "${entry.id}"`, path: `${at}.id` })
      }
      if (entry.id === RESERVED_ID) {
        problems.push({ message: `"${RESERVED_ID}" is reserved — any other name`, path: `${at}.id` })
      }
      ids.add(entry.id)
    }
    if (entry.dependsOn !== undefined) {
      if (!Array.isArray(entry.dependsOn)) {
        problems.push({ message: 'must be a list', path: `${at}.dependsOn` })
      } else {
        entry.dependsOn.forEach((dep, depIdx) => {
          if (!isRecord(dep) || typeof dep.ref !== 'string') {
            problems.push({ message: 'needs a ref', path: `${at}.dependsOn[${depIdx}]` })
          }
        })
      }
    }
    if (entry.resource !== undefined && (typeof entry.resource !== 'string' || !PLURAL.test(entry.resource))) {
      problems.push({ message: 'must be the plural the apiserver serves, lowercase — e.g. repositories', path: `${at}.resource` })
    }
    if (entry.lifecycle !== undefined && entry.lifecycle !== 'shim' && entry.lifecycle !== 'descriptor') {
      problems.push({ message: 'shim | descriptor', path: `${at}.lifecycle` })
    }
    problems.push(...fieldProblems(entry, at))
    resources.push(entry as unknown as ResourceNode)
    positions.push(idx)
  })
  // A ref must name a node — and `ready: true` onto a node with no readiness is a promise with
  // nothing to check, so it is refused here rather than discovered as a gate that never opens.
  for (const [nodeIdx, node] of resources.entries()) {
    const deps: unknown[] = Array.isArray(node.dependsOn) ? node.dependsOn : []
    for (const [depIdx, dep] of deps.entries()) {
      // Not a mapping with a ref: already reported above as "needs a ref" — and not safe to read.
      if (!isRecord(dep) || typeof dep.ref !== 'string') { continue }
      const target = resources.find((candidate) => candidate.id === dep.ref)
      const at = `resources[${positions[nodeIdx]}].dependsOn[${depIdx}]`
      if (!target) {
        problems.push({ message: `"${dep.ref}" is not a resource of this chart`, path: at })
      } else if (target.lifecycle && target !== node) {
        // A lifecycle node is outside the sequence (deriveStates skips it), so an edge onto it
        // would order nothing while reading as if it did.
        problems.push({ message: lifecycleRefusal(dep.ref, target.lifecycle), path: at })
      } else if (dep.ready && !target.readyWhen && target.class === 'custom') {
        problems.push({ message: `ready: true needs a readyWhen on "${dep.ref}" — a custom resource has no default`, path: at })
      }
      if (dep.ref === node.id) {
        problems.push({ message: 'a resource cannot depend on itself', path: at })
      }
    }
  }
  const status = parseStatus(raw.status, problems)
  if (problems.length) {
    return { ok: false, problems }
  }
  const states = Array.isArray(raw.states)
    ? raw.states.filter(isRecord).map((state) => ({ name: typeof state.name === 'string' ? state.name : '' }))
    : undefined
  return {
    architecture: { apiVersion: ARCHITECTURE_API_VERSION, chart: String(raw.chart), kind: ARCHITECTURE_KIND, resources, states, ...(status ? { status } : {}) },
    ok: true,
  }
}

/**
 * Stable key order, so a regenerated file diffs by meaning and not by serialiser mood. The order
 * is built by ASSIGNMENT, not by an object literal: this repo's lint alphabetises literal keys on
 * `--fix`, and the file's key order is part of its format.
 */
const resourceEntry = (node: ResourceNode): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  out.id = node.id
  out.class = node.class
  out.apiVersion = node.apiVersion
  out.kind = node.kind
  out.template = node.template
  if (node.resource) { out.resource = node.resource }
  if (node.name) { out.name = node.name }
  if (node.when) { out.when = node.when }
  if (node.forEach) { out.forEach = node.forEach }
  if (node.dependsOn?.length) {
    out.dependsOn = node.dependsOn.map((dep) => {
      const edge: Record<string, unknown> = {}
      edge.ref = dep.ref
      if (dep.ready) { edge.ready = true }
      if (dep.all) { edge.all = true }
      if (dep.when) { edge.when = dep.when }
      return edge
    })
  }
  if (node.readyWhen) { out.readyWhen = node.readyWhen }
  if (node.lifecycle) { out.lifecycle = node.lifecycle }
  return out
}

/** One resource's entry, as the descriptor serialises it — what "What just happened" shows. */
export const serializeResource = (node: ResourceNode): string => dump([resourceEntry(node)], { lineWidth: 120, noRefs: true, sortKeys: false })

export const serializeArchitecture = (arch: ChartArchitecture): string => {
  const resources = arch.resources.map(resourceEntry)
  const doc: Record<string, unknown> = {}
  doc.apiVersion = arch.apiVersion
  doc.kind = arch.kind
  doc.chart = arch.chart
  doc.resources = resources
  if (arch.states?.length) { doc.states = arch.states }
  if (arch.status && (arch.status.extras || arch.status.project?.length)) {
    const status: Record<string, unknown> = {}
    if (arch.status.extras) { status.extras = arch.status.extras }
    if (arch.status.project?.length) {
      status.project = arch.status.project.map((row) => {
        const entry: Record<string, unknown> = {}
        entry.forPath = row.forPath
        entry.expression = row.expression
        if (row.type) { entry.type = row.type }
        return entry
      })
    }
    doc.status = status
  }
  return dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false })
}

export interface DerivedState {
  level: number
  name: string
  /** Resource ids that render in this state (cumulative: everything at this level or below). */
  renders: string[]
  /** Resource ids withheld until a later state. */
  withheld: string[]
}

export type DeriveResult =
  | { ok: true; states: DerivedState[]; levels: Record<string, number> }
  | { ok: false; cycle: string[] }

/**
 * A resource's derived level, or undefined when it has none (orthogonal, unknown, or the graph has
 * a cycle). Read `levels` through this, never `levels[id]` or `id in levels`: a resource id is
 * author text, and for `constructor`, `toString`, `valueOf` … both of those find Object.prototype —
 * a Function where a level should be, which turned a level into NaN and emptied every state.
 */
export const levelOf = (levels: Record<string, number>, id: string): number | undefined =>
  (Object.prototype.hasOwnProperty.call(levels, id) ? levels[id] : undefined)

/** Nodes that take part in the sequence: shims and the descriptor itself are orthogonal to it. */
const sequenced = (arch: ChartArchitecture): ResourceNode[] => arch.resources.filter((node) => !node.lifecycle)

/**
 * Levels are the longest path from a root: a node sits one level past the deepest thing it waits
 * on. An existence-only edge still orders (the target must exist first), so it counts the same.
 * A cycle has no levels and is reported with its members rather than silently dropped.
 */
export const deriveStates = (arch: ChartArchitecture): DeriveResult => {
  const nodes = sequenced(arch)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  // A Map while computing: see `levelOf` for what an object index does with `constructor`.
  const levels = new Map<string, number>()
  const levelAt = (id: string): number => levels.get(id) ?? 0
  const visiting = new Set<string>()
  const visit = (id: string, trail: string[]): string[] | null => {
    if (levels.has(id)) { return null }
    if (visiting.has(id)) { return [...trail, id] }
    visiting.add(id)
    const node = byId.get(id)
    let level = 0
    for (const dep of node?.dependsOn ?? []) {
      if (!byId.has(dep.ref)) { continue }
      const cycle = visit(dep.ref, [...trail, id])
      if (cycle) { return cycle }
      level = Math.max(level, levelAt(dep.ref) + 1)
    }
    visiting.delete(id)
    levels.set(id, level)
    return null
  }
  for (const node of nodes) {
    const cycle = visit(node.id, [])
    if (cycle) {
      const start = cycle.indexOf(cycle[cycle.length - 1])
      return { cycle: cycle.slice(start), ok: false }
    }
  }
  const max = nodes.length ? Math.max(...levels.values()) : -1
  const states: DerivedState[] = []
  for (let level = 0; level <= max; level += 1) {
    const renders = nodes.filter((node) => levelAt(node.id) <= level).map((node) => node.id)
    const withheld = nodes.filter((node) => levelAt(node.id) > level).map((node) => node.id)
    states.push({ level, name: arch.states?.[level]?.name || `level-${level}`, renders, withheld })
  }
  // A plain record for callers (and toEqual). fromEntries DEFINES each key, so even an id that
  // assignment would mishandle lands as an own key; read it back with `levelOf`.
  return { levels: Object.fromEntries(levels), ok: true, states }
}

/**
 * The graph block for a descriptor, or null when there is none to compile: a descriptor that does
 * not parse, or whose dependencies loop, has no levels to give it. The lint names those faults.
 */
export const graphBlockFor = (descriptor: string, chart: string): string | null => {
  try {
    const parsed = parseArchitecture(descriptor)
    const derived = parsed.ok ? deriveStates(parsed.architecture) : null
    return parsed.ok && derived?.ok ? compileGraphBlock(parsed.architecture, derived, chart) : null
  } catch {
    return null
  }
}

/**
 * The template that carries the descriptor into the cluster: a ConfigMap per composition, holding
 * the descriptor verbatim in `data.architecture` and, after it, the generated `krateo:graph` block
 * (graphCompile.ts) that resolves it into `data.graph` with the composition's own values.
 *
 * NAMED FOR THE COMPOSITION, `<compositionName>-architecture`, so the detail page can compute the
 * name from the composition it is showing. The release name cannot be computed there: CDC hashes it
 * whenever `safe-release-name` is on (its default). `compositionName` is in the `global` block CDC
 * adds to every render; `helm template` and the composer's Preview have none, and fall back to the
 * release name. No `trunc`: CDC caps the composition name at 63 characters (it is a label value),
 * so the whole name stays far below the 253 a ConfigMap may have.
 *
 * The label value is QUOTED. Kubernetes decodes manifests as YAML 1.1, where a bare `on`, `yes`,
 * `n`, `true` or `null` is a bool or null, not a string — and a label value that is not a string
 * fails the apply. Those are all valid chart names, so the value is written as a JSON string
 * (a YAML double-quoted scalar). Unwrapping never read the label, so templates written before the
 * quoting unwrap unchanged.
 *
 * A FRESH wrap is `wrapAsConfigMapTemplate(unwrapFromConfigMapTemplate(x), chart)`, and it is
 * idempotent: the descriptor goes back verbatim, and everything around it is a function of it and
 * the chart name. `chart` is Chart.yaml's name — the lint holds the descriptor's `chart` to it. A
 * file already held is regenerated in place instead (regenerateGraphBlock, below).
 */
export const wrapAsConfigMapTemplate = (descriptor: string, chart: string): string => {
  const body = descriptor.trimEnd().split('\n').map((line) => `    ${line}`)
    .join('\n')
  const graph = graphBlockFor(descriptor, chart)
  return [
    '{{- /* Rendered per composition so the detail page can read the chart architecture through',
    "       snowplow /call under the caller's own RBAC. Edit data.architecture; the composer owns the rest. */}}",
    '{{- $g := .Values.global | default dict }}',
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    '  name: {{ printf "%s-architecture" ($g.compositionName | default .Release.Name) }}',
    '  namespace: {{ .Release.Namespace }}',
    '  labels:',
    `    krateo.io/architecture: ${JSON.stringify(chart)}`,
    'data:',
    '  architecture: |',
    body,
    ...(graph === null ? [] : [graph]),
    '',
  ].join('\n')
}

/** Where the `data.architecture` block header sits — the one line unwrap and rewrap both key on. */
const BLOCK_HEADER = /^\s{2}architecture:\s*\|\n([\s\S]*)$/m

/** The inverse: the descriptor text out of the template, or null when the template is not ours. */
export const unwrapFromConfigMapTemplate = (template: string): string | null => {
  const found = BLOCK_HEADER.exec(template)
  if (!found) { return null }
  const out: string[] = []
  for (const line of found[1].split('\n')) {
    if (line.trim() === '' && out.length === 0) { continue }
    if (!line.startsWith('    ') && line.trim() !== '') { break }
    out.push(line.slice(4))
  }
  return `${out.join('\n').trimEnd()}\n`
}

/** The label line the wrapper writes, whatever value it carries now. */
const LABEL_LINE = /^(\s+krateo\.io\/architecture:)[^\n]*$/m

/**
 * REGENERATION in place: the `krateo:graph` block recompiled from the descriptor the template carries
 * NOW, and the label set to `chart` — every other byte of the file kept, because once a chart is held
 * the file is its author's, and a label or a comment added around the ConfigMap is theirs to keep.
 * The draft store runs this on every write to a held chart (blueprintDraft's regenerateArchitecture),
 * so the block follows each edit of data.architecture and of Chart.yaml's name, whoever made it.
 *
 * A template with NO block is written fresh around its descriptor: that is the wrapper from before
 * the block existed, whose header declares no `$g` for the block to read and names the ConfigMap for
 * the release, which the detail page cannot compute.
 *
 * The template comes back unchanged when there is nothing to compile — not ours, a descriptor that
 * does not parse, a cycle: the lint names those, and a guessed block would hide them. `chart` null
 * (Chart.yaml names nothing) compiles with the descriptor's own `chart`, as the lint does. Never
 * throws: it runs inside the store's write.
 */
export const regenerateGraphBlock = (template: string, chart: string | null): string => {
  try {
    const descriptor = unwrapFromConfigMapTemplate(template)
    const parsed = descriptor === null ? null : parseArchitecture(descriptor)
    if (descriptor === null || !parsed?.ok) { return template }
    const name = chart ?? parsed.architecture.chart
    const graph = graphBlockFor(descriptor, name)
    const current = graphBlockIn(template)
    if (graph === null) { return template }
    if (current === null) { return wrapAsConfigMapTemplate(descriptor, name) }
    // Replaced by a function: the block is full of `$`, which a replacement STRING reads as patterns.
    return template.replace(current, () => graph).replace(LABEL_LINE, (_line, key: string) => `${key} ${JSON.stringify(name)}`)
  } catch {
    return template
  }
}

/**
 * The inverse of `unwrapFromConfigMapTemplate`, for a template that is ALREADY in the chart: the
 * `data.architecture` block replaced by `descriptor`, and every other byte of the file kept.
 *
 * NOT `wrapAsConfigMapTemplate` again. The wrapper is the composer's, but the file is the author's
 * once it is held: a label added, a comment above the ConfigMap, a second key under `data` — any of
 * them would be thrown away by writing the wrapper fresh on every placement. The block is exactly
 * the lines `unwrap` reads — the header, then every line indented four spaces or blank, up to the
 * first line that is neither — and blank lines trailing it belong to what follows.
 *
 * Null when the template carries no block: the caller refuses, as the canvas does.
 */
export const rewrapDescriptor = (template: string, descriptor: string): string | null => {
  const found = BLOCK_HEADER.exec(template)
  if (!found) { return null }
  const start = found.index + found[0].length - found[1].length
  const lines = found[1].split('\n')
  let taken = 0
  for (const [idx, line] of lines.entries()) {
    if (line.trim() !== '' && !line.startsWith('    ')) { break }
    if (line.trim() !== '') { taken = idx + 1 }
  }
  const end = start + lines.slice(0, taken).join('\n').length
  const body = descriptor.trimEnd().split('\n').map((line) => `    ${line}`)
    .join('\n')
  return `${template.slice(0, start)}${body}${template.slice(end)}`
}
