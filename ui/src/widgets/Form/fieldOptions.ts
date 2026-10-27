import type { JSONSchema4 } from 'json-schema'

import { isSecretArrayNode, isSecretSchemaNode } from '../../utils/secretFields'

import { type DependsOn, PARAM_NAME, parseDependsOn, RESERVED_PARAMS } from './fieldDependencies'

/**
 * `x-krateo-options` — a field whose options come from a RESTAction at runtime.
 *
 * ```json
 * "region": { "type": "string", "x-krateo-options": { "ref": "regions", "closed": true } }
 * ```
 *
 * `ref` is the id of one of the Form's `resourcesRefs`, never a URL: snowplow resolves the
 * RESTAction's path and whether this user may call it, and the browser only ever calls a path
 * snowplow handed it. For blueprint forms the formdef RESTAction emits those refs from the
 * schema; a hand-written Form lists them itself.
 *
 * The extension lives on the schema node, not in `widgetData`, because one `blueprint-create`
 * Form serves every blueprint: only the blueprint's own `values.schema.json` can say which of
 * its fields load options. It survives to the browser because the form reads that file from
 * core-provider's jsonschema ConfigMap; the generated CRD drops every `x-krateo-*` key.
 */
export interface FieldOptionsSpec {
  /** id of the Form `resourcesRefs` entry (a RESTAction GET) that answers with the options */
  ref: string
  /** true: only a listed value is accepted. false (default): the list suggests, free text is kept */
  closed: boolean
  /**
   * The options depend on another field's value, sent as `extras[param]`: no value there, no call.
   * `{ "field": "region", "param": "region" }` — see `resolveFieldPath` for what `field` names.
   */
  dependsOn?: DependsOn
  /**
   * Search as the person types: the typed text is sent as `extras[param]` once it has `minChars`
   * characters (default 2), and the RESTAction filters. Without it the options load once and are
   * filtered in the browser.
   */
  search?: { param: string; minChars: number }
  /** why the extension cannot be used as written; the field is disabled and says so */
  problem?: string
}

export const FIELD_OPTIONS_KEY = 'x-krateo-options'

const DEFAULT_MIN_CHARS = 2

/** `search` as authored — the same param rules as `dependsOn.param` — or a reason it cannot be used. */
const parseSearch = (raw: unknown): { search?: { param: string; minChars: number }; problem?: string } => {
  if (raw === undefined) { return {} }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return { problem: 'search must be { param, minChars? }' } }
  const { minChars, param } = raw as { minChars?: unknown; param?: unknown }
  if (typeof param !== 'string' || !PARAM_NAME.test(param)) { return { problem: 'search.param must be a plain name' } }
  if (RESERVED_PARAMS.has(param)) { return { problem: `search.param cannot be "${param}": that name carries the caller's identity` } }
  const min = typeof minChars === 'number' && Number.isInteger(minChars) && minChars >= 1 ? minChars : DEFAULT_MIN_CHARS
  return { search: { minChars: min, param } }
}

/**
 * Reads `x-krateo-options` off a schema node. Anything malformed reads as absent, so the field
 * falls back to the control its type would get — an authoring mistake never blanks the form.
 * A secret never loads options: its value must not be offered back or sent as a parameter.
 */
export const getFieldOptionsSpec = (node: JSONSchema4): FieldOptionsSpec | undefined => {
  const raw = node[FIELD_OPTIONS_KEY] as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return undefined }
  if (isSecretSchemaNode(node) || isSecretArrayNode(node)) { return undefined }
  const { closed, dependsOn: rawDependsOn, ref, search: rawSearch } = raw as { closed?: unknown; dependsOn?: unknown; ref?: unknown; search?: unknown }
  if (typeof ref !== 'string' || !ref.trim()) { return undefined }
  const { dependsOn, problem: dependsOnProblem } = parseDependsOn(rawDependsOn)
  const { problem: searchProblem, search } = parseSearch(rawSearch)
  if (!dependsOnProblem && !searchProblem && search && dependsOn && search.param === dependsOn.param) {
    return { closed: closed === true, problem: `search.param and dependsOn.param are both "${search.param}"`, ref: ref.trim() }
  }
  const problem = dependsOnProblem ?? searchProblem
  return {
    closed: closed === true,
    ref: ref.trim(),
    ...(dependsOn ? { dependsOn } : {}),
    ...(search ? { search } : {}),
    ...(problem ? { problem } : {}),
  }
}

