/**
 * Does a RESOLVED widgetDataTemplate value have the shape its kind's CRD requires? (frontend#473)
 *
 * WHY THIS EXISTS. A page in `krateo-blueprints/event-health` paired a RESTAction emitting rows as
 * OBJECTS with a Table feeding them straight to `dataSource` (`expression: ${ .sites }`), where the
 * CRD requires an array of arrays of cells. It was authored, previewed, published, released and
 * installed, and every gate passed — because at each of those moments the query returned nothing.
 * With zero items the expression yields `[]`: there is no `dataSource[0]`, so the API server has
 * nothing to validate and accepts the CR. The first time a row existed, the widget died with
 *
 *     dataSource[0]: Invalid value: "object": dataSource[0] in body must be of type array: "object"
 *
 * Each gate answered a question it could answer, and none could tell "this renders correctly" from
 * "this renders nothing".
 *
 * WHAT THIS CHECKS, AND WHAT IT REFUSES TO GUESS. Given a resolved value, this compares its real
 * shape against the kind's own CRD schema (WIDGET_KINDS, derived from the CRDs at build time, so it
 * cannot drift from what the API server enforces) and reports the first mismatch in the API
 * SERVER'S OWN WORDS, so an author reads the message the cluster would have given them.
 *
 * It judges a value it was given. It does not invent one: the shape of a pass-through expression's
 * output is the shape of its INPUT, so resolving `${ .sites }` against a stand-in row would only
 * re-measure the stand-in. That case is UNKNOWABLE and must be reported as such — see
 * `dataSourceShapeSource`, and `notChecked is a failure` in the gate's own contract.
 */
import { WIDGET_KINDS } from '../../pages/PageBuilder/widgetKinds.generated'

/** JSON Schema's own type names, as the API server reports them. */
const jsonTypeOf = (value: unknown): string => {
  if (Array.isArray(value)) { return 'array' }
  if (value === null) { return 'null' }
  if (typeof value === 'number') { return Number.isInteger(value) ? 'integer' : 'number' }
  return typeof value
}

const rec = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null

/**
 * The schema node a `forPath` names, or null when the kind or the path is unknown to us. Handles
 * the two forms `validateDataTemplate` accepts: `dataSource` and `series[0].data`.
 */
export const schemaAtPath = (widgetKind: string, forPath: string): Record<string, unknown> | null => {
  const schema = WIDGET_KINDS[widgetKind]?.schema
  if (!schema) { return null }
  let node = rec(schema)
  for (const segment of forPath.split('.')) {
    const name = segment.replace(/\[\d+\]$/, '')
    const indexed = segment !== name
    node = rec(rec(node?.properties)?.[name])
    if (indexed) { node = rec(node?.items) }
    if (!node) { return null }
  }
  return node
}

export type ShapeVerdict =
  /** The value satisfies the schema as far as this check can see. */
  | { verdict: 'ok' }
  /** The API server would reject it, and this is the message it would give. */
  | { verdict: 'wrong'; detail: string }
  /** Not judged — say why, and let the caller decide (the gate treats it as red). */
  | { verdict: 'unknowable'; detail: string }

/**
 * Compare a resolved value against the schema at `forPath`, reporting the FIRST mismatch the way
 * the API server words it. Descends array nesting and checks each object's `required` keys; a
 * schema that opts out of validation (`x-kubernetes-preserve-unknown-fields`) is not judged.
 */
export interface ShapeCheckOptions {
  /**
   * Judge only the ARRAY/OBJECT nesting and each object's `required` keys, not scalar types.
   *
   * Set it when the value was resolved against PRIMED (synthetic) input: a constructor's nesting
   * is fixed by the expression and so is real, but its leaf values came from the primer, where
   * `stringValue: .` over a primed `{}` is an object only because the primer made one.
   */
  structureOnly?: boolean
}

