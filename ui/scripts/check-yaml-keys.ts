/**
 * Guard: an unquoted YAML key that the APPLIER will not keep as a string.
 *
 * WHY THIS EXISTS (#575). The two halves of our stack read the same YAML differently, and the split
 * is live today — it owes nothing to any upgrade:
 *
 *   js-yaml (the frontend, since v4)   YAML 1.2   `y: y` -> {"y": "y"}
 *   kubectl v1.36.2                    YAML 1.1   `y: y` -> {true: true}
 *
 * The apiserver is NOT the 1.1 component: the Kubernetes API is JSON over HTTP and never parses
 * YAML. kubectl and Helm do the conversion client-side, and that is where 1.1 resolution happens.
 *
 * A key is the dangerous position. `y:` becomes the key `"true"`, so the value lands on a channel
 * nothing reads and SILENTLY no-ops — no error, the chart just ignores it. Already hit twice in the
 * dashboard work, both in @ant-design/plots config passed through widgetData: a PieChart's
 * `annotations[].style.y` and a LineChart's `scale.y`/`axis.y`.
 *
 * AND TWO KEYS CAN COLLIDE INTO ONE, which is worse than a rename. Measured through
 * `kubectl create --dry-run=client -o json`:
 *
 *   y + on      ->  {"true": "beta"}                  1 key of 2 — the first value DESTROYED
 *   yes + true  ->  {"true": "beta"}                  1 key of 2 — and they share no characters
 *   y + n       ->  {"true": "alpha", "false": "beta"} 2 keys of 2 — renamed, nothing lost
 *   x + z       ->  {"x": "alpha", "z": "beta"}        CONTROL, untouched
 *
 * So the severities are not a matter of taste. Two keys from the SAME bucket lose data; one from
 * each is only a rename. Flagging both at one level is how a lint that fires on every y/n pair gets
 * switched off, and then it is absent for the y/on case that destroys a value.
 *
 * WHY THE `yaml` PACKAGE AND NOT js-yaml. The whole question is whether the key was QUOTED, since
 * quoting is the fix — and js-yaml's `load` cannot tell: `y:` and `"y":` both arrive as the string
 * key `"y"`. `yaml`'s AST gives each key scalar a `type` (PLAIN vs QUOTE_SINGLE/QUOTE_DOUBLE), and
 * it also gets two cases a line-oriented scan gets wrong — verified before relying on either:
 * a key inside a flow mapping `{n: 1}` IS found, and a `y:` inside a `|` block scalar is NOT
 * mistaken for a key. Helm templates are full of block scalars, so that second one matters.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import chalk from 'chalk'
import { glob } from 'glob'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Every YAML this repo SHIPS or feeds to a parser. Charts are applied; fixtures pin behaviour. */
const GLOBS = ['helm/**/*.{yaml,yml}', 'ui/src/**/*.{yaml,yml}', 'ui/scripts/**/*.{yaml,yml}']

/**
 * What YAML 1.1 resolves a plain scalar to, where 1.2 keeps a string. Every entry below was
 * measured against kubectl v1.36.2, not taken from a spec — including the case variants, which do
 * convert, and the numeric forms, which normalise rather than stay as written.
 */
const BOOLEAN_BUCKETS = new Map<string, string>()
for (const token of ['y', 'yes', 'on', 'true']) {
  for (const spelling of [token, token.toUpperCase(), token[0].toUpperCase() + token.slice(1)]) {
    BOOLEAN_BUCKETS.set(spelling, 'true')
  }
}
for (const token of ['n', 'no', 'off', 'false']) {
  for (const spelling of [token, token.toUpperCase(), token[0].toUpperCase() + token.slice(1)]) {
    BOOLEAN_BUCKETS.set(spelling, 'false')
  }
}

/**
 * The value the applier will use for this key, or null when it keeps the key as written.
 *
 * Numeric keys are included because they were measured to normalise too: `0777` -> `511` (octal
 * under 1.1) and `1.0` -> `1` (a float rendered back as its shortest form). That second one is the
 * same coercion blueprintDraft.ts already documents for `version: 1.0`.
 */
const appliedKey = (key: string): string | null => {
  const asBoolean = BOOLEAN_BUCKETS.get(key)
  if (asBoolean !== undefined) {
    return asBoolean
  }
  // Octal: a leading zero with only digits after it. 1.1 reads it as base 8.
  if (/^0[0-7]+$/.test(key)) {
    return String(parseInt(key, 8))
  }
  // Any other number-shaped key is re-rendered from its numeric value, so `1.0` and `1.00` both
  // become `1` and collide with a key literally written `1`.
  if (/^-?\d+\.\d+$/.test(key) && String(Number(key)) !== key) {
    return String(Number(key))
  }
  return null
}

