import type { JSONSchema4 } from 'json-schema'

import { type FieldPath, resolveFieldPath } from './fieldDependencies'

/**
 * `displayDependency` — a field shown only while another field has a given value:
 *
 * ```json
 * "nodePort": { "type": "integer", "displayDependency": {
 *   "dependsOn": { "name": "type" }, "conditionType": "value", "value": "NodePort" } }
 * ```
 *
 * A condition is `{ dependsOn: { name }, conditionType, value | values }`, the format of the
 * previous frontend's `displayingDependencies`: `conditionType` is `value` (equals `value`), `in`
 * (one of `values`) or `notEmpty`. A list of conditions holds when every one does. `dependsOn.name`
 * resolves as a field's `dependsOn.name` does: relative to the object holding the field (inside a
 * list row, to the row), absolute with a leading `/`.
 *
 * A hidden field is not rendered, so it is not validated (a required one included), not
 * submitted, not reviewed and not counted under "Advanced"; its value stays in the form store, so
 * it comes back if the field is shown again, and an edit form (a merge-patch) leaves the stored
 * value alone. A rule this cannot read leaves the field VISIBLE: an authoring mistake never hides
 * a field, and with it a value, from the person.
 *
 * This is the UI's rule only. The composition CRD drops `displayDependency` and `if/then` alike, and the
 * API server does not apply either; Helm applies an `if/then` written beside it, at deploy time.
 */
export const VISIBLE_WHEN_KEY = 'displayDependency'

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === ''
  || (Array.isArray(value) && value.length === 0)
  || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0)

const same = (left: unknown, right: unknown): boolean => left === right || JSON.stringify(left) === JSON.stringify(right)

const valueAt = (values: unknown, path: FieldPath): unknown =>
  path.reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string | number, unknown>)[key] : undefined), values)

/** True, false, or undefined for a rule that cannot be read. */
const evaluate = (rule: unknown, values: unknown, scope: FieldPath): boolean | undefined => {
  if (Array.isArray(rule)) {
    if (!rule.length) { return undefined }
    const results = rule.map((each) => evaluate(each, values, scope))
    return results.includes(undefined) ? undefined : results.every(Boolean)
  }
  if (!rule || typeof rule !== 'object') { return undefined }
  const { conditionType, dependsOn, value, values: among } = rule as { conditionType?: unknown; dependsOn?: { name?: unknown }; value?: unknown; values?: unknown }
  const name = dependsOn && typeof dependsOn === 'object' ? dependsOn.name : undefined
  if (typeof name !== 'string' || !name.replace('/', '').trim()) { return undefined }
  const actual = valueAt(values, resolveFieldPath(name.trim(), scope))
  if (conditionType === 'value' && 'value' in rule) { return same(actual, value) }
  if (conditionType === 'in' && Array.isArray(among)) { return among.some((each) => same(actual, each)) }
  if (conditionType === 'notEmpty') { return !isEmpty(actual) }
  return undefined
}

/** Whether the field `node`, living in the object at `scope`, is shown for the form's `values`. */
export const isVisible = (node: JSONSchema4 | undefined, values: unknown, scope: FieldPath): boolean => {
  const rule = node?.[VISIBLE_WHEN_KEY] as unknown
  return rule === undefined || evaluate(rule, values, scope) !== false
}

/**
 * Every field the schema hides for these values — nested objects and list rows included — so a
 * saved draft holds only what the person can see.
 */
export const hiddenPaths = (schema: JSONSchema4 | undefined, values: unknown): FieldPath[] => {
  const hidden: FieldPath[] = []
  const walk = (node: JSONSchema4 | undefined, path: FieldPath) => {
    for (const [key, child] of Object.entries(node?.properties ?? {})) {
      const at = [...path, key]
      if (!isVisible(child, values, path)) {
        hidden.push(at)
      } else if (child.properties) {
        walk(child, at)
      } else if (child.items && !Array.isArray(child.items) && child.items.properties) {
        const rows = valueAt(values, at)
        if (Array.isArray(rows)) {
          rows.forEach((_, index) => { walk(child.items, [...at, index]) })
        }
      }
    }
  }
  walk(schema, [])
  return hidden
}

/** `value` without the key at `path`; copies only what it changes. */
const without = (value: unknown, path: FieldPath): unknown => {
  if (!path.length || !value || typeof value !== 'object') { return value }
  const [head, ...rest] = path
  if (Array.isArray(value)) {
    return value.map((row: unknown, index) => (index === head ? without(row, rest) : row))
  }
  const record = value as Record<string, unknown>
  if (typeof head !== 'string' || !(head in record)) { return value }
  if (!rest.length) {
    return Object.fromEntries(Object.entries(record).filter(([key]) => key !== head))
  }
  return { ...record, [head]: without(record[head], rest) }
}

/**
 * `values` without the fields at `paths`. Removed, not set to `undefined`: merged over initial
 * values (an Autopilot draft is), an `undefined` would erase the value it was merged over.
 */
export const omitPaths = <T extends Record<string, unknown>>(values: T, paths: FieldPath[]): T =>
  paths.reduce<unknown>((current, path) => without(current, path), values) as T
