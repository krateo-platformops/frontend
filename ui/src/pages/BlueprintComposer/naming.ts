/**
 * What a placed node is called — in the descriptor, and in the cluster. Pure.
 *
 * THE ID is the kind, lower-cased and reduced to `[a-z0-9-]`, because it names a file
 * (`templates/<id>.yaml`), a node the person reads on the canvas, and the suffix of every object
 * name the template renders. A second node of the same kind gets `-2`, `-3` … — never a clash with
 * an id the descriptor already holds, with a `templates/<id>.yaml` the chart already has (a
 * hand-written template the descriptor does not list yet is still a file a placement must not
 * overwrite), nor with a template path a node declares (a node whose file is not written yet has
 * still claimed it). At most 40 characters, the suffix included: the rest of a 63-character object
 * name is the release's. The alphabet alone keeps `__proto__` out (architecture.ts refuses it as an id).
 *
 * THE NAME EXPRESSION is the Helm the template writes into `metadata.name`: the release name and the
 * id, truncated to a DNS label. Scoped to `$`, because a template's `.` is not the root inside a
 * `range`. The forEach variant appends the item's index — and truncates the prefix to 56 first, so
 * "-" plus a six-digit index still fits in 63 — which is also what S4b's gates look the object up
 * by, so the two cannot come to disagree.
 */

/** The longest id a placement writes, suffix included. */
export const PLACED_ID_MAX = 40

/** The kind, as an id: lower-case, `[a-z0-9-]`, no leading, trailing or doubled dash. */
const idBase = (kind: string): string => {
  const base = kind.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base || 'resource'
}

/** The trimmed base with `suffix`, inside PLACED_ID_MAX and not ending on a dash. */
const withSuffix = (base: string, suffix: string): string =>
  `${base.slice(0, PLACED_ID_MAX - suffix.length).replace(/-+$/, '')}${suffix}`

/**
 * A fresh id for a node of `kind`. `taken` is every id the descriptor holds and every id a
 * `templates/<id>.yaml` implies — held, or declared by a node.
 */
export const placedNodeId = (kind: string, taken: ReadonlySet<string>): string => {
  const base = idBase(kind)
  let candidate = withSuffix(base, '')
  for (let count = 2; taken.has(candidate); count += 1) {
    candidate = withSuffix(base, `-${count}`)
  }
  return candidate
}

/** The Helm expression for a placed node's `metadata.name` — per item when it ranges. */
export const placedNameExpression = (id: string, forEach: boolean): string => (forEach
  ? `printf "%s-%d" (printf "%s-${id}" $.Release.Name | trunc 56 | trimSuffix "-") (int $i)`
  : `printf "%s-${id}" $.Release.Name | trunc 63 | trimSuffix "-"`)
