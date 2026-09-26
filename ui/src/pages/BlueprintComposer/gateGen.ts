/**
 * Compile an edge into the `lookup` gate a template needs — the authoring direction.
 *
 * The descriptor is the source; the gate is the compiled form. Each `dependsOn` becomes a `lookup` of
 * the target: guarded on its readiness when the edge says `ready` (its `readyWhen`, else its class
 * default — readyWhen.ts), on its existence when it does not. `all: true` over a `forEach` target
 * becomes the per-item range that `pullrequest.yaml:87-93` writes by hand today. CDC re-renders every
 * reconcile, so the guard is re-evaluated each pass and the resource appears the first pass after it
 * holds. Every guard folds into ONE `$gate` accumulator (S4 decision D8), and the manifest renders
 * inside `{{- if $gate }}`.
 *
 * THE BLOCK IS OWNED. It sits between two markers so it can be regenerated whenever the edge
 * changes and removed when the edge is — `GATE_BEGIN` is constant, because regeneration finds the
 * block by that exact text. A `lookup` OUTSIDE a marked block is never touched: a migrated chart keeps
 * its hand-written gate working while it is being described, and the preview reports it as an
 * unmanaged gate. Regeneration keeps every byte outside the block — the `{{- end }}` of a `range`
 * around it included.
 *
 * WHERE IT GOES. Around the manifest only (helmBlocks' `manifestSpan`): a template that ranges keeps
 * its `range` outside the gate, so each item is gated on its own pass — the shape of screen 7.
 *
 * NAMES come from the descriptor: each node's `name` is the Helm pipeline its template's
 * `metadata.name` evaluates (the lint holds the two equal), and for a `forEach` target it may use
 * `$i`/`$f` from the range. A target without one is refused: a gate that looks up a guessed name
 * never opens, and says nothing.
 *
 * ROOT-SCOPED THROUGHOUT (`scopeToRoot`). A gate inside a `range` sees the item as `.`, so the
 * namespace is `$.Release.Namespace`, the values map `$.Values.AsMap`, and every name and `when` is
 * rewritten to read from `$`. The per-item range of an `all` edge runs inside `with $` for the same
 * reason. `when` is the same nil-safe `dig` as the graph block's (graphCompile.ts), so the page and
 * the gate read an edge alike.
 */
import { ARCHITECTURE_TEMPLATE_PATH, type ChartArchitecture, type ResourceNode } from './architecture'
import { forEachSource, valuesTruthy } from './graphCompile'
import { manifestSpan } from './helmBlocks'
import { scopeToRoot } from './nameExpression'
import { existenceGuard, readinessGuard } from './readyWhen'

export const GATE_BEGIN = '{{- /* krateo:gate begin — generated from architecture.yaml; edit the descriptor, not this block. */}}'
export const GATE_END = '{{- /* krateo:gate end */}}'

/** The values map as a template reaches it, from anywhere in it. */
const TEMPLATE_VALUES = '($.Values.AsMap)'

/** Why a gate cannot be compiled: a target with no name, readiness with nothing to compile, or anything else about the edge's shape. */
export type GateRefusalCode = 'no-name' | 'needs-readyWhen' | 'shape'

export type GateResult = { ok: true; block: string } | { ok: false; reason: string; code: GateRefusalCode }

/**
 * The preamble that sets `$gate`, followed by the `if` that the template body goes inside. The
 * caller closes it with `GATE_END` after the body (see `applyGate`).
 */
export const renderGatePreamble = (node: ResourceNode, arch: ChartArchitecture): GateResult => {
  const deps = node.dependsOn ?? []
  if (!deps.length) {
    return { code: 'shape', ok: false, reason: `"${node.id}" has no dependsOn — nothing to gate` }
  }
  const lines: string[] = [GATE_BEGIN, '{{- $gate := true -}}']
  for (const [idx, dep] of deps.entries()) {
    const target = arch.resources.find((candidate) => candidate.id === dep.ref)
    if (!target) {
      return { code: 'shape', ok: false, reason: `"${dep.ref}" is not a resource of this chart` }
    }
    // The node's own field — never an index keyed by id, where `constructor`, `toString` … found
    // Object.prototype and spliced a Function's source into the lookup.
    if (!target.name) {
      return { code: 'no-name', ok: false, reason: `"${target.id}" has no name — the gate looks its object up by the name its template gives it` }
    }
    if (target.forEach && !dep.all) {
      return { code: 'shape', ok: false, reason: `"${target.id}" is one object per item of ${target.forEach}, so an edge onto it waits for every item — all: true` }
    }
    if (dep.all && !target.forEach) {
      return { code: 'shape', ok: false, reason: `"${dep.ref}" is not a forEach resource, so all: true has nothing to range over` }
    }
    const name = scopeToRoot(target.name)
    let guard = existenceGuard(target, idx, name)
    if (dep.ready) {
      const ready = readinessGuard(target, idx, name)
      if (!ready.ok) { return { code: 'needs-readyWhen', ok: false, reason: ready.reason } }
      guard = ready.lines
    }
    let body = dep.all
      ? [`{{- range $i, $f := (${forEachSource(target.forEach ?? '', TEMPLATE_VALUES)}) -}}`, '{{- with $ -}}', ...guard, '{{- end -}}', '{{- end -}}']
      : guard
    if (dep.when) {
      body = [`{{- if ${valuesTruthy(dep.when, TEMPLATE_VALUES)} -}}`, ...body, '{{- end -}}']
    }
    lines.push(...body)
  }
  lines.push('{{- if $gate }}')
  return { block: lines.join('\n'), ok: true }
}

