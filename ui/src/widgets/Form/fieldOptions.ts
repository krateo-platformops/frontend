import type { JSONSchema4 } from 'json-schema'

import { isSecretArrayNode, isSecretSchemaNode } from '../../utils/secretFields'

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
}

export const FIELD_OPTIONS_KEY = 'x-krateo-options'

/**
 * Reads `x-krateo-options` off a schema node. Anything malformed reads as absent, so the field
 * falls back to the control its type would get — an authoring mistake never blanks the form.
 * A secret never loads options: its value must not be offered back or sent as a parameter.
 */
export const getFieldOptionsSpec = (node: JSONSchema4): FieldOptionsSpec | undefined => {
  const raw = node[FIELD_OPTIONS_KEY] as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return undefined }
  if (isSecretSchemaNode(node) || isSecretArrayNode(node)) { return undefined }
  const { closed, ref } = raw as { closed?: unknown; ref?: unknown }
  if (typeof ref !== 'string' || !ref.trim()) { return undefined }
  return { closed: closed === true, ref: ref.trim() }
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
