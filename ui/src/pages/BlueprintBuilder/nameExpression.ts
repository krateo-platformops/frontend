/**
 * What a node's object is called, read off its template — and that name made safe to evaluate
 * anywhere in another template. Pure.
 *
 * WHY A GATE NEEDS IT. A gate withholds a dependent until a `lookup` of its dependency finds the live
 * object, and a lookup finds an object by NAME. A guessed name (`<release>-<id>`) never matches a
 * chart that names its objects any other way — builder-publish's repository is `<name>-repo` — and a
 * lookup that never matches is a gate that never opens, and says nothing (C9). So the name is the
 * template's own: the expression its `metadata.name` writes.
 *
 * THE DESCRIPTOR HOLDS IT (S11a's `name`), in the template's own words, so the lint can hold the two
 * equal (L4) and the graph block evaluates the same names the gate looks up. `nameExpressionOf` is
 * how a node that has none gets one, from its template, when an edge first needs it: the gate reads
 * `name` from the descriptor, never from a second source. The template's own range variables are
 * renamed to the `$i` and `$f` the gate and the graph block bind; any other variable is refused — it
 * is not in scope where the name is evaluated.
 *
 * ROOT-SCOPED WHERE IT IS EVALUATED (`scopeToRoot`). A gate may sit inside its dependent's `range`,
 * where `.` is the item: `.Values.name` there is the item's `Values`, which is nothing. So every
 * `.Values`, `.Release`, `.Chart`, `.Capabilities`, `.Files` and `.Template` a gate splices in — a
 * name, an edge's `when` — becomes `$.…`, and a bare `.` argument becomes `$`. Text inside quotes is
 * left alone.
 */
import { extractNameExpression } from './gateExtract'
import { scanBlocks, stripComments } from './helmBlocks'

const ROOT_FIELDS = /(^|[^\w$.)\]])\.(Values|Release|Chart|Capabilities|Files|Template)\b/g
const BARE_DOT = /(^|[\s(|,])\.(?=$|[\s)|,])/g

/** Go template string literals: interpreted and raw. Their text is never scoped. */
const STRINGS = /("(?:[^"\\]|\\.)*"|`[^`]*`)/

/** An expression evaluated from the root wherever it stands — see the header. */
export const scopeToRoot = (expr: string): string => expr.split(STRINGS)
  .map((part, idx) => (idx % 2 ? part : part.replace(ROOT_FIELDS, '$1$.$2').replace(BARE_DOT, '$1$')))
  .join('')

/** The raw value of the first `metadata.name` — the line a refusal quotes — and its index. */
const metadataNameLine = (lines: string[]): { value: string; idx: number } | null => {
  const kindAt = lines.findIndex((line) => /^kind:/.test(line))
  const metaAt = kindAt < 0 ? -1 : lines.findIndex((line, idx) => idx > kindAt && /^metadata:\s*$/.test(line))
  if (metaAt < 0) { return null }
  for (let idx = metaAt + 1; idx < lines.length; idx += 1) {
    if (/^(---|[A-Za-z_][\w.-]*:)/.test(lines[idx])) { return null }
    const found = /^ {2}name:\s*(.*?)\s*$/.exec(lines[idx])
    if (found) { return { idx, value: found[1] } }
  }
  return null
}

const RANGE_VARS = /^(\$\w+)\s*(?:,\s*(\$\w+)\s*)?:=/

/**
 * The template with the variables of the `range` around its name renamed to `$i` (index) and `$f`
 * (item) — or unchanged when there is none, they already are, or the new names are taken elsewhere.
 */
const withBoundRangeVars = (template: string, lines: string[], at: number): string => {
  const range = [...scanBlocks(lines)[at]].reverse().find((block) => block.keyword === 'range' && RANGE_VARS.test(block.cond))
  const vars = range ? RANGE_VARS.exec(range.cond) : null
  if (!vars) { return template }
  const renames: [string, string][] = vars[2] ? [[vars[1], '$i'], [vars[2], '$f']] : [[vars[1], '$f']]
  const pending = renames.filter(([from, to]) => from !== to)
  if (pending.some(([, to]) => new RegExp(`\\${to}\\b`).test(template))) { return template }
  return pending.reduce((text, [from, to]) => text.replace(new RegExp(`\\${from}\\b`, 'g'), to), template)
}

export type NameExpression = { ok: true; expr: string } | { ok: false; reason: string }

/**
 * The expression `path`'s object is named by, as the descriptor's `name` holds it — or the sentence
 * that says why the composer cannot tell. `id` and `path` are only for that sentence.
 */
export const nameExpressionOf = (template: string, { id, path }: { id: string; path: string }): NameExpression => {
  const lines = stripComments(template).split('\n')
  const line = metadataNameLine(lines)
  const expr = line ? extractNameExpression(withBoundRangeVars(template, lines, line.idx)) : null
  if (expr) {
    return { expr, ok: true }
  }
  const sets = line ? `sets metadata.name with ${line.value}` : 'sets no metadata.name'
  return { ok: false, reason: `The composer cannot tell what ${id} is named: ${path} ${sets}. Name it with one expression over $.Release.Name or $.Values, and try again.` }
}