export type ApplyResult = { ok: true; text: string } | { ok: false; reason: string }

const GATE_OPEN = '{{- if $gate }}\n'
/** What closes the gate's `if`, between the manifest and the end marker. */
const GATE_CLOSE = '\n{{- end }}\n'
/** The generated PREAMBLE only — begin marker through the `if $gate` line. The manifest between it and the end marker is the author's. */
const PREAMBLE = /\{\{-\s*\/\*\s*krateo:gate begin[\s\S]*?\{\{- if \$gate \}\}\n/

/** Every lookup that sits outside the generated preamble — what the preview verdict lists as unmanaged. */
export const unmanagedLookups = (template: string): number[] => {
  const masked = template.replace(PREAMBLE, (block) => block.replace(/lookup/g, 'LOOKUP_MANAGED'))
  return masked.split('\n').flatMap((line, idx) => (/\blookup\s+"/.test(line) ? [idx + 1] : []))
}

/**
 * Every hand-written lookup in a chart's templates, one sentence each — what the composer's Source tab
 * lists as unmanaged gates (the descriptor's own file aside).
 */
export const unmanagedGateNotes = (files: Readonly<Record<string, string>>): string[] => Object.keys(files).sort()
  .filter((path) => /^templates\/[^/]+\.ya?ml$/.test(path) && path !== ARCHITECTURE_TEMPLATE_PATH)
  .flatMap((path) => unmanagedLookups(files[path]).map((line) =>
    `Unmanaged gate — ${path}:${line}: a lookup outside a krateo:gate block. The composer leaves it alone; describe it in ${ARCHITECTURE_TEMPLATE_PATH} to manage it.`))

type Block = { ok: true; begin: number; open: number; end: number; body: string } | { ok: false; reason: string } | null

const MALFORMED = 'a krateo:gate block is present but malformed — regenerate it by hand once'

/** The marked block a template carries: where it begins, where the manifest opens and ends — or null. */
const markedBlock = (template: string): Block => {
  const begin = template.indexOf(GATE_BEGIN)
  if (begin < 0) { return null }
  const open = template.indexOf(GATE_OPEN, begin)
  const end = open < 0 ? -1 : template.indexOf(GATE_END, open)
  const between = end < 0 ? '' : template.slice(open + GATE_OPEN.length, end)
  if (end < 0 || !between.endsWith(GATE_CLOSE)) {
    return { ok: false, reason: MALFORMED }
  }
  return { begin, body: between.slice(0, -GATE_CLOSE.length), end, ok: true, open }
}

/**
 * Put the gate around the manifest. Regenerates in place when a marked block exists — the manifest
 * between the markers, and everything after the end marker, untouched — and refuses when an UNMARKED
 * lookup exists, because that gate belongs to a person. A first gate wraps the manifest span only,
 * so it sits inside any block the head leaves open.
 */
export const applyGate = (template: string, preamble: string): ApplyResult => {
  if (unmanagedLookups(template).length) {
    return { ok: false, reason: 'the template carries a lookup outside a krateo:gate block — an unmanaged gate is left alone' }
  }
  const block = markedBlock(template)
  if (block) {
    if (!block.ok) { return block }
    return { ok: true, text: `${template.slice(0, block.begin)}${preamble}\n${block.body}${GATE_CLOSE}${template.slice(block.end)}` }
  }
  const span = manifestSpan(template)
  if (!span.ok) { return span }
  const body = span.body.endsWith('\n') ? span.body.slice(0, -1) : span.body
  return { ok: true, text: `${span.head}${preamble}\n${body}${GATE_CLOSE}${GATE_END}\n${span.tail}` }
}

/**
 * The gate taken off: the manifest back where the block was, exactly — `applyGate` then `removeGate`
 * is the identity for a template that ends in a newline. A template with no block comes back as it is.
 */
export const removeGate = (template: string): ApplyResult => {
  const block = markedBlock(template)
  if (!block) { return { ok: true, text: template } }
  if (!block.ok) { return block }
  const after = template.slice(block.end + GATE_END.length)
  return { ok: true, text: `${template.slice(0, block.begin)}${block.body}\n${after.startsWith('\n') ? after.slice(1) : after}` }
}

/** 1-based line numbers, inclusive. */
export interface LineRange { from: number; to: number }

const lineOf = (template: string, offset: number): number => template.slice(0, offset).split('\n').length

/**
 * The generated lines of a template's gate — the preamble, and the `end` with the end marker — for
 * the Chart files highlight. Empty when it carries no well-formed block.
 */
export const gateLineRanges = (template: string): LineRange[] => {
  const block = markedBlock(template)
  if (!block?.ok) { return [] }
  const closeAt = block.open + GATE_OPEN.length + block.body.length + 1
  return [
    { from: lineOf(template, block.begin), to: lineOf(template, block.open) },
    { from: lineOf(template, closeAt), to: lineOf(template, block.end) },
  ]
}
