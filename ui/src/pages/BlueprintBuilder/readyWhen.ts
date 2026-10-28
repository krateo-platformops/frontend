/**
 * What "ready" means for a node — the readiness grammar, and the Helm guard it compiles to. Pure.
 *
 * TWO FORMS, AND ONLY TWO, because each must compile twice: into the `lookup` guard a gate withholds
 * a dependent with (Helm, here), and into the check the composition detail page runs over the live
 * object (jq, in the portal's RESTAction). Arbitrary jq compiles into no Helm guard, so it is not
 * offered (S4 decision D2):
 *
 *   field      `.status.a.b` — ready once that field is set (Helm-truthy). Each segment is a Go and a
 *              jq identifier: `.status.a-b` is `a - b` to jq.
 *   condition  `.status.conditions[] | select(.type == "Ready") | .status == "True"` — ready once the
 *              condition of that type is True. Offered only when the CRD declares `status.conditions`
 *              (D3); shown as `.status.conditions[type=Ready] == True`.
 *
 * WITH NO `readyWhen`, a node's CLASS decides: a composition is ready when Ready and Synced are both
 * True; a native kind the palette knows by its kstatus meaning (a Deployment is Available, a Job
 * Complete, a Service has endpoints …). A custom resource — or a native kind the table does not know —
 * has no default, and a `ready` edge onto it is REFUSED rather than silently weakened to existence.
 *
 * THE GUARD sets the template's `$gate` to false when the dependency is not there or not ready. It is
 * written with `$.` throughout: a gate may sit inside the dependent's own `range`, where `.` is the
 * item. The lookup's name is the caller's, already scoped the same way.
 */
import type { ResourceNode } from './architecture'
import { nativeKindOf, type NativeReadiness } from './nativeKinds'

/** `path` is every key from the object's root: `.status.a.b` is `['status', 'a', 'b']`. */
export type ReadyWhenForm = { kind: 'field'; path: string[] } | { kind: 'condition'; type: string }

const FIELD = /^\.status((?:\.[A-Za-z_][A-Za-z0-9_]*)+)$/
const CONDITION = /^\.status\.conditions\[\] \| select\(\.type == "(\w+)"\) \| \.status == "True"$/

/** What the grammar accepts, said once — the parser's message and the picker's refusal. */
export const READY_WHEN_EXPECTED = 'a status field (.status.ready) or a True condition (.status.conditions[] | select(.type == "Ready") | .status == "True")'

export const parseReadyWhen = (text: string): { ok: true; form: ReadyWhenForm } | { ok: false; reason: string } => {
  const field = FIELD.exec(text)
  if (field) {
    return { form: { kind: 'field', path: ['status', ...field[1].slice(1).split('.')] }, ok: true }
  }
  const condition = CONDITION.exec(text)
  if (condition) {
    return { form: { kind: 'condition', type: condition[1] }, ok: true }
  }
  return { ok: false, reason: `${JSON.stringify(text)} is not ${READY_WHEN_EXPECTED}` }
}

/** The condition form for a condition type. */
export const conditionReadyWhen = (type: string): string => `.status.conditions[] | select(.type == "${type}") | .status == "True"`

/** How a readyWhen reads to a person — the form's meaning, not its jq. */
export const readyWhenLabel = (text: string): string => {
  const parsed = parseReadyWhen(text)
  if (!parsed.ok) { return text }
  return parsed.form.kind === 'field' ? `${text} is set` : `.status.conditions[type=${parsed.form.type}] == True`
}

/** A readyWhen as a predicate to put after "has": the path itself, or the condition's label. */
export const readyWhenPredicate = (text: string): string => {
  const parsed = parseReadyWhen(text)
  return parsed.ok && parsed.form.kind === 'condition' ? readyWhenLabel(text) : text
}

/** The class default a node is ready by when it declares no readyWhen, in words — or null when it has none. */
export const defaultReadiness = (node: Pick<ResourceNode, 'apiVersion' | 'class' | 'kind'>): string | null => {
  if (node.class === 'composition') { return 'Ready=True and Synced=True' }
  const native = node.class === 'native' ? nativeKindOf(node.apiVersion, node.kind) : null
  return native ? `kstatus · ${native.label}` : null
}

/** What a node is ready by, in a word or two — the legal-target pill on its card. */
export const readinessShort = (node: Pick<ResourceNode, 'apiVersion' | 'class' | 'kind' | 'readyWhen'>): string => {
  if (node.readyWhen) {
    const parsed = parseReadyWhen(node.readyWhen)
    if (parsed.ok) {
      return parsed.form.kind === 'field' ? parsed.form.path[parsed.form.path.length - 1] : `${parsed.form.type}=True`
    }
    return node.readyWhen
  }
  if (node.class === 'composition') { return 'Ready+Synced' }
  const native = node.class === 'native' ? nativeKindOf(node.apiVersion, node.kind) : null
  return native ? native.label : 'no readyWhen'
}

