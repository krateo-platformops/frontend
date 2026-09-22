/**
 * The two AUTHORING ops an agent can ask for, as pure functions.
 *
 * WHY THEY LIVE HERE. `PageComposer` hit its 500-line cap when these branches were added, and the
 * cap was right to complain: deciding what a proposal MEANS is not the same job as rendering a
 * composer, and mixing them is what made the existing branches hard to test — every assertion
 * needed a mounted component and a dispatched event.
 *
 * WHY THEY ARE PURE. Both answer with a description of what should happen, and neither touches the
 * draft. The caller emits. That keeps the decision — which is the part with the rules in it —
 * testable without a DOM, and it keeps the emission ordering (RESTAction before widget) in one
 * place where it is already documented.
 */
import type { TreeNode } from './objectTree'
import {
  generateRestAction, setApiRef, setDataTemplate, setRefsTemplate, validateDataTemplate, validateRefsTemplate,
} from './restActionDraft'
import { WIDGET_KINDS } from './widgetKinds.generated'

/** The name rule the drop form uses; shared so a person and an agent cannot disagree about it. */
export const DNS_1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

export interface AddWidgetOp {
  kind: string
  name: string
  widgetData?: Record<string, unknown>
}

export type AuthorWidgetResult =
  | { ok: true; kind: string; resource: string; authored: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * What a `addWidget` proposal resolves to, or why it cannot.
 *
 * The kind is matched against the GENERATED CRD table rather than a list written here, so a kind
 * added to the chart becomes authorable by an agent with no code change — the property the palette
 * already has.
 *
 * REQUIRED ARRAYS DEFAULT TO EMPTY, exactly as the drop form does for a person. A Table's `columns`
 * and a chart's `data` are what `widgetDataTemplate` fills from a RESTAction's result, so demanding
 * them here would make the agent hand-write the thing it is about to bind — and would put the same
 * fourteen kinds out of reach that #353 restored, this time for the agent only.
 */
export const authorWidget = (op: AddWidgetOp, isTaken: (name: string) => boolean): AuthorWidgetResult => {
  const kind = Object.keys(WIDGET_KINDS).find((known) => known.toLowerCase() === op.kind.toLowerCase())
  if (!kind) {
    return { error: `"${op.kind}" is not a widget kind this portal knows`, ok: false }
  }
  if (!DNS_1123.test(op.name)) {
    return { error: `"${op.name}" cannot be a resource name — lower-case letters, digits and dashes only`, ok: false }
  }
  if (isTaken(op.name)) {
    return { error: `"${op.name}" is already in this draft — pick another name, or bind data to the one that exists`, ok: false }
  }

  const entry = WIDGET_KINDS[kind]
  const properties = (entry.schema as { properties?: Record<string, { type?: string }> }).properties ?? {}
  const authored: Record<string, unknown> = { ...(op.widgetData ?? {}) }
  for (const field of entry.required) {
    if (authored[field] === undefined && properties[field]?.type === 'array') {
      authored[field] = []
    }
  }
  const missing = entry.required.filter((field) => {
    const value = authored[field]
    return value === undefined || value === null || value === ''
  })
  if (missing.length) {
    return { error: `a ${kind} needs ${missing.join(', ')} — the CRD rejects it without them`, ok: false }
  }
  return { authored, kind, ok: true, resource: entry.plural }
}

export interface BindDataOp {
  widget: string
  action?: { name: string; steps: { name: string; path: string; verb?: string; dependsOn?: string }[]; filter: string }
  actionRef?: { name: string; namespace?: string }
  dataTemplate?: { forPath: string; expression: string }[]
  refsTemplate?: { iterator: string; template: { resource?: string; name?: string } }[]
}

export type BindDataResult =
  | { ok: true; path: string; yaml: string; created: { content: string; path: string } | null }
  | { ok: false; error: string }

/**
 * What a `bindData` proposal resolves to — the agent's half of the Data modal.
 *
 * Reuses the modal's OWN functions rather than restating them. A divergence between what a person
 * can author and what an agent can is the gap this op exists to close, and re-implementing the
 * rules here would reopen it on the first edit to either copy.
 */
export const bindData = (
  op: BindDataOp,
  node: TreeNode | undefined,
  heldYaml: string | undefined,
  namespace: string,
): BindDataResult => {
  if (!node?.path) {
    return { error: `"${op.widget}" is not in this draft`, ok: false }
  }
  if (typeof heldYaml !== 'string') {
    return { error: `"${op.widget}" has no file in this draft — only a drafted widget can be bound`, ok: false }
  }

  let created: { content: string; path: string } | null = null
  let ref: { name: string; namespace: string } | null = null
  if (op.action) {
    const generated = generateRestAction({
      filter: op.action.filter, name: op.action.name, namespace, steps: op.action.steps,
    })
    if (!generated.ok) {
      return { error: generated.error, ok: false }
    }
    created = generated.file
    ref = { name: generated.name, namespace }
  } else if (op.actionRef) {
    ref = { name: op.actionRef.name, namespace: op.actionRef.namespace ?? namespace }
  }

  const dataEntries = op.dataTemplate ?? []
  const dataError = dataEntries.length ? validateDataTemplate(dataEntries) : null
  if (dataError) {
    return { error: dataError, ok: false }
  }
  const refsEntries = op.refsTemplate ?? []
  const refsError = refsEntries.length ? validateRefsTemplate(refsEntries) : null
  if (refsError) {
    return { error: refsError, ok: false }
  }
  if (!ref && !dataEntries.length && !refsEntries.length) {
    return { error: `nothing to bind to "${op.widget}" — give an action, an actionRef, or a template`, ok: false }
  }

  let yaml = heldYaml
  if (ref) { yaml = setApiRef(yaml, ref) }
  if (dataEntries.length) { yaml = setDataTemplate(yaml, dataEntries) }
  if (refsEntries.length) { yaml = setRefsTemplate(yaml, refsEntries) }
  return { created, ok: true, path: node.path, yaml }
}
