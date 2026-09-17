import type { DefaultOptionType } from 'antd/es/select'
import type { JSONSchema4, JSONSchema4Type } from 'json-schema'

export const getDefaultsFromSchema = (schema: JSONSchema4): Record<string, unknown> => {
  const defaults: Record<string, unknown> = {}

  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const node = prop
      if (node.type === 'object' && node.properties) {
        // Nested object with a known shape — recurse so its scalar defaults apply.
        defaults[key] = getDefaultsFromSchema(node)
      } else if (node.default !== undefined) {
        defaults[key] = node.default
      }
      // A property-less object (free-form map, e.g. x-kubernetes-preserve-unknown-fields)
      // with no default is intentionally left undefined — no spurious `{}` to render as
      // "[object Object]" in a text input or to submit as an empty map.
    }
  }

  return defaults
}

export const getOptionsFromEnum = (enumValues: JSONSchema4Type[] | undefined): DefaultOptionType[] | undefined => {
  if (!Array.isArray(enumValues)) { return undefined }

  return enumValues
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map((value) => ({ label: String(value), value }))
}

/**
 * A single entry of the `x-krateo-suggestions` catalogue (see `getSuggestionGroups`).
 * `value` is the only required member — everything else is presentation.
 */
export interface SchemaSuggestion {
  /** the literal value written into the field when the entry is picked */
  value: string
  /** muted second line — what the value IS (e.g. a metric's unit) */
  description?: string
  /** optgroup heading — what PRODUCED the value (e.g. the receiver that collects a metric) */
  group?: string
  /** human label shown instead of the raw value (defaults to `value`) */
  label?: string
}

/** One optgroup of suggestions, or the ungrouped bucket when `group` is undefined. */
export interface SuggestionGroup {
  entries: SchemaSuggestion[]
  group?: string
}

/** `x-krateo-suggestions` as it may be authored: bare strings or full entries, mixed. */
type RawSuggestion = Partial<SchemaSuggestion> | string | null | undefined

/**
 * Reads the `x-krateo-suggestions` vendor extension off a JSON Schema node and normalises it
 * into optgroups, preserving authoring order for both the groups and the entries inside them.
 *
 * WHY A VENDOR EXTENSION AND NOT `enum`. `enum` is a CLOSED set: JSON Schema validation (and
 * the antd `Select` this widget renders for it) rejects anything not listed. Some fields need
 * the opposite — a known catalogue offered as a starting point while ARBITRARY text stays
 * legal. The motivating case is the Alert form's `where`, a free Lucene expression: the
 * platform knows which signals it actually collects and can offer them, but must not forbid
 * the expression a user writes by hand. `enum` cannot express "suggest, don't restrict", so
 * suggestions are a separate key and leave `type` / validation untouched.
 *
 * It travels as a schema extension rather than a new `widgetData` field because
 * `widgetData.schema` is `x-kubernetes-preserve-unknown-fields`, so a server-side jq filter can
 * graft a live catalogue onto the property it belongs to with no CRD change — and the
 * suggestions stay attached to their field instead of living in a parallel map keyed by
 * property name.
 *
 * Tolerant by construction: the catalogue is assembled server-side from live telemetry, so a
 * malformed entry is bad DATA, not a bad form. Entries without a usable `value` are dropped and
 * the rest of the field still renders; a node with no (or no usable) suggestions returns
 * undefined, which is the caller's signal to fall back to the plain control.
 */
/** A bare string is shorthand for `{ value }`; anything without a usable `value` is dropped. */
const normaliseSuggestion = (entry: RawSuggestion): SchemaSuggestion | undefined => {
  if (typeof entry === 'string') {
    return entry.trim() ? { value: entry } : undefined
  }
  if (!entry || typeof entry.value !== 'string' || !entry.value.trim()) {
    return undefined
  }
  const text = (value: unknown): string | undefined => {
    return typeof value === 'string' && value.trim() ? value : undefined
  }

  return {
    description: text(entry.description),
    group: text(entry.group),
    label: text(entry.label),
    value: entry.value,
  }
}

export const getSuggestionGroups = (node: JSONSchema4): SuggestionGroup[] | undefined => {
  const raw: unknown = (node as unknown as Record<string, unknown>)['x-krateo-suggestions']
  if (!Array.isArray(raw)) { return undefined }

  const groups: SuggestionGroup[] = []
  const byGroup = new Map<string, SuggestionGroup>()

  for (const entry of raw as RawSuggestion[]) {
    const normalised = normaliseSuggestion(entry)
    if (!normalised) { continue }

    // '' is the ungrouped bucket; it can never collide with a real group name because a
    // blank `group` was normalised to undefined.
    const key = normalised.group ?? ''
    let bucket = byGroup.get(key)
    if (!bucket) {
      bucket = { entries: [], group: normalised.group }
      byGroup.set(key, bucket)
      groups.push(bucket)
    }
    bucket.entries.push(normalised)
  }

  return groups.length > 0 ? groups : undefined
}

/** The text a suggestion is searched by: its label, its value and its description. */
export const suggestionSearchText = (entry: SchemaSuggestion): string =>
  [entry.label, entry.value, entry.description].filter(Boolean).join(' ').toLowerCase()

/**
 * Narrow an Autopilot draft to the fields the human will actually SEE.
 *
 * Two filters, and the second is a safety property rather than a correctness one:
 *
 * REAL FIELDS ONLY. The model is told to use exact field names, but an invented or
 * "closest-match" key would otherwise sit in the form store via setFieldsValue while the chip
 * still claims "drafted the form" — a value landing nowhere.
 *
 * VISIBLE FIELDS ONLY. `propertiesToHide` removes a property from the rendered form, so a value
 * written there is one the human cannot see, cannot correct, and does not know they are
 * approving when they submit. The premise of agent-fills-human-submits is that the human
 * reviews what was filled; a field they were never shown sits outside that review by
 * construction.
 *
 * Dropped silently rather than refused: the model is not told which fields are hidden, so
 * writing one is a mistake to absorb, not an attack to report — and the other fields still fill.
 *
 * With no schema, the visibility filter still applies: hiding is declared on the widget, not
 * derived from the schema, so it is the one rule that holds either way.
 */
export const narrowAgentDraft = (
  draft: Record<string, unknown> | null | undefined,
  schemaProperties: Record<string, unknown> | undefined,
  propertiesToHide: string[] | undefined,
): Record<string, unknown> | undefined => {
  if (!draft) {
    return undefined
  }
  const hidden = new Set(propertiesToHide ?? [])
  const entries = Object.entries(draft).filter(([key]) => {
    if (hidden.has(key)) {
      return false
    }
    return schemaProperties ? Object.prototype.hasOwnProperty.call(schemaProperties, key) : true
  })

  return Object.fromEntries(entries)
}