export const checkResolvedShape = (widgetKind: string, forPath: string, resolved: unknown, options: ShapeCheckOptions = {}): ShapeVerdict => {
  const schema = schemaAtPath(widgetKind, forPath)
  if (!schema) {
    return { verdict: 'unknowable', detail: `neither ${widgetKind} nor its field ${forPath} is in the widget registry, so its required shape is not known here` }
  }

  const walk = (node: Record<string, unknown>, value: unknown, at: string): ShapeVerdict => {
    if (node['x-kubernetes-preserve-unknown-fields'] === true) {
      return { verdict: 'ok' }
    }
    const expected = typeof node.type === 'string' ? node.type : ''
    if (!expected) {
      return { verdict: 'unknowable', detail: `${at} has no declared type in the CRD, so nothing can be concluded about it` }
    }
    const actual = jsonTypeOf(value)
    // The API server accepts an integer where a number is required, and either for int-or-string.
    const compatible = actual === expected
      || (expected === 'number' && actual === 'integer')
      || node['x-kubernetes-int-or-string'] === true
      // Under structureOnly a scalar's type came from the primer, not from the author.
      || (options.structureOnly === true && expected !== 'array' && expected !== 'object')
    if (!compatible) {
      return { verdict: 'wrong', detail: `${at}: Invalid value: "${actual}": ${at} in body must be of type ${expected}: "${actual}"` }
    }
    if (expected === 'array' && Array.isArray(value)) {
      const items = rec(node.items)
      if (!items) { return { verdict: 'ok' } }
      // Every element must satisfy the item schema; the FIRST offender is the one the API server
      // names, so report in order and stop there.
      for (const [index, element] of value.entries()) {
        const inner = walk(items, element, `${at}[${index}]`)
        if (inner.verdict !== 'ok') { return inner }
      }
    }
    if (expected === 'object') {
      const required = Array.isArray(node.required) ? node.required.filter((k): k is string => typeof k === 'string') : []
      const present = rec(value) ?? {}
      const missing = required.filter((key) => present[key] === undefined)
      if (missing.length > 0) {
        return { verdict: 'wrong', detail: `${at}: Required value: ${missing.map((k) => `${at}.${k}`).join(', ')} in body is required` }
      }
      // Each DECLARED property that is present is judged too, or a cell whose `stringValue` holds
      // an object would pass: the nesting would be right and the value still unusable. Properties
      // the schema does not declare are left alone — the API server's Strict decoding is what
      // refuses those, and it sees the stored CR, not this resolved value.
      const properties = rec(node.properties) ?? {}
      for (const [key, sub] of Object.entries(properties)) {
        const subSchema = rec(sub)
        if (!subSchema || present[key] === undefined) { continue }
        const inner = walk(subSchema, present[key], `${at}.${key}`)
        if (inner.verdict !== 'ok') { return inner }
      }
    }
    return { verdict: 'ok' }
  }

  return walk(schema, resolved, forPath)
}

/**
 * Does this field's item schema CONSTRAIN what an item may be?
 *
 * `false` when the CRD accepts any item there — `x-kubernetes-preserve-unknown-fields`, or no
 * declared item type. Every chart kind is in that group: `PieChart`/`BarChart`/`LineChart` declare
 * `data.items` as a preserve-unknown object, so an expression handing rows straight through cannot
 * violate them and there is nothing for a gate to withhold. `Table.dataSource` is the opposite —
 * `items.type: array` with each cell requiring `kind` and `valueKey` — which is why frontend#473
 * happened there and not on a chart.
 *
 * This replaced a text test for `valueKey` in the expression. That marker is Table's, so it called
 * every chart pass-through a defect; the gate's own fixtures caught it on a `PieChart`.
 */
export const itemSchemaConstrains = (widgetKind: string, forPath: string): boolean => {
  const items = rec(schemaAtPath(widgetKind, forPath)?.items)
  if (!items) { return false }
  if (items['x-kubernetes-preserve-unknown-fields'] === true) { return false }
  return typeof items.type === 'string' && items.type.length > 0
}
/**
 * The same data with every EMPTY array holding one empty object, so a constructor expression
 * iterates once and its nesting becomes observable. Pure; the input is not touched.
 *
 * This is only ever sound for a CONSTRUCTOR (`dataSourceShapeSource`): a pass-through returns the
 * primer itself, so priming would measure this function rather than the author's expression.
 */
export const primeEmptyArrays = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.length === 0 ? [{}] : value.map(primeEmptyArrays)
  }
  const object = rec(value)
  if (!object) { return value }
  return Object.fromEntries(Object.entries(object).map(([key, inner]) => [key, primeEmptyArrays(inner)]))
}