const GATE_OFF = '{{- $gate = false -}}'

/** `"a" "b"` — the keys `dig` walks. */
const keys = (path: readonly string[]): string => path.map((segment) => JSON.stringify(segment)).join(' ')

const fieldGuard = (dep: string, path: readonly string[]): string =>
  `{{- if not (and ${dep} (dig ${keys(path)} "" ${dep})) -}}${GATE_OFF}{{- end -}}`

/** Ready once a condition of `type` is True: a flag set over the object's conditions, then checked. */
const conditionGuard = (dep: string, flag: string, type: string): string[] => [
  `{{- ${flag} := false -}}`,
  `{{- range (dig "status" "conditions" (list) ${dep}) -}}{{- if and (eq (toString .type) ${JSON.stringify(type)}) (eq (toString .status) "True") -}}{{- ${flag} = true -}}{{- end -}}{{- end -}}`,
  `{{- if not ${flag} -}}${GATE_OFF}{{- end -}}`,
]

/** The guard a native kind's kstatus meaning compiles to, after the lookup `dep`. */
const nativeGuard = (readiness: NativeReadiness, dep: string, idx: number, nameExpr: string): string[] => {
  switch (readiness) {
    case 'available':
      return conditionGuard(dep, `$ok${idx}Available`, 'Available')
    case 'complete':
      return conditionGuard(dep, `$ok${idx}Complete`, 'Complete')
    case 'readyReplicas':
      return [`{{- if not (and ${dep} (ge (int (dig "status" "readyReplicas" 0 ${dep})) (int (dig "spec" "replicas" 1 ${dep})))) -}}${GATE_OFF}{{- end -}}`]
    case 'endpoints':
      return [
        `{{- $ep${idx} := lookup "v1" "Endpoints" $.Release.Namespace (${nameExpr}) -}}`,
        `{{- if not (and ${dep} $ep${idx} (dig "subsets" (list) $ep${idx})) -}}${GATE_OFF}{{- end -}}`,
      ]
    case 'lbAddress':
      return [`{{- if not (and ${dep} (dig "status" "loadBalancer" "ingress" (list) ${dep})) -}}${GATE_OFF}{{- end -}}`]
    case 'bound':
      return [`{{- if not (and ${dep} (eq (toString (dig "status" "phase" "" ${dep})) "Bound")) -}}${GATE_OFF}{{- end -}}`]
    default:
      return [`{{- if not ${dep} -}}${GATE_OFF}{{- end -}}`]
  }
}

/** The lookup of the dependency — the `$dep<i>` every guard reads. */
export const dependencyLookup = (target: Pick<ResourceNode, 'apiVersion' | 'kind'>, idx: number, nameExpr: string): string =>
  `{{- $dep${idx} := lookup ${JSON.stringify(target.apiVersion)} ${JSON.stringify(target.kind)} $.Release.Namespace (${nameExpr}) -}}`

/** An existence-only edge: the dependency has to be there, nothing more. */
export const existenceGuard = (target: Pick<ResourceNode, 'apiVersion' | 'kind'>, idx: number, nameExpr: string): string[] =>
  [dependencyLookup(target, idx, nameExpr), `{{- if not $dep${idx} -}}${GATE_OFF}{{- end -}}`]

/**
 * A `ready` edge onto `target`: its lookup and the guard its readiness compiles to — its own
 * `readyWhen`, else its class default. Refused when there is nothing to compile, never weakened to
 * existence (an edge that says "ready" and checks "exists" opens a gate early, and says nothing).
 */
export const readinessGuard = (target: ResourceNode, idx: number, nameExpr: string): { ok: true; lines: string[] } | { ok: false; reason: string } => {
  const dep = `$dep${idx}`
  const lookup = dependencyLookup(target, idx, nameExpr)
  if (target.readyWhen) {
    const parsed = parseReadyWhen(target.readyWhen)
    if (!parsed.ok) {
      return { ok: false, reason: `"${target.id}" readyWhen: ${parsed.reason}` }
    }
    const guard = parsed.form.kind === 'field' ? [fieldGuard(dep, parsed.form.path)] : conditionGuard(dep, `$ok${idx}`, parsed.form.type)
    return { lines: [lookup, ...guard], ok: true }
  }
  if (target.class === 'composition') {
    return { lines: [lookup, ...conditionGuard(dep, `$ok${idx}Ready`, 'Ready'), ...conditionGuard(dep, `$ok${idx}Synced`, 'Synced')], ok: true }
  }
  const native = target.class === 'native' ? nativeKindOf(target.apiVersion, target.kind) : null
  if (native) {
    return { lines: [lookup, ...nativeGuard(native.readiness, dep, idx, nameExpr)], ok: true }
  }
  const why = target.class === 'custom' ? 'a custom resource has no default' : `${target.kind} has no readiness the composer knows`
  return { ok: false, reason: `ready: true onto "${target.id}" has nothing to wait for — ${why}; declare its readyWhen, or wait only for it to exist` }
}
