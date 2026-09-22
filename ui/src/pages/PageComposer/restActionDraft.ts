/**
 * A RESTAction the author writes, and the widget that points at it.
 *
 * WHY THIS EXISTS AT ALL. Every widget CRD carries `spec.apiRef`, and an apiRef names a RESTAction
 * — so "give this widget data" has always been two ordinary objects, not a special capability. The
 * composer did not see it that way: the only door it offered was `bind-data`, a three-question form
 * that generates BOTH objects from one API path and a map of field paths. That form is a good
 * shortcut and a bad ceiling. A page that needs two sources joined — pod requests from the
 * apiserver against live usage from metrics.k8s.io — cannot be asked for through three questions,
 * so it looked like something only the agent could do. It was not: the agent was simply not going
 * through that door.
 *
 * The RESTAction CRD is an ordinary schema (`spec.api[]` + `spec.filter`), the composer already
 * renders CRD schemas as forms (CreateWidgetModal over all forty-four widget kinds), and snowplow
 * already lists a category under the caller's RBAC (`/list?category=actions` — the CRD declares
 * `categories: [krateo, rest, actions]`). So this module is wiring, not new machinery.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: validate the jq. `spec.filter` is a program, and the server is
 * the only thing that can say whether it runs. snowplow answers a bad one precisely — it quotes the
 * query and names the token — and the preview already surfaces that message (see the note on
 * `isContainedExpression` in generateBinding). Guessing here would mean re-implementing jq in the
 * browser to produce a worse answer than the one already on the wire.
 */
import { dump } from 'js-yaml'

import { pageDraftSlug } from '../../components/Autopilot/pageDraft'

import type { GeneratedFile } from './generateBinding'

const RESTACTION_API_VERSION = 'templates.krateo.io/v1'
const DUMP = { lineWidth: -1, noRefs: true } as const
const DNS_1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

/** One api step, as the author gives it. `dependsOn` is the name of an EARLIER step. */
export interface ActionStep {
  name: string
  path: string
  verb?: string
  dependsOn?: string
}

export interface RestActionInput {
  name: string
  namespace: string
  steps: ActionStep[]
  /** The global jq filter. Free text: only the server can judge it. */
  filter: string
}

export type RestActionResult =
  | { ok: true; name: string; file: GeneratedFile }
  | { ok: false; error: string }

/**
 * Refuse only what THIS form can know is wrong.
 *
 * Every rule here is about the SHAPE the apiserver will reject or the reference graph the author
 * cannot see — a duplicate step name, a `dependsOn` pointing at nothing, a path that is not a path.
 * Nothing here has an opinion about the filter, because nothing here can have one.
 */
export const validateRestAction = (input: RestActionInput): string | null => {
  if (!DNS_1123.test(input.name)) {
    return 'name must be lower-case letters, digits and dashes — it becomes the RESTAction\'s name'
  }
  if (!DNS_1123.test(input.namespace)) {
    return 'the draft declares no namespace — open a page draft first'
  }
  if (!input.steps.length) {
    return 'add at least one API step — a RESTAction with no call fetches nothing'
  }
  const seen = new Set<string>()
  for (const [index, step] of input.steps.entries()) {
    const at = `step ${index + 1}`
    if (!DNS_1123.test(step.name)) {
      // The step name becomes a jq key (`.pods`, `.metrics`), so it has to be addressable as one.
      return `${at}: the name must be lower-case letters, digits and dashes — the filter reads it back as .${step.name || '<name>'}`
    }
    if (seen.has(step.name)) {
      return `${at}: "${step.name}" is already the name of an earlier step — the second would overwrite the first`
    }
    if (!step.path.startsWith('/')) {
      return `${at}: the path must start with "/" — it is an apiserver path, not a URL`
    }
    if (step.dependsOn && !seen.has(step.dependsOn)) {
      // Forward and self references both land here. The CRD accepts the string either way and the
      // call simply never resolves, which is the silent failure this check exists to make loud.
      return `${at}: dependsOn "${step.dependsOn}" is not an EARLIER step — a step can only depend on one already listed`
    }
    seen.add(step.name)
  }
  if (!input.filter.trim()) {
    return 'add a filter — without one the widget receives the raw responses keyed by step name'
  }

  return null
}

