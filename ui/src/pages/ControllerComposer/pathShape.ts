/**
 * The shape of an API's paths, by which the operation-mapping kernel (operationMapping.ts) reads its
 * verbs: segments and parameters, item paths and the collections they sit under. Pure.
 */
export const segmentsOf = (path: string): string[] => path.split('/').filter((segment) => segment.length > 0)
export const isParam = (segment: string | undefined): boolean => !!segment && /^\{[^}]+\}$/.test(segment)
export const pathParamsOf = (path: string): string[] => segmentsOf(path).filter(isParam).map((segment) => segment.slice(1, -1))

/** A path with every parameter's NAME dropped: `/db/{databaseName}` and `/db/{name}` both read `/db/{}`. */
export const normalizedPath = (path: string): string => `/${segmentsOf(path).map((segment) => (isParam(segment) ? '{}' : segment)).join('/')}`
export const parentOf = (normalized: string): string => `/${segmentsOf(normalized).slice(0, -1).join('/')}`

/** The shape the selected operations give the paths: which are items, which are collections. */
export interface PathShape {
  /** Normalized item paths → the first raw path seen for each (what a sentence names). */
  items: ReadonlyMap<string, string>
  /** Normalized collection paths (each item path's parent) → a raw spelling. */
  collections: ReadonlyMap<string, string>
}

export const pathShapeOf = (operations: readonly { path: string }[]): PathShape => {
  const items = new Map<string, string>()
  const collections = new Map<string, string>()
  for (const { path } of operations) {
    if (!isParam(segmentsOf(path).pop())) { continue }
    const normalized = normalizedPath(path)
    if (!items.has(normalized)) { items.set(normalized, path) }
    const parent = parentOf(normalized)
    if (!collections.has(parent)) { collections.set(parent, `/${segmentsOf(path).slice(0, -1).join('/')}`) }
  }
  return { collections, items }
}

/** The response field a renamed path parameter stands for (petId → id, userName → name), or null. */
export const standInName = (param: string): string | null => {
  const match = /^(.+?)(Id|_id|ID|Name|_name)$/.exec(param)
  if (!match) {
    return null
  }
  return /name/i.test(match[2]) ? 'name' : 'id'
}
