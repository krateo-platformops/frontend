import type { JSONSchema4 } from 'json-schema'

import { isSecretArrayNode, isSecretSchemaNode } from '../../utils/secretFields'

import { OPTIONS_KEY } from './fieldKeys'

/** A concrete form path: object keys and list-row indexes, as antd names a field. */
export type FieldPath = Array<string | number>

/** A schema path: object keys, and ROW for "any row of this list". */
export const ROW = '[]'
type TemplatePath = string[]

/**
 * Extras names a field's value may NOT be sent under. snowplow does not strip request extras on
 * the RESTAction path, and these are the names a RESTAction reads the caller's identity from: a
 * form field must never be able to say who the caller is.
 */
export const RESERVED_PARAMS = new Set(['username', 'groups', 'displayName', 'email', 'sub', 'uid'])

/** An extras name: a plain identifier, so it is never mistaken for a path. */
export const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Where a `field` reference points from a field that lives in the object at `scope`.
 * `"region"` and `"network.region"` are relative to that object, and `"/spec.region"` starts at
 * the root of the form. A ROW in an absolute reference (`"/hosts.[].region"`, as fieldConfig.ts
 * writes a reference into a list) takes the row of `scope` when `scope` is in that list.
 */
export const resolveFieldPath = (field: string, scope: FieldPath): FieldPath => {
  const absolute = field.startsWith('/')
  const keys = (absolute ? field.slice(1) : field).split('.').filter(Boolean)
  if (!absolute) { return [...scope, ...keys] }
  return keys.map((key, index) => {
    const inScope = key === ROW && index < scope.length && keys.slice(0, index).every((each, i) => each === scope[i] || (each === ROW && typeof scope[i] === 'number'))
    return inScope ? scope[index] : key
  })
}

export interface DependsOn {
  /** the field whose value the options depend on (see `resolveFieldPath`) */
  field: string
  /** the extras name the RESTAction reads that value from */
  param: string
}

/**
 * A dependency as fieldConfig.ts writes it from a `dependencies` entry, or a reason it cannot be
 * used — worded in the entry's own terms (`dependsOn.name`, `extra.key`).
 */
export const parseDependsOn = (raw: unknown): { dependsOn?: DependsOn; problem?: string } => {
  if (raw === undefined) { return {} }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return { problem: 'dependsOn.name must name a field' } }
  const { field, param } = raw as { field?: unknown; param?: unknown }
  if (typeof field !== 'string' || !field.replace('/', '').trim()) { return { problem: 'dependsOn.name must name a field of the form' } }
  if (typeof param !== 'string' || !PARAM_NAME.test(param)) { return { problem: 'extra.key must be a plain name' } }
  if (RESERVED_PARAMS.has(param)) { return { problem: `extra.key cannot be "${param}": that name carries the caller's identity` } }
  return { dependsOn: { field: field.trim(), param } }
}

/** The schema node at a concrete or template path (list rows read the list's `items`). */
export const nodeAt = (root: JSONSchema4 | undefined, path: Array<string | number>): JSONSchema4 | undefined => {
  let node = root
  for (const key of path) {
    if (!node) { return undefined }
    if (typeof key === 'number' || key === ROW) {
      node = Array.isArray(node.items) ? undefined : node.items
    } else {
      node = node.properties?.[key]
    }
  }
  return node
}

export const isSecretNode = (node: JSONSchema4 | undefined): boolean =>
  !!node && (isSecretSchemaNode(node) || isSecretArrayNode(node))

const templateOf = (path: Array<string | number>): TemplatePath => path.map((key) => (typeof key === 'number' ? ROW : key))
export const templateKey = (path: Array<string | number>): string => JSON.stringify(templateOf(path))

export interface Dependency {
  child: TemplatePath
  parent: TemplatePath
}

/**
 * Every dependency in a schema (the `dependencies` of widgetData, applied by fieldConfig.ts), as
 * template paths, and the fields caught in a cycle (A depends on B depends on A) — those never
 * load, and say why.
 */