/**
 * Emit the RESTAction CR.
 *
 * `headers` and `verb` are written for every step because a step that omits them is served as a
 * bare GET with no Accept, and the apiserver's default content negotiation is not something a page
 * should depend on.
 */
export const generateRestAction = (input: RestActionInput): RestActionResult => {
  const error = validateRestAction(input)
  if (error) {
    return { error, ok: false }
  }

  return {
    file: {
      content: dump({
        apiVersion: RESTACTION_API_VERSION,
        kind: 'RESTAction',
        metadata: { name: input.name, namespace: input.namespace },
        spec: {
          api: input.steps.map((step) => ({
            headers: ['Accept: application/json'],
            name: step.name,
            path: step.path,
            verb: step.verb ?? 'GET',
            ...(step.dependsOn ? { dependsOn: { name: step.dependsOn } } : {}),
          })),
          filter: input.filter,
        },
      }, DUMP),
      path: pageDraftSlug('RESTAction', input.name),
    },
    name: input.name,
    ok: true,
  }
}

/**
 * Point a widget at a RESTAction — the `apiRef` half.
 *
 * Returns the widget's YAML with `spec.apiRef` set, or an error. The namespace is the RESTAction's
 * OWN, not the draft's: a RESTAction picked from the cluster lives where the listing found it, and
 * rewriting that would point the widget at something that is not there. The same reasoning
 * `placeChild` applies to an existing widget's namespace.
 */
export const setApiRef = (widgetYaml: string, ref: { name: string; namespace: string }): string => {
  // A line-level edit rather than a parse/dump round trip: the held YAML is the author's bytes, and
  // re-emitting it would reorder keys and drop comments on a file they may have hand-edited.
  const existing = /^\s*apiRef:\s*$/m.test(widgetYaml)
  if (existing) {
    return widgetYaml.replace(/^(\s*)apiRef:\s*$(?:\n\s+\w+:.*$)*/m,
      (_match, indent: string) => `${indent}apiRef:\n${indent}  name: ${ref.name}\n${indent}  namespace: ${ref.namespace}`)
  }

  return widgetYaml.replace(/^(\s*)spec:\s*$/m,
    (match, indent: string) => `${match}\n${indent}  apiRef:\n${indent}    name: ${ref.name}\n${indent}    namespace: ${ref.namespace}`)
}

/** One `widgetDataTemplate` entry: a jq expression and the widgetData path it fills. */
export interface DataTemplateEntry {
  forPath: string
  expression: string
}

/** One `resourcesRefsTemplate` entry: a jq iterator and the ref it produces per item. */
export interface RefsTemplateEntry {
  iterator: string
  template: { id?: string; name?: string; namespace?: string; resource?: string; apiVersion?: string; verb?: string }
}

/**
 * The OTHER half of binding, and the half the composer never exposed.
 *
 * `apiRef` says WHERE the data comes from. `widgetDataTemplate` says what to DO with it: each entry
 * is a jq expression and the `widgetData` path it fills, so a Table's `dataSource`, a chart's
 * `data`, a Statistic's `value` are all the same mechanism pointed at different paths. bind-data
 * has always written exactly one of these — `forPath: dataSource` with a generated
 * `${ [ .rows[] | … ] }` — which is why it could fill a table and nothing else.
 *
 * Measured on the cluster: 49 Tables carry one today, and all 44 widget CRDs declare the field.
 *
 * THE `${ }` WRAPPER IS THE CONTRACT, not decoration: snowplow evaluates the inside as jq and
 * substitutes the result at `forPath`. An expression without it is copied through as a literal
 * string, which renders as the text of the program — a failure that looks like a typo in the data.
 * So it is checked here, and added when the author omits it rather than refused.
 */
export const normalizeExpression = (expression: string): string => {
  const trimmed = expression.trim()
  if (!trimmed) {
    return trimmed
  }

  return /^\$\{[\s\S]*\}$/.test(trimmed) ? trimmed : `\${ ${trimmed} }`
}

