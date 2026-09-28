/**
 * CONDITIONS — which values select the machine (mockup screens 8b/8c).
 *
 * A node with `when: .Values.x` renders only while that value is truthy, and an edge can carry its
 * own `when`. So the chart has one machine per combination of those values, and the composer, which
 * has no install's values, used to show only the one its defaults select. Each distinct path is a
 * CONDITION: it starts at what `values.yaml` gives (the machine a default install runs) and can be
 * switched to see the other variant. Switching is a VIEW, never an edit — nothing here writes.
 *
 * The variant is the SAME descriptor with the switched-off nodes, and every edge into or out of
 * them, taken out; its states are derived by the one kernel (deriveStates), so they renumber — the
 * builder-publish chart has four states with `source.url` set and three without it.
 */
import { load } from 'js-yaml'

import type { ChartArchitecture } from './architecture'

/** One condition: a `when` path, what values.yaml gives it, and the nodes and edges it guards. */
export interface Condition {
  path: string
  /**
   * The default switch position. A path values.yaml SETS starts at its Helm truthiness; a path it
   * does not mention starts ON — a value an install is expected to supply, so the descriptor as
   * written (every node, every edge) is what shows until someone switches it.
   */
  byDefault: boolean
  /** Whether values.yaml mentions the path at all — what the strip says about the default. */
  inValues: boolean
  /** Nodes whose own `when` is this path. */
  nodes: string[]
}

const parseValues = (text: string | undefined): unknown => {
  if (!text) { return {} }
  try {
    return load(text) ?? {}
  } catch {
    // An unparseable values.yaml is the lint's to report; the conditions then start ON.
    return null
  }
}

/** The value at `.Values.a.b`, or undefined when values.yaml does not set it (or cannot be read). */
const valueAt = (values: unknown, path: string): unknown => {
  const match = /^\.Values\.(.+)$/.exec(path)
  if (values === null || !match) { return undefined }
  let current: unknown = values
  for (const key of match[1].split('.')) {
    if (typeof current !== 'object' || current === null || !Object.prototype.hasOwnProperty.call(current, key)) { return undefined }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Helm's `if`: false, 0, "", nil, and an empty list or map are false; anything else is true. */
const truthy = (value: unknown): boolean => {
  if (value === undefined || value === null || value === false || value === 0 || value === '') { return false }
  if (Array.isArray(value)) { return value.length > 0 }
  if (typeof value === 'object') { return Object.keys(value).length > 0 }
  return true
}

/** Every distinct `when` path — nodes' and edges' — in descriptor order. */
export const conditionsOf = (arch: ChartArchitecture, valuesYaml: string | undefined): Condition[] => {
  const values = parseValues(valuesYaml)
  const order: string[] = []
  const add = (path: string | undefined) => {
    if (path && !order.includes(path)) { order.push(path) }
  }
  for (const node of arch.resources) {
    add(node.when)
    for (const dep of node.dependsOn ?? []) { add(dep.when) }
  }
  return order.map((path) => {
    const value = valueAt(values, path)
    return {
      byDefault: value === undefined ? true : truthy(value),
      inValues: value !== undefined,
      nodes: arch.resources.filter((node) => node.when === path).map((node) => node.id),
      path,
    }
  })
}

/** The switch positions a person has not touched yet: every condition at its default. */
export const defaultPositions = (conditions: readonly Condition[]): Record<string, boolean> =>
  Object.fromEntries(conditions.map((condition) => [condition.path, condition.byDefault]))

export interface Variant {
  /** The descriptor as these values render it: switched-off nodes, and their edges, taken out. */
  architecture: ChartArchitecture
  /** The nodes a switched-off condition keeps out — drawn dimmed and dashed, never counted as waiting. */
  absent: string[]
}

/**
 * The variant the switch positions select. A path missing from `positions` is ON — the descriptor
 * as written — so an unknown or new condition never silently removes a node.
 */
export const applyConditions = (arch: ChartArchitecture, positions: Readonly<Record<string, boolean>>): Variant => {
  const off = (path: string | undefined) => !!path && positions[path] === false
  const absent = arch.resources.filter((node) => off(node.when)).map((node) => node.id)
  const gone = new Set(absent)
  const resources = arch.resources
    .filter((node) => !gone.has(node.id))
    .map((node) => {
      if (!node.dependsOn?.length) { return node }
      const dependsOn = node.dependsOn.filter((dep) => !gone.has(dep.ref) && !off(dep.when))
      return dependsOn.length === node.dependsOn.length ? node : { ...node, dependsOn }
    })
  return { absent, architecture: absent.length || resources.some((node, idx) => node !== arch.resources[idx]) ? { ...arch, resources } : arch }
}

/** A variant's one-line name for the state panel: `source.url set · tls empty`. */
export const variantLabel = (conditions: readonly Condition[], positions: Readonly<Record<string, boolean>>): string =>
  conditions.map((condition) => `${condition.path.replace(/^\.Values\./, '')} ${positions[condition.path] === false ? 'empty' : 'set'}`).join(' · ')
