import type { JSONSchema4 } from 'json-schema'
import { createContext } from 'react'

/**
 * The whole schema a field belongs to, for what a field cannot see from its own node: the title
 * of the field its options depend on, and whether that dependency runs in a cycle.
 */
export interface SchemaRoot {
  schema: JSONSchema4
  /** `templateKey`s of fields caught in a `dependsOn` cycle (see `collectDependencies`) */
  cyclic: Set<string>
}

export const SchemaRootContext = createContext<SchemaRoot | null>(null)