/** Refuse what the CRD or the renderer will reject; say nothing about the jq itself. */
export const validateDataTemplate = (entries: readonly DataTemplateEntry[]): string | null => {
  const seen = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    const at = `template ${index + 1}`
    const path = entry.forPath.trim()
    if (!path) {
      return `${at}: forPath is required — it names the widgetData field this fills`
    }
    if (!/^[A-Za-z_][A-Za-z0-9_.[\]]*$/.test(path)) {
      return `${at}: "${path}" is not a widgetData path — use forms like dataSource or series[0].data`
    }
    if (seen.has(path)) {
      return `${at}: "${path}" is filled twice — the second would overwrite the first`
    }
    if (!entry.expression.trim()) {
      return `${at}: the expression is empty — ${path} would be set to nothing`
    }
    seen.add(path)
  }

  return null
}

/** Same shape of rule for the refs template: the iterator and the plural are what the CRD needs. */
export const validateRefsTemplate = (entries: readonly RefsTemplateEntry[]): string | null => {
  for (const [index, entry] of entries.entries()) {
    const at = `refs template ${index + 1}`
    if (!entry.iterator.trim()) {
      return `${at}: the iterator is required — it selects the list each ref is built from`
    }
    if (!entry.template.resource?.trim()) {
      // Without a plural the ref addresses no kind, and the child silently never resolves — the
      // same empty-hole failure placeChild refuses for a hand-placed widget.
      return `${at}: resource is required — the PLURAL of the kind each ref points at`
    }
    if (!entry.template.name?.trim()) {
      return `${at}: name is required — usually a jq expression reading the current item`
    }
  }

  return null
}

/**
 * Replace one `spec.<key>` block in the held YAML, or append it under `spec:`.
 *
 * Block-level rather than a parse/dump round trip, for the reason `setApiRef` gives: the held file
 * is the author's bytes and re-emitting the whole document reorders keys and drops any comment
 * they added in the Files tab. Only the block being edited is rewritten.
 */
export const setSpecBlock = (widgetYaml: string, key: string, blockYaml: string): string => {
  const lines = widgetYaml.split('\n')
  const at = lines.findIndex((line) => new RegExp(`^\\s*${key}:`).test(line))
  const body = blockYaml.trimEnd().split('\n')

  if (at >= 0) {
    // The block runs until the next line indented NO DEEPER than the key itself. Scanned rather
    // than matched: a regex with a backreference and an empty-line alternative swallowed the rest
    // of the document, which is the kind of failure that only shows up on the second edit.
    const [indent = ''] = lines[at].match(/^\s*/) ?? []
    let end = at + 1
    while (end < lines.length) {
      const line = lines[end]
      if (line.trim() && !line.startsWith(`${indent} `) && !line.startsWith(`${indent}\t`)) {
        break
      }
      end += 1
    }

    return [
      ...lines.slice(0, at),
      `${indent}${key}:`,
      ...body.map((line) => `${indent}${line}`),
      ...lines.slice(end),
    ].join('\n')
  }

  return widgetYaml.replace(/^(\s*)spec:\s*$/m, (match, indent: string) =>
    `${match}\n${indent}  ${key}:\n${body.map((line) => `${indent}  ${line}`).join('\n')}`)
}

/** Write `spec.widgetDataTemplate` from the author's entries. */
export const setDataTemplate = (widgetYaml: string, entries: readonly DataTemplateEntry[]): string =>
  setSpecBlock(widgetYaml, 'widgetDataTemplate', dump(
    entries.map((entry) => ({ expression: normalizeExpression(entry.expression), forPath: entry.forPath.trim() })), DUMP))

/** Write `spec.resourcesRefsTemplate` from the author's entries. */
export const setRefsTemplate = (widgetYaml: string, entries: readonly RefsTemplateEntry[]): string =>
  setSpecBlock(widgetYaml, 'resourcesRefsTemplate', dump(
    entries.map((entry) => ({
      iterator: entry.iterator.trim(),
      template: Object.fromEntries(Object.entries(entry.template).filter(([, value]) => String(value ?? '').trim())),
    })), DUMP))
