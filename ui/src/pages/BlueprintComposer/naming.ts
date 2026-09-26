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
 * `range`. The forEach variant appends the item's index as `-i<index>` — and truncates the prefix to
 * 55 first, so "-i" plus a six-digit index still fits in 63 — which is also what S4b's gates look the
 * object up by, so the two cannot come to disagree.
 *
 * WHY `-i<index>` AND NOT `-<index>`. A second node of a kind is `<kind>-2`, so a bare index would
 * name item 2 of a ranged `deployment` exactly what the node `deployment-2` names its object — two
 * objects under one name in the cluster, and one name under two nodes on the detail page. An id is
 * `<base>` or `<base>-<n>`, and a Kind of letters and digits (every one in practice) never makes a
 * base that ends `-i<n>`, so the per-item names and the placed ids cannot meet. `readPlacedName` and
 * `itemNamesMeet` are the other half: the lint's check (L5) for whatever still does — a dashed Kind,
 * an old draft, a hand edit, the agent.
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

/** What marks an item's index in a per-item name: `<release>-<id>-i<index>`. */
export const ITEM_MARKER = 'i'

/** The Helm expression for a placed node's `metadata.name` — per item when it ranges. */
export const placedNameExpression = (id: string, forEach: boolean): string => (forEach
  ? `printf "%s-${ITEM_MARKER}%d" (printf "%s-${id}" $.Release.Name | trunc 55 | trimSuffix "-") (int $i)`
  : `printf "%s-${id}" $.Release.Name | trunc 63 | trimSuffix "-"`)

/**
 * A name expression of the placed SHAPE, read back — whatever its truncation and index marker:
 * `{ stem }` names one object `<release>-<stem>`; `{ stem, marker }` names item n
 * `<release>-<stem>-<marker><n>`. Null for any other expression, which is not second-guessed.
 */
export type PlacedName = { stem: string; marker?: undefined } | { stem: string; marker: string }

const SINGLE_NAME = /^printf "%s-([a-z0-9-]+)" \$?\.Release\.Name \| trunc \d+ \| trimSuffix "-"$/
const ITEM_NAME = /^printf "%s-([a-z0-9-]*)%d" \(printf "%s-([a-z0-9-]+)" \$?\.Release\.Name \| trunc \d+ \| trimSuffix "-"\) \(int \$i\)$/

export const readPlacedName = (expression: string): PlacedName | null => {
  const item = ITEM_NAME.exec(expression)
  if (item) { return { marker: item[1], stem: item[2] } }
  const single = SINGLE_NAME.exec(expression)
  return single ? { stem: single[1] } : null
}

/**
 * Whether some item of a ranged name is the single object `single` names — for a release short
 * enough that neither is truncated. `%d` of an int writes no leading zero, so `-07` is no index.
 */
export const itemNamesMeet = (item: { stem: string; marker: string }, single: string): boolean => {
  const prefix = `${item.stem}-${item.marker}`
  return single.startsWith(prefix) && /^(?:0|[1-9]\d*)$/.test(single.slice(prefix.length))
}
