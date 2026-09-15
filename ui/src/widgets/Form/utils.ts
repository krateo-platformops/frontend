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
