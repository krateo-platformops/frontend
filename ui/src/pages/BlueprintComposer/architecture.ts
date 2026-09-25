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
 * ConfigMap per composition with `.Values` and resource names already resolved — so the composition
 * detail page can read it through snowplow `/call` under the user's own RBAC. `wrap`/`unwrap` below
 * are that packaging; everything else here works on the plain descriptor text.
 */
import { dump, load } from 'js-yaml'

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

export interface ChartArchitecture {
  apiVersion: string
  kind: string
  chart: string
  resources: ResourceNode[]
  states?: { name: string }[]
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
 * `when`, `forEach` and `readyWhen` are PATHS, written bare. The descriptor is itself a Helm
 * template, so an author reaching for `{{ .Values.x }}` gets one of two wrong things: unquoted, YAML
 * reads the braces as a flow mapping and the field silently becomes an object; quoted, Helm renders
 * the VALUE into the ConfigMap and the detail page reads `true` where it expected a path. Both are
 * refused with the same message, for an agent and a person alike.
 */
const PATH_FIELDS: Record<'when' | 'forEach' | 'readyWhen', string> = {
  forEach: 'a bare path, e.g. .Values.files',
  readyWhen: 'a bare jq path over the live object, e.g. .status.ready',
  when: 'a bare path, e.g. .Values.a.b',
}

const pathProblem = (value: unknown, expected: string): string | null => {
  if (value === undefined) { return null }
  if (typeof value !== 'string' || value.includes('{{')) {
    return `must be ${expected} — the descriptor takes only bare paths such as .Values.a.b, never a Helm action ({{ … }})`
  }
  return null
}

/** Faults inside one resource's own fields that do not need the other resources to judge. */
const fieldProblems = (entry: Record<string, unknown>, at: string): ArchitectureProblem[] => {
  const problems: ArchitectureProblem[] = []
  for (const [field, expected] of Object.entries(PATH_FIELDS)) {
    const message = pathProblem(entry[field], expected)
    if (message) { problems.push({ message, path: `${at}.${field}` }) }
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
        problems.push({ message: `"${dep.ref}" is lifecycle: ${target.lifecycle} — orthogonal to the sequence, so nothing can wait on it`, path: at })
      } else if (dep.ready && !target.readyWhen && target.class === 'custom') {
        problems.push({ message: `ready: true needs a readyWhen on "${dep.ref}" — a custom resource has no default`, path: at })
      }
      if (dep.ref === node.id) {
        problems.push({ message: 'a resource cannot depend on itself', path: at })
      }
    }
  }
  if (problems.length) {
    return { ok: false, problems }
  }
  const states = Array.isArray(raw.states)
    ? raw.states.filter(isRecord).map((state) => ({ name: typeof state.name === 'string' ? state.name : '' }))
    : undefined
  return {
    architecture: { apiVersion: ARCHITECTURE_API_VERSION, chart: String(raw.chart), kind: ARCHITECTURE_KIND, resources, states },
    ok: true,
  }
}

/**
 * Stable key order, so a regenerated file diffs by meaning and not by serialiser mood. The order
 * is built by ASSIGNMENT, not by an object literal: this repo's lint alphabetises literal keys on
 * `--fix`, and the file's key order is part of its format.
 */
export const serializeArchitecture = (arch: ChartArchitecture): string => {
  const resources = arch.resources.map((node) => {
    const out: Record<string, unknown> = {}
    out.id = node.id
    out.class = node.class
    out.apiVersion = node.apiVersion
    out.kind = node.kind
    out.template = node.template
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
  })
  const doc: Record<string, unknown> = {}
  doc.apiVersion = arch.apiVersion
  doc.kind = arch.kind
  doc.chart = arch.chart
  doc.resources = resources
  if (arch.states?.length) { doc.states = arch.states }
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
  const levels: Record<string, number> = {}
  const visiting = new Set<string>()
  const visit = (id: string, trail: string[]): string[] | null => {
    if (id in levels) { return null }
    if (visiting.has(id)) { return [...trail, id] }
    visiting.add(id)
    const node = byId.get(id)
    let level = 0
    for (const dep of node?.dependsOn ?? []) {
      if (!byId.has(dep.ref)) { continue }
      const cycle = visit(dep.ref, [...trail, id])
      if (cycle) { return cycle }
      level = Math.max(level, levels[dep.ref] + 1)
    }
    visiting.delete(id)
    levels[id] = level
    return null
  }
  for (const node of nodes) {
    const cycle = visit(node.id, [])
    if (cycle) {
      const start = cycle.indexOf(cycle[cycle.length - 1])
      return { cycle: cycle.slice(start), ok: false }
    }
  }
  const max = nodes.length ? Math.max(...Object.values(levels)) : -1
  const states: DerivedState[] = []
  for (let level = 0; level <= max; level += 1) {
    const renders = nodes.filter((node) => levels[node.id] <= level).map((node) => node.id)
    const withheld = nodes.filter((node) => levels[node.id] > level).map((node) => node.id)
    states.push({ level, name: arch.states?.[level]?.name || `level-${level}`, renders, withheld })
  }
  return { levels, ok: true, states }
}

/**
 * The template that carries the descriptor into the cluster: a ConfigMap per composition. The
 * block is indented verbatim, so `.Values` references inside it render with the composition's own
 * values — that is what "stored in the chart, retrieved when deployed" means in practice.
 */
export const wrapAsConfigMapTemplate = (descriptor: string, chart: string): string => {
  const body = descriptor.trimEnd().split('\n').map((line) => `    ${line}`)
    .join('\n')
  return [
    '{{- /* Rendered per composition so the detail page can read the chart architecture through',
    "       snowplow /call under the caller's own RBAC. Edit data.architecture; the composer owns the rest. */}}",
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    '  name: {{ printf "%s-architecture" .Release.Name | trunc 63 | trimSuffix "-" }}',
    '  namespace: {{ .Release.Namespace }}',
    '  labels:',
    `    krateo.io/architecture: ${chart}`,
    'data:',
    '  architecture: |',
    body,
    '',
  ].join('\n')
}

/** The inverse: the descriptor text out of the template, or null when the template is not ours. */
export const unwrapFromConfigMapTemplate = (template: string): string | null => {
  const found = /^\s{2}architecture:\s*\|\n([\s\S]*)$/m.exec(template)
  if (!found) { return null }
  const out: string[] = []
  for (const line of found[1].split('\n')) {
    if (line.trim() === '' && out.length === 0) { continue }
    if (!line.startsWith('    ') && line.trim() !== '') { break }
    out.push(line.slice(4))
  }
  return `${out.join('\n').trimEnd()}\n`
}