export const collectDependencies = (schema: JSONSchema4 | undefined): { dependencies: Dependency[]; cyclic: Set<string> } => {
  const dependencies: Dependency[] = []
  const walk = (node: JSONSchema4 | undefined, path: TemplatePath, scope: TemplatePath) => {
    if (!node || typeof node !== 'object') { return }
    const raw = (node[OPTIONS_KEY] as { dependsOn?: unknown } | undefined)?.dependsOn
    const { dependsOn } = parseDependsOn(raw)
    if (dependsOn && path.length) {
      dependencies.push({ child: path, parent: templateOf(resolveFieldPath(dependsOn.field, scope)) })
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      walk(child, [...path, key], path)
    }
    if (node.items && !Array.isArray(node.items)) {
      walk(node.items, [...path, ROW], [...path, ROW])
    }
  }
  walk(schema, [], [])

  const edges = new Map<string, string[]>()
  for (const { child, parent } of dependencies) {
    const from = JSON.stringify(child)
    edges.set(from, [...(edges.get(from) ?? []), JSON.stringify(parent)])
  }
  const cyclic = new Set<string>()
  for (const start of edges.keys()) {
    const seen = new Set<string>()
    const stack = [...(edges.get(start) ?? [])]
    while (stack.length) {
      const next = stack.pop() as string
      if (next === start) {
        cyclic.add(start)
        break
      }
      if (!seen.has(next)) {
        seen.add(next)
        stack.push(...(edges.get(next) ?? []))
      }
    }
  }
  return { cyclic, dependencies }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** The concrete paths antd's `onValuesChange` reports as changed (sparse list rows skipped). */
export const changedPaths = (changed: unknown, prefix: FieldPath = []): FieldPath[] => {
  if (Array.isArray(changed)) {
    // A list is reported whole when a row is added or removed: the list itself changed.
    const rows = changed.flatMap((row, index) => (row === undefined ? [] : changedPaths(row, [...prefix, index])))
    return prefix.length ? [prefix, ...rows] : rows
  }
  if (isPlainObject(changed)) {
    return Object.entries(changed).flatMap(([key, value]) => changedPaths(value, [...prefix, key]))
  }
  return prefix.length ? [prefix] : []
}

/** Binds a template to a concrete path it covers, returning the row indexes it bound, or null. */
const bind = (template: TemplatePath, path: FieldPath): number[] | null => {
  if (path.length < template.length) { return null }
  const rows: number[] = []
  for (let i = 0; i < template.length; i++) {
    if (template[i] === ROW) {
      if (typeof path[i] !== 'number') { return null }
      rows.push(path[i] as number)
    } else if (template[i] !== path[i]) {
      return null
    }
  }
  return rows
}

/** Every concrete path a template names, filling unbound rows from the form's current lists. */
const expand = (template: TemplatePath, rows: number[], getValue: (path: FieldPath) => unknown): FieldPath[] => {
  let paths: FieldPath[] = [[]]
  let bound = 0
  for (const key of template) {
    if (key !== ROW) {
      paths = paths.map((path) => [...path, key])
    } else if (bound < rows.length) {
      const row = rows[bound]
      bound += 1
      paths = paths.map((path) => [...path, row])
    } else {
      paths = paths.flatMap((path) => {
        const list = getValue(path)
        return Array.isArray(list) ? list.map((_, index) => [...path, index]) : []
      })
    }
  }
  return paths
}

/**
 * The fields to clear after the PERSON changed `changed` (antd's `onValuesChange`, which a
 * programmatic set — initial values, a resumed draft, an Autopilot draft — never fires): every
 * field whose options depend on a changed one, then whatever depends on those, once each. Its
 * old value was picked from options the new parent no longer yields.
 */
export const dependentsToClear = (
  dependencies: Dependency[],
  changed: unknown,
  getValue: (path: FieldPath) => unknown,
): FieldPath[] => {
  const queue = changedPaths(changed)
  const seen = new Set(queue.map((path) => JSON.stringify(path)))
  const cleared: FieldPath[] = []
  while (queue.length) {
    const path = queue.shift() as FieldPath
    for (const { child, parent } of dependencies) {
      const rows = bind(parent, path)
      if (!rows) { continue }
      for (const target of expand(child, rows, getValue)) {
        const key = JSON.stringify(target)
        if (seen.has(key)) { continue }
        seen.add(key)
        if (getValue(target) !== undefined) { cleared.push(target) }
        queue.push(target)
      }
    }
  }
  return cleared
}
