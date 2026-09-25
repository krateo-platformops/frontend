/**
 * Compile an edge into the `lookup` gate a template needs — the authoring direction.
 *
 * The descriptor is the source; the gate is the compiled form. Each `dependsOn` with `ready: true`
 * becomes a `lookup` of the target guarded on its `readyWhen`; an existence-only edge becomes a
 * bare `lookup`; `all: true` over a `forEach` target becomes the per-item range that
 * `pullrequest.yaml:87-93` writes by hand today. CDC re-renders every reconcile, so the guard is
 * re-evaluated each pass and the resource appears the first pass after it holds.
 *
 * THE BLOCK IS OWNED. It sits between two markers so it can be regenerated whenever the edge
 * changes and removed when the edge is. A `lookup` OUTSIDE a marked block is never touched: a
 * migrated chart keeps its hand-written gate working while it is being described, and the preview
 * verdict reports it as an unmanaged gate.
 *
 * NAMES. The descriptor does not carry object names; the gate needs them. `names` maps a resource
 * id to the Helm expression that names it (`printf "%s-repo" .Values.name | trunc 63 …`), and for a
 * `forEach` target the expression may use `$i`/`$f` from the range.
 */
import type { ChartArchitecture, Dependency, ResourceNode } from './architecture'

export const GATE_BEGIN = '{{- /* krateo:gate begin — generated from architecture.yaml; edit the descriptor, not this block. */}}'
export const GATE_END = '{{- /* krateo:gate end */}}'

/** Helm expressions that name each resource, by id. Absent: the gate cannot be rendered. */
export type NameExpressions = Record<string, string>

export type GateResult = { ok: true; block: string } | { ok: false; reason: string }

const readyGuard = (dep: Dependency, target: ResourceNode, nameExpr: string, varName: string): string[] => {
  const lookup = `{{- ${varName} := lookup "${target.apiVersion}" "${target.kind}" .Release.Namespace (${nameExpr}) -}}`
  const field = target.readyWhen?.replace(/^\.status\./, '')
  if (!dep.ready || !field) {
    return [lookup, `{{- if not ${varName} -}}{{- $gate = false -}}{{- end -}}`]
  }
  const digs = field.split('.').map((segment) => `"${segment}"`).join(' ')
  return [lookup, `{{- if not (and ${varName} (dig "status" ${digs} "" ${varName})) -}}{{- $gate = false -}}{{- end -}}`]
}

/**
 * The preamble that sets `$gate`, followed by the `if` that the template body goes inside. The
 * caller closes it with `GATE_END` after the body (see `applyGate`).
 */
export const renderGatePreamble = (node: ResourceNode, arch: ChartArchitecture, names: NameExpressions): GateResult => {
  const deps = node.dependsOn ?? []
  if (!deps.length) {
    return { ok: false, reason: `"${node.id}" has no dependsOn — nothing to gate` }
  }
  const lines: string[] = [GATE_BEGIN, '{{- $gate := true -}}']
  for (const [idx, dep] of deps.entries()) {
    const target = arch.resources.find((candidate) => candidate.id === dep.ref)
    if (!target) {
      return { ok: false, reason: `"${dep.ref}" is not a resource of this chart` }
    }
    // Own keys only. A resource id is author text, and `names[id]` for `constructor`, `toString` …
    // finds Object.prototype: a Function where the expression should be, which is truthy, so the
    // missing name was not refused and the Function's source was spliced into the lookup. (Object.hasOwn
    // is ES2022; this project's lib is ES2020 — the same call architecture.ts's levelOf makes.)
    const nameExpr = Object.prototype.hasOwnProperty.call(names, target.id) ? names[target.id] : undefined
    if (!nameExpr) {
      return { ok: false, reason: `no name expression for "${target.id}"` }
    }
    const guard = readyGuard(dep, target, nameExpr, `$dep${idx}`)
    let body = guard
    if (dep.all) {
      if (!target.forEach) {
        return { ok: false, reason: `"${dep.ref}" is not a forEach resource, so all: true has nothing to range over` }
      }
      body = [`{{- range $i, $f := (include "${target.forEach}" $ | fromYamlArray) -}}`, ...guard, '{{- end -}}']
    }
    if (dep.when) {
      body = [`{{- if ${dep.when} -}}`, ...body, '{{- end -}}']
    }
    lines.push(...body)
  }
  lines.push('{{- if $gate }}')
  return { block: lines.join('\n'), ok: true }
}

export type ApplyResult = { ok: true; text: string } | { ok: false; reason: string }

const GATE_OPEN = '{{- if $gate }}\n'
/** The generated PREAMBLE only — begin marker through the `if $gate` line. The manifest between it and the end marker is the author's. */
const PREAMBLE = /\{\{-\s*\/\*\s*krateo:gate begin[\s\S]*?\{\{- if \$gate \}\}\n/

/** Every lookup that sits outside the generated preamble — what the preview verdict lists as unmanaged. */
export const unmanagedLookups = (template: string): number[] => {
  const masked = template.replace(PREAMBLE, (block) => block.replace(/lookup/g, 'LOOKUP_MANAGED'))
  return masked.split('\n').flatMap((line, idx) => (/\blookup\s+"/.test(line) ? [idx + 1] : []))
}

/**
 * Put the gate around the manifest: preamble before the first document, `{{- end }}` + end marker
 * after it. Regenerates in place when a marked block exists — keeping the manifest between the
 * markers untouched — and refuses when an UNMARKED lookup exists, because that gate belongs to a
 * person.
 */
export const applyGate = (template: string, preamble: string): ApplyResult => {
  if (unmanagedLookups(template).length) {
    return { ok: false, reason: 'the template carries a lookup outside a krateo:gate block — an unmanaged gate is left alone' }
  }
  const begin = template.indexOf(GATE_BEGIN)
  if (begin >= 0) {
    const endMarker = template.indexOf(GATE_END)
    const open = template.indexOf(GATE_OPEN, begin)
    if (endMarker < 0 || open < 0 || open > endMarker) {
      return { ok: false, reason: 'a krateo:gate block is present but malformed — regenerate it by hand once' }
    }
    const body = template.slice(open + GATE_OPEN.length, endMarker).replace(/\n\{\{- end \}\}\n?$/, '')
    return { ok: true, text: `${template.slice(0, begin)}${preamble}\n${body.trimEnd()}\n{{- end }}\n${GATE_END}\n` }
  }
  const bodyStart = template.search(/^(---|apiVersion:)/m)
  if (bodyStart < 0) {
    return { ok: false, reason: 'no manifest found in the template' }
  }
  const head = template.slice(0, bodyStart)
  const body = template.slice(bodyStart).trimEnd()
  return { ok: true, text: `${head}${preamble}\n${body}\n{{- end }}\n${GATE_END}\n` }
}
