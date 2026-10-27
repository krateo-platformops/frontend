import type { Rule } from 'antd/es/form'
import type { JSONSchema4 } from 'json-schema'

/** The name a person reads for a property: its `title`, falling back to the schema key. */
export const fieldLabel = (key: string, node: JSONSchema4): string =>
  (typeof node.title === 'string' && node.title.trim() ? node.title : key)

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

/**
 * A JSON Schema `pattern` is an unanchored ECMA regex. One the browser cannot compile (an
 * authoring mistake, or a Go-only construct) is skipped rather than blocking the form: the API
 * server still validates the value.
 */
const compilePattern = (pattern: unknown): RegExp | undefined => {
  if (typeof pattern !== 'string') { return undefined }
  try {
    return new RegExp(pattern)
  } catch {
    return undefined
  }
}

/** Bounds of a number node; `exclusiveMinimum`/`exclusiveMaximum` are a flag in draft-04 and a number from draft-06. */
const numberBounds = (node: JSONSchema4): { min?: number; max?: number; exclusiveMin: boolean; exclusiveMax: boolean } => {
  const exclusiveMinimum = node.exclusiveMinimum as boolean | number | undefined
  const exclusiveMaximum = node.exclusiveMaximum as boolean | number | undefined
  return {
    exclusiveMax: typeof exclusiveMaximum === 'number' || exclusiveMaximum === true,
    exclusiveMin: typeof exclusiveMinimum === 'number' || exclusiveMinimum === true,
    max: typeof exclusiveMaximum === 'number' ? exclusiveMaximum : node.maximum,
    min: typeof exclusiveMinimum === 'number' ? exclusiveMinimum : node.minimum,
  }
}

/** A plain validator rule — the only kind antd's `Form.List` accepts, and a valid field rule too. */
interface ListRule { validator: (rule: unknown, value: unknown) => Promise<void> }

/** `minItems` / `maxItems` — shared by the plain array controls and the `Form.List` of object rows. */
export const itemCountRules = (label: string, node: JSONSchema4): ListRule[] => {
  const rules: ListRule[] = []
  if (typeof node.minItems === 'number' && node.minItems > 0) {
    const min = node.minItems
    rules.push({
      validator: (_rule, value: unknown) => (!Array.isArray(value) || value.length === 0 || value.length >= min
        ? Promise.resolve()
        : Promise.reject(new Error(`${label} needs at least ${min} ${min === 1 ? 'entry' : 'entries'}`))),
    })
  }
  if (typeof node.maxItems === 'number') {
    const max = node.maxItems
    rules.push({
      validator: (_rule, value: unknown) => (!Array.isArray(value) || value.length <= max
        ? Promise.resolve()
        : Promise.reject(new Error(`${label} allows at most ${max} ${max === 1 ? 'entry' : 'entries'}`))),
    })
  }
  return rules
}

const check = (message: string, ok: (value: unknown) => boolean): Rule => ({
  validator: (_rule, value: unknown) => (isEmpty(value) || ok(value) ? Promise.resolve() : Promise.reject(new Error(message))),
})

/**
 * The client-side rules a schema node implies — `required` plus the constraints the API server
 * would otherwise be the first to reject (`pattern`, string length, number bounds, item counts),
 * so the error lands beside the field before the confirm step. An empty value is left to
 * `required`: an optional field the user did not fill is not a constraint violation.
 */
export const rulesFor = (key: string, node: JSONSchema4, isRequired: boolean): Rule[] | undefined => {
  const label = fieldLabel(key, node)
  const rules: Rule[] = []

  if (isRequired) {
    rules.push({ message: `${label} is required`, required: true })
  }

  if (node.type === 'string' || (node.type === undefined && typeof node.pattern === 'string')) {
    const pattern = compilePattern(node.pattern)
    if (pattern) {
      rules.push(check(`${label} must match ${node.pattern as string}`, (value) => typeof value !== 'string' || pattern.test(value)))
    }
    if (typeof node.minLength === 'number') {
      const min = node.minLength
      rules.push(check(`${label} must be at least ${min} characters`, (value) => typeof value !== 'string' || value.length >= min))
    }
    if (typeof node.maxLength === 'number') {
      const max = node.maxLength
      rules.push(check(`${label} must be at most ${max} characters`, (value) => typeof value !== 'string' || value.length <= max))
    }
  }

  if (node.type === 'integer' || node.type === 'number') {
    const { exclusiveMax, exclusiveMin, max, min } = numberBounds(node)
    if (typeof min === 'number') {
      rules.push(exclusiveMin
        ? check(`${label} must be greater than ${min}`, (value) => typeof value !== 'number' || value > min)
        : check(`${label} must be at least ${min}`, (value) => typeof value !== 'number' || value >= min))
    }
    if (typeof max === 'number') {
      rules.push(exclusiveMax
        ? check(`${label} must be less than ${max}`, (value) => typeof value !== 'number' || value < max)
        : check(`${label} must be at most ${max}`, (value) => typeof value !== 'number' || value <= max))
    }
    if (node.type === 'integer') {
      rules.push(check(`${label} must be a whole number`, (value) => typeof value !== 'number' || Number.isInteger(value)))
    }
  }

  if (node.type === 'array') {
    rules.push(...itemCountRules(label, node))
  }

  return rules.length ? rules : undefined
}