/** One option, as the field shows it and as the Review shows the picked value. */
export interface FieldOption {
  /** what is stored in the field and submitted */
  value: string | number | boolean
  /** what the person reads (defaults to the value) */
  label: string
  /** muted second line */
  description?: string
}

type RawOption = string | number | boolean | { value?: unknown; label?: unknown; description?: unknown } | null | undefined

const toOption = (entry: RawOption): FieldOption | undefined => {
  if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
    return { label: String(entry), value: entry }
  }
  if (!entry || typeof entry !== 'object') { return undefined }
  const { description, label, value } = entry
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') { return undefined }
  return {
    description: typeof description === 'string' && description ? description : undefined,
    label: typeof label === 'string' && label ? label : String(value),
    value,
  }
}

/**
 * The options in a resolved RESTAction: snowplow returns the RESTAction object with its filter's
 * output in `status`, and that output is the list — `[{ "label", "value" }]` (the contract the
 * previous Krateo frontend used) or bare values. Entries that are neither are dropped, and a
 * value listed twice is kept once. Anything that is not a list reads as undefined, which the
 * field reports as a failed load rather than as "no options".
 */
export const parseFieldOptions = (payload: unknown): FieldOption[] | undefined => {
  const status = (payload as { status?: unknown } | null)?.status
  if (!Array.isArray(status)) { return undefined }
  const seen = new Set<string>()
  const options: FieldOption[] = []
  for (const entry of status as RawOption[]) {
    const option = toOption(entry)
    const key = option ? `${typeof option.value}:${String(option.value)}` : ''
    if (option && !seen.has(key)) {
      seen.add(key)
      options.push(option)
    }
  }
  return options
}

const valueKey = (value: unknown): string => `${typeof value}:${String(value)}`

/**
 * What the Form learned about its option fields while the person filled it in, keyed by field
 * path: the label of every option a field showed (so the Review can say "United States", not
 * "us", while the payload keeps "us"), and the complete list of a CLOSED field that loads its
 * options at once (so a value that arrived some other way — initial values, a resumed draft, an
 * Autopilot draft — and is not in it fails validation instead of being submitted).
 */
export interface OptionRegistry {
  record: (path: readonly (string | number)[], options: FieldOption[]) => void
  /** the complete list of a closed field, or undefined when it is not known (loading, search) */
  setClosed: (path: readonly (string | number)[], options: FieldOption[] | undefined) => void
  labelFor: (path: readonly (string | number)[], value: unknown) => string | undefined
  /** true / false against a known closed list; undefined when there is none to check against */
  allows: (path: readonly (string | number)[], value: unknown) => boolean | undefined
}

/**
 * The rule a CLOSED option field adds: every value must be in the list, when the list is known
 * in full. Unknown (still loading, searched, failed) is not a violation — the person picked from
 * what they were shown, and the API server still validates.
 */
export const closedOptionRule = (label: string, path: readonly (string | number)[], registry: OptionRegistry | undefined) => ({
  validator: (_rule: unknown, value: unknown) => {
    const entries = (Array.isArray(value) ? value : [value]).filter((entry) => entry !== undefined && entry !== null && entry !== '')
    const outside = entries.filter((entry) => registry?.allows(path, entry) === false)
    return outside.length
      ? Promise.reject(new Error(`${label}: ${outside.map(String).join(', ')} ${outside.length === 1 ? 'is' : 'are'} not among the available options`))
      : Promise.resolve()
  },
})

export const createOptionRegistry = (): OptionRegistry => {
  const labels = new Map<string, Map<string, string>>()
  const closed = new Map<string, Set<string>>()
  const keyOf = (path: readonly (string | number)[]) => JSON.stringify(path)
  return {
    allows: (path, value) => {
      const list = closed.get(keyOf(path))
      return list ? list.has(valueKey(value)) : undefined
    },
    labelFor: (path, value) => labels.get(keyOf(path))?.get(valueKey(value)),
    record: (path, options) => {
      const key = keyOf(path)
      const known = labels.get(key) ?? new Map<string, string>()
      for (const option of options) { known.set(valueKey(option.value), option.label) }
      labels.set(key, known)
    },
    setClosed: (path, options) => {
      if (options) {
        closed.set(keyOf(path), new Set(options.map((option) => valueKey(option.value))))
      } else {
        closed.delete(keyOf(path))
      }
    },
  }
}
