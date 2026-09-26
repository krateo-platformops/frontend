/**
 * The descriptor, compiled into the Helm block that resolves it per composition — the
 * `krateo:graph` block of templates/architecture.yaml. Pure.
 *
 * WHY A COMPILED BLOCK. `data.architecture` is plain text to Helm: nothing in it is evaluated,
 * because nothing in it is inside `{{ }}`. A node's `name` is therefore a bare Helm PIPELINE there
 * (`printf "%s-repo" .Values.name | trunc 63 | trimSuffix "-"`), not a name. The composition detail
 * page needs the names themselves — it finds each node's objects by them in `status.managed` — and
 * it needs to know which nodes this composition's values render at all. This block works both out
 * with the composition's own values, at render time, and stores the answer as JSON in `data.graph`.
 * "Names already resolved" is true of the ConfigMap only because of it.
 *
 * WHAT IT COMPILES, per node, in the descriptor's order:
 *   when       `.Values.a.b` → `not (empty (dig "a" "b" "" $v))`. `dig` over the values map is
 *              nil-safe: `.Values.a.b` itself fails the render when `a` is absent.
 *   names      evaluated only inside `if $present`, so a node the values switch off names nothing.
 *   forEach    a Values path ranges over `dig … (list) $v`; a helper name over
 *              `include "<helper>" $ | fromYamlArray`. The name is evaluated inside `with $`, so
 *              `.Values` is the root again inside the range while `$i` and `$f` stay in scope.
 *   dependsOn  `{ref, ready, all, active}`, `active` being the edge's own compiled `when` — the one
 *              condition gateGen wraps an edge in, so the page and the gate read an edge alike.
 *   level      from deriveStates; `states` names every level (unnamed ones as `level-<n>`).
 * The composition's own coordinates come from the `global` block CDC adds to every render; they are
 * empty under `helm template` and in the composer's Preview, which is expected. `v` versions the
 * JSON so the RESTAction that reads it can refuse a shape it does not know.
 *
 * THE BLOCK IS OWNED, like a gate block: it sits between two markers, it is regenerated from the
 * descriptor, and a hand edit to it is a lint problem (the block no longer equals this function's
 * output), never a second source of truth.
 *
 * Types only from architecture.ts: `wrapAsConfigMapTemplate` there calls this module, so a runtime
 * import back into it would be a cycle.
 */
import type { ChartArchitecture, DeriveResult, Dependency, ResourceNode } from './architecture'

export const GRAPH_BEGIN = '{{- /* krateo:graph begin — generated from data.architecture; edit the descriptor, not this block. */}}'
export const GRAPH_END = '{{- /* krateo:graph end */}}'

