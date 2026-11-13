import type { JSONSchema4 } from 'json-schema'

/**
 * LABELLED OPTIONS: a string field whose `oneOf` lists `{const, title}` items is a closed choice
 * shown by its titles and stored by its consts — country names on screen, ISO-2 codes submitted:
 *
 * ```json
 * { "type": "string", "enum": ["low", "high"],
 *   "oneOf": [{ "const": "low", "title": "Low" }, { "const": "high", "title": "High" }] }
 * ```
 *
 * A chart keeps `enum` beside it so a frontend that predates labelled options still draws a Select
 * (of the raw values). When both are present `oneOf` supplies the labels, and the two lists must
 * name the same values: when they do not, the Form renders its error state naming the field and
 * both lists (labelledOptionsProblem), rather than silently trusting one of them.
 *
 * Only a `oneOf` whose every item has a string `const` is this; any other `oneOf` (a union of
 * object shapes, say) is left as it always was.
 */
export interface LabelledOption { label: string; value: string }

export const labelledOptionsOf = (node: JSONSchema4): LabelledOption[] | undefined => {
  if (node.type !== 'string' || !Array.isArray(node.oneOf) || node.oneOf.length === 0) { return undefined }
  const items = node.oneOf as unknown[]
  if (!items.every((item) => !!item && typeof item === 'object' && typeof (item as { const?: unknown }).const === 'string')) { return undefined }
  return (items as Array<{ const: string; title?: unknown }>).map((item) => ({
    label: typeof item.title === 'string' && item.title ? item.title : item.const,
    value: item.const,
  }))
}

/** The label a labelled-options field shows for a value, or undefined. */
export const optionLabelFor = (node: JSONSchema4 | undefined, value: unknown): string | undefined =>
  (node ? labelledOptionsOf(node)?.find((option) => option.value === value)?.label : undefined)

const sameValues = (left: readonly unknown[], right: readonly unknown[]): boolean => {
  const leftSet = new Set(left.map(String))
  const rightSet = new Set(right.map(String))
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value))
}

const children = (node: JSONSchema4): Array<[string, JSONSchema4]> => {
  const own = Object.entries(node.properties ?? {})
  const items = node.items && !Array.isArray(node.items) ? children(node.items) : []
  return [...own, ...items]
}

/**
 * Why a schema's labelled options cannot be trusted, naming the first field whose `enum` and
 * `oneOf` consts differ; undefined when every such field agrees.
 */
export const labelledOptionsProblem = (schema: JSONSchema4 | undefined, prefix = ''): string | undefined => {
  if (!schema) { return undefined }
  for (const [key, node] of children(schema)) {
    const path = prefix ? `${prefix}.${key}` : key
    const options = labelledOptionsOf(node)
    if (options && Array.isArray(node.enum) && !sameValues(node.enum, options.map((option) => option.value))) {
      return `The field \`${path}\` lists different values in \`enum\` (${node.enum.map(String).join(', ')}) and in \`oneOf\` (${options.map((option) => option.value).join(', ')}). Make the two lists name the same values.`
    }
    const nested = labelledOptionsProblem(node, path)
    if (nested) { return nested }
  }
  return undefined
}