/**
 * The key EXACTLY as it was written, or null when it is not a plain scalar key.
 *
 * `source` and not `value`, because `value` is already resolved: a key written `0777` arrives as the
 * number 777 and `1.0` as 1, so a check on `typeof value === 'string'` silently skipped every
 * numeric key and left this guard's octal and float arms as dead code. A control caught it — the
 * repo has no such keys, so nothing else would have.
 *
 * It also means this reads what the AUTHOR typed, which is the only thing a lint about spelling can
 * sensibly judge.
 */
const plainKeySource = (key: unknown): string | null => {
  if (!isScalar(key) || key.type !== 'PLAIN') {
    return null
  }
  return typeof key.source === 'string' ? key.source : null
}

type Finding = {
  /** `path:line key -> applied` — stable enough to baseline, specific enough to find. */
  id: string
  collision: boolean
}

/** Walk a document, reporting every PLAIN key the applier will not keep as written. */
const walk = (node: unknown, file: string, source: string, findings: Finding[]): void => {
  if (isSeq(node)) {
    for (const item of node.items) {
      walk(item, file, source, findings)
    }
    return
  }
  if (!isMap(node)) {
    return
  }

  // Per-mapping, because a collision is a property of ONE mapping: two keys elsewhere in the
  // document that happen to share a bucket are not a collision and must not be reported as one.
  const appliedHere = new Map<string, string[]>()
  for (const item of node.items) {
    const written = plainKeySource(item.key)
    if (written !== null) {
      const applied = appliedKey(written)
      if (applied !== null) {
        appliedHere.set(applied, [...(appliedHere.get(applied) ?? []), written])
      }
    }
  }

  for (const item of node.items) {
    const key = plainKeySource(item.key)
    if (key === null) {
      walk(item.value, file, source, findings)
      continue
    }
    const applied = appliedKey(key)
    if (applied !== null) {
      const sharing = appliedHere.get(applied) ?? []
      // `range[0]` is a CHARACTER OFFSET, not a line. Reporting it as `file:22` reads exactly like
      // a line number and sends the reader to the wrong place, so convert it.
      const offset = isScalar(item.key) && item.key.range ? item.key.range[0] : null
      const line = offset === null ? '?' : `${source.slice(0, offset).split('\n').length}`
      findings.push({ collision: sharing.length > 1, id: `${file}:${line} ${key} -> ${applied}` })
    }
    walk(item.value, file, source, findings)
  }
}

const files = (await Promise.all(GLOBS.map(async (pattern) => glob(pattern, { cwd: ROOT, nodir: true }))))
  .flat()
  .filter((file) => !file.includes('node_modules'))
  .sort()

const findings: Finding[] = []
for (const file of files) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  let doc: ReturnType<typeof parseDocument>
  try {
    doc = parseDocument(text)
  } catch {
    // An unparseable file is not this guard's business — the chart lints and the CRD guard own that.
    continue
  }
  walk(doc.contents, relative('.', file), text, findings)
}

const collisions = findings.filter((finding) => finding.collision)
const renames = findings.filter((finding) => !finding.collision)

// NO BASELINE, deliberately. A baseline exists to let a guard land on a repo that already has debt;
// this repo has none — 0 findings across 168 files — so there is nothing to grandfather. And the fix
// is always available and always safe (quote the key), so there is never a case for recording a
// finding instead of fixing it. An --update flag here would only ever be a way to silence one.
if (collisions.length) {
  console.error(chalk.red(`yaml-keys: ${collisions.length} key(s) COLLIDE — a value will be silently destroyed.`))
  console.error('')
  console.error('Two or more unquoted keys in the same mapping resolve to the SAME value once the')
  console.error('applier converts them, so one overwrites the other. Measured through kubectl:')
  console.error('`y` and `on` in one mapping become a single key `"true"`, and the first value is')
  console.error('gone — no error, no warning, no trace.')
  console.error('')
  for (const finding of collisions) {
    console.error(`  ${finding.id}`)
  }
  console.error('')
}

if (renames.length) {
  console.error(chalk.red(`yaml-keys: ${renames.length} unquoted key(s) the applier will rename.`))
  console.error('')
  console.error('js-yaml keeps these as written (YAML 1.2); kubectl and Helm convert them (YAML 1.1).')
  console.error('So the builder preview reads the key you wrote and the cluster stores a different')
  console.error('one — the value lands on a channel nothing reads and silently no-ops. This is how a')
  console.error('PieChart lost `annotations[].style.y` and a LineChart lost `scale.y`.')
  console.error('')
  for (const finding of renames) {
    console.error(`  ${finding.id}`)
  }
  console.error('')
}

if (collisions.length || renames.length) {
  console.error(chalk.bold('Quote the key:'), '`"y":` is the one spelling every parser agrees on.')
  process.exit(1)
}

console.warn(chalk.green(`yaml-keys: ${files.length} file(s) clean`))
