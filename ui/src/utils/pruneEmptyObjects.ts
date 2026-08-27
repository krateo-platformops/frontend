/** True for a `{}`-style plain object (not null, not an array, not a Date/class instance). */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object'
  && value !== null
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

/**
 * Recursively drop empty-plain-object (`{}`) values from a payload before it is PATCHed. The
 * schema-driven Form seeds `{}` for every unfilled nested-object branch; for a k8s UNION field — the
 * probes, whose handlers exec|httpGet|tcpSocket|grpc are `oneOf` (one allowed) — that emits the unfilled
 * branches as `{}` beside the filled one (`livenessProbe:{exec:{},httpGet:{path,port},tcpSocket:{}}`),
 * which k8s rejects ("may not specify more than 1 handler type") and wedges the reconcile; pruning keeps
 * ONLY the populated branch. SAFE — removes ONLY empty PLAIN objects (empty k8s maps like affinity equal
 * absent); empty ARRAYS, `null`, and falsy SCALARS (`false`/`0`/`''`) are preserved; a parent drops only
 * once empty AFTER its children prune (bottom-up); array ELEMENTS are pruned in place, never removed.
 */
export const pruneEmptyObjects = <T>(value: T): T => {
  if (Array.isArray(value)) {
    // Recurse into elements to fix nested unions, but keep every element (don't reshape the array).
    const arr: unknown[] = value
    return arr.map((item) => pruneEmptyObjects(item)) as T
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const pruned = pruneEmptyObjects(child)
      // Drop a child that is (or, after pruning, became) an empty plain object.
      if (isPlainObject(pruned) && Object.keys(pruned).length === 0) {
        continue
      }
      out[key] = pruned
    }
    return out as T
  }

  return value
}
