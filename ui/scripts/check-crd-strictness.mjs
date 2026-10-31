#!/usr/bin/env node
/**
 * Fail the build when a widget CRD grows a NEW `x-kubernetes-preserve-unknown-fields` node.
 *
 * WHY THIS IS NOT A STYLE CHECK. snowplow uses the generated CRD schema as its RUNTIME validation
 * oracle: it compiles each widget CRD's structural schema and validates the object's
 * widgetData/status payload against it, failing closed when the schema is absent
 * (snowplow internal/resolvers/crds/schema/schema.go). So a node marked preserve-unknown does not
 * merely relax `kubectl apply` — it makes snowplow's validation of that whole subtree VACUOUS. It
 * accepts anything, reports nothing, and the only symptom is bad widget data arriving somewhere
 * downstream that did not expect it.
 *
 * The inverse costs more. A node wrongly NARROWED — say `type: integer` where the source schema
 * said `["integer","string"]` — makes snowplow REJECT valid widget content at request time. Both
 * directions are silent at generation.
 *
 * WHY AN ALLOWLIST RATHER THAN A BAN. 153 of these nodes are deliberate and load-bearing: `status`
 * is open on every kind, `resourcesRefs[].payload` and action `ops[].payload` carry arbitrary
 * request bodies, Form's `schema` and `initialValues` hold a user-authored JSON Schema, and each
 * chart's `data.items` is unstructured by design. Banning the construct would be wrong; the thing
 * worth detecting is a node that became permissive WITHOUT anyone deciding it should.
 *
 * This matters most during a generator change. `crdgen`'s `transpileAllOf` sets preserve-unknown on
 * EVERY merged node — even one merging two clean object members — and so do `patternProperties`,
 * divergent unions, reference cycles and unresolved `$ref`s. Any of those appearing in a widget
 * schema silently widens the CRD, and this check is what turns that into a failed build.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import yaml from 'js-yaml'

// Resolved from THIS file's location, not from cwd: CI runs it from the repo root and
// `npm run check-crd-strictness` runs it from ui/, and a cwd-relative path works in exactly one
// of those. The script lives at ui/scripts/, so the repo root is two levels up.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CRD_DIR = join(ROOT, 'helm/frontend-crds/templates')
const BASELINE = join(ROOT, 'ui/scripts/crd-preserve-unknown.baseline.json')

/** Every path under `node` carrying preserve-unknown, as dotted paths with array indices kept. */
const collect = (node, path, out) => {
  if (Array.isArray(node)) {
    node.forEach((value, index) => collect(value, `${path}[${index}]`, out))
    return
  }
  if (node === null || typeof node !== 'object') {
    return
  }
  if (node['x-kubernetes-preserve-unknown-fields'] === true) {
    out.push(path || '<root>')
  }
  for (const [key, value] of Object.entries(node)) {
    collect(value, path ? `${path}.${key}` : key, out)
  }
}

/** `<Kind>: <path>` for every preserve-unknown node in every CRD, sorted and stable. */
const scan = () => {
  const found = []
  for (const file of readdirSync(CRD_DIR).filter((f) => f.endsWith('.crd.yaml')).sort()) {
    const paths = []
    collect(yaml.load(readFileSync(join(CRD_DIR, file), 'utf8')), '', paths)
    for (const path of paths.sort()) {
      found.push(`${file}: ${path}`)
    }
  }
  return found
}

const current = scan()

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`crd-strictness: baseline written, ${current.length} permissive nodes`)
  process.exit(0)
}

let baseline
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
} catch {
  console.error(`crd-strictness: no baseline at ${BASELINE}. Create it with:\n  node ui/scripts/check-crd-strictness.mjs --update`)
  process.exit(2)
}

const known = new Set(baseline)
const seen = new Set(current)
const added = current.filter((entry) => !known.has(entry))
const removed = baseline.filter((entry) => !seen.has(entry))

// A REMOVAL is reported but does not fail: a node becoming strict is usually the point of a fix,
// and failing on it would make every genuine tightening a build break. An ADDITION fails, because
// nothing should become permissive without someone choosing it.
if (removed.length > 0) {
  console.log(`crd-strictness: ${removed.length} node(s) became STRICT (good, baseline is stale):`)
  for (const entry of removed) {
    console.log(`  - ${entry}`)
  }
}

if (added.length > 0) {
  console.error(`crd-strictness: ${added.length} NEW permissive node(s).`)
  console.error('')
  console.error('Each one makes snowplow\'s validation of that subtree vacuous — it will accept')
  console.error('anything in there and report nothing. Narrow the source schema, or, if the node is')
  console.error('genuinely meant to hold arbitrary content, record the decision:')
  console.error('  node ui/scripts/check-crd-strictness.mjs --update')
  console.error('')
  for (const entry of added) {
    console.error(`  + ${entry}`)
  }
  process.exit(1)
}

console.log(`crd-strictness: ok, ${current.length} permissive nodes, all accounted for`)
