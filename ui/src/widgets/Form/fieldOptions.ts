import type { JSONSchema4 } from 'json-schema'

import { isSecretArrayNode, isSecretSchemaNode } from '../../utils/secretFields'

import { DEPENDS_ON_KEY, type DependsOn, parseDependsOn, parseExtraKey } from './fieldDependencies'

/**
 * `autocomplete` — a field whose options come from a RESTAction at runtime, in the format of the
 * previous frontend's `autocomplete`, moved onto the field:
 *
 * ```json
 * "region": { "type": "string", "autocomplete": { "resourceRefId": "regions", "closed": true } }
 * ```
 *
 * `resourceRefId` is the id of one of the Form's `resourcesRefs`, never a URL: snowplow resolves
 * the RESTAction's path and whether this user may call it, and the browser only ever calls a path
 * snowplow handed it. For blueprint forms the formdef RESTAction emits those refs from the
 * schema; a hand-written Form lists them itself. A field's `dependsOn` (beside `autocomplete`,
 * see fieldDependencies.ts) makes the options depend on another field.
 *
 * The key lives on the schema node, not in `widgetData`, because one `blueprint-create` Form
 * serves every blueprint: only the blueprint's own `values.schema.json` can say which of its
 * fields load options. It survives to the browser because the form reads that file from
 * core-provider's jsonschema ConfigMap; the generated CRD drops it.
 */
export interface FieldOptionsSpec {
  /** id of the Form `resourcesRefs` entry (a RESTAction GET) that answers with the options (`resourceRefId`) */
  ref: string
  /** true: only a listed value is accepted. false (default): the list suggests, free text is kept */
  closed: boolean
  /**
   * The options depend on another field's value, sent as `extras[param]`: no value there, no call.
   * The field's `dependsOn: { "name": "region", "extra": { "key": "region" } }`.
   */
  dependsOn?: DependsOn
  /**
   * Search as the person types: the typed text is sent as `extras[param]` once it has `minChars`
   * characters (default 2), and the RESTAction filters. Authored as `extra: { "key": "q" }` and
   * `minChars`. Without it the options load once and are filtered in the browser.
   */
  search?: { param: string; minChars: number }
  /**
   * `"manual"`: a CLOSED field whose options cannot be had — the source failed or timed out, or
   * a list loaded in full came back empty — takes a typed value instead of blocking the form. The
   * value is not checked against a list then (there is none); once the source answers again, a
   * value not in its list is flagged as for any closed field. An open field always takes typed
   * text, so this only changes closed ones.
   */
  fallback?: 'manual'
  /** why the key cannot be used as written; the field is disabled and says so */
  problem?: string
}

export const FIELD_OPTIONS_KEY = 'autocomplete'

const DEFAULT_MIN_CHARS = 2

/** `extra` + `minChars` as authored — the same key rules as `dependsOn.extra` — or a reason they cannot be used. */
const parseSearch = (extra: unknown, minChars: unknown): { search?: { param: string; minChars: number }; problem?: string } => {
  if (extra === undefined) { return {} }
  const { key, problem } = parseExtraKey(extra, 'autocomplete.extra')
  if (problem || !key) { return { problem } }
  const min = typeof minChars === 'number' && Number.isInteger(minChars) && minChars >= 1 ? minChars : DEFAULT_MIN_CHARS
  return { search: { minChars: min, param: key } }
}

/**
 * Reads `autocomplete` (and the field's `dependsOn`) off a schema node. Anything malformed reads
 * as absent, so the field falls back to the control its type would get — an authoring mistake
 * never blanks the form. A `dependsOn` with no `autocomplete` beside it has no options to load:
 * the field is disabled and says so. A secret never loads options: its value must not be offered
 * back or sent as a parameter.
 */
export const getFieldOptionsSpec = (node: JSONSchema4): FieldOptionsSpec | undefined => {
  if (isSecretSchemaNode(node) || isSecretArrayNode(node)) { return undefined }
  const raw = node[FIELD_OPTIONS_KEY] as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return node[DEPENDS_ON_KEY] === undefined ? undefined : { closed: false, problem: 'dependsOn needs autocomplete on the same field', ref: '' }
  }
  const { closed, extra, fallback, minChars, resourceRefId: ref } = raw as { closed?: unknown; extra?: unknown; fallback?: unknown; minChars?: unknown; resourceRefId?: unknown }
  if (typeof ref !== 'string' || !ref.trim()) { return undefined }
  const { dependsOn, problem: dependsOnProblem } = parseDependsOn(node[DEPENDS_ON_KEY] as unknown)
  const { problem: searchProblem, search } = parseSearch(extra, minChars)
  if (!dependsOnProblem && !searchProblem && search && dependsOn && search.param === dependsOn.param) {
    return { closed: closed === true, problem: `autocomplete.extra.key and dependsOn.extra.key are both "${search.param}"`, ref: ref.trim() }
  }
  const fallbackProblem = fallback === undefined || fallback === 'manual' ? undefined : 'fallback must be "manual"'
  const problem = dependsOnProblem ?? searchProblem ?? fallbackProblem
  return {
    closed: closed === true,
    ref: ref.trim(),
    ...(fallback === 'manual' ? { fallback: 'manual' as const } : {}),
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