/** The block, markers included, wherever it sits in a template — the text the lint compares. */
const GRAPH_BLOCK = /^\{\{-\s*\/\*\s*krateo:graph begin[^\n]*\n[\s\S]*?^\{\{-\s*\/\*\s*krateo:graph end\s*\*\/\s*\}\}$/m

/** The values map inside the compiled block — `$v` is set once, at its top. */
const VALUES = '$v'

type Derived = Extract<DeriveResult, { ok: true }>

/**
 * A Go template string literal. JSON's escapes (`\"`, `\\`, `\n`, `\uXXXX` …) are a subset of Go's,
 * so JSON.stringify quotes any author text — a state name is free text — safely.
 */
const lit = (value: string): string => JSON.stringify(value)

/** `(list a b …)`, or `(list)` for none. */
const listOf = (items: string[]): string => (items.length ? `(list ${items.join(' ')})` : '(list)')

/** `.Values.a.b` → `"a" "b"`: the keys `dig` walks. The parser holds these paths to that shape. */
const valuesKeys = (path: string): string => path.replace(/^\.Values\./, '').split('.')
  .map(lit)
  .join(' ')

/**
 * Helm truthiness of a `.Values` path, nil-safe, over the values map `values` — `$v` in this block,
 * `(.Values.AsMap)` inside a template, where `$v` is not in scope. Shared with gateGen.
 */
export const valuesTruthy = (path: string, values: string): string => `not (empty (dig ${valuesKeys(path)} "" ${values}))`

/** What a `forEach` ranges over: a Values path (leading dot) or a named helper. Shared with gateGen. */
export const forEachSource = (forEach: string, values: string): string => (forEach.startsWith('.')
  ? `dig ${valuesKeys(forEach)} (list) ${values}`
  : `include ${lit(forEach)} $ | fromYamlArray`)

const edgeDict = (dep: Dependency): string =>
  `(dict "ref" ${lit(dep.ref)} "ready" ${dep.ready === true} "all" ${dep.all === true} "active" ${dep.when ? `(${valuesTruthy(dep.when, VALUES)})` : 'true'})`

/** The `$names = append …` line of a sequenced node, or null when it has no name to evaluate. */
const namesLine = (node: ResourceNode): string | null => {
  if (!node.name) {
    return null
  }
  const append = `{{- $names = append $names (${node.name}) }}`
  const body = node.forEach
    ? `{{- range $i, $f := (${forEachSource(node.forEach, VALUES)}) }}{{- with $ }}${append}{{- end }}{{- end }}`
    : append
  return node.when ? `{{- if $present }}${body}{{- end }}` : body
}

/**
 * One node's dict. Built as a list of pairs rather than an object literal: the key order is part of
 * the golden file, and this repo's lint alphabetises literal keys on `--fix`.
 */
const nodeDict = (node: ResourceNode, level: number | null, present: string, names: string): string => {
  const pairs: [string, string][] = [['id', lit(node.id)], ['apiVersion', lit(node.apiVersion)], ['kind', lit(node.kind)], ['class', lit(node.class)]]
  if (level !== null) { pairs.push(['level', String(level)]) }
  if (node.readyWhen) { pairs.push(['readyWhen', lit(node.readyWhen)]) }
  if (node.lifecycle) { pairs.push(['lifecycle', lit(node.lifecycle)]) }
  pairs.push(['forEach', String(Boolean(node.forEach))], ['present', present], ['names', names], ['dependsOn', listOf((node.dependsOn ?? []).map(edgeDict))])
  return `(dict ${pairs.map(([key, value]) => `${lit(key)} ${value}`).join(' ')})`
}

/**
 * The block for a descriptor that parsed and derived. `chart` is Chart.yaml's name — the label's
 * value and `graph.chart` — which the lint holds equal to the descriptor's own `chart`.
 */
export const compileGraphBlock = (arch: ChartArchitecture, derived: Derived, chart: string): string => {
  // Own keys only — `Object.entries` is, so an id like `constructor` reads its own level.
  const levels = new Map(Object.entries(derived.levels))
  const lines = [GRAPH_BEGIN, `{{- ${VALUES} := .Values.AsMap }}`, '{{- $nodes := list }}', '{{- $names := list }}']
  let presentDeclared = false
  let namesHeld = false
  for (const node of arch.resources) {
    if (node.lifecycle) {
      // Outside the sequence: no level, no names. `present` still answers its `when`, inline.
      const present = node.when ? `(${valuesTruthy(node.when, VALUES)})` : 'true'
      lines.push(`{{- $nodes = append $nodes ${nodeDict(node, null, present, '(list)')} }}`)
      continue
    }
    if (namesHeld) { lines.push('{{- $names = list }}') }
    lines.push(`{{- $present ${presentDeclared ? '=' : ':='} ${node.when ? valuesTruthy(node.when, VALUES) : 'true'} }}`)
    presentDeclared = true
    const names = namesLine(node)
    if (names) { lines.push(names) }
    lines.push(`{{- $nodes = append $nodes ${nodeDict(node, levels.get(node.id) ?? 0, '$present', '$names')} }}`)
    namesHeld = true
  }
  const composition = '(dict "apiVersion" ($g.compositionApiVersion | default "") "resource" ($g.compositionResource | default "") '
    + '"name" ($g.compositionName | default "") "namespace" .Release.Namespace "uid" ($g.compositionId | default ""))'
  const states = listOf(derived.states.map((state) => lit(state.name)))
  lines.push(`  graph: {{ dict "v" 1 "chart" ${lit(chart)} "states" ${states} "composition" ${composition} "nodes" $nodes | toJson | quote }}`)
  lines.push(GRAPH_END)
  return lines.join('\n')
}

/** The graph block a template carries now, markers included — or null when it carries none. */
export const graphBlockIn = (template: string): string | null => GRAPH_BLOCK.exec(template)?.[0] ?? null
