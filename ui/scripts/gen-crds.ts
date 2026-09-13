/* eslint-disable no-console */
import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'
import { promisify } from 'node:util'

import chalk from 'chalk'
import { glob } from 'glob'
import yaml from 'js-yaml'

const asyncExec = promisify(exec)

const WIDGETS_DIR = join(process.cwd(), 'src', 'widgets')
const OUTPUT_DIR = join(process.cwd(), 'scripts', 'krateoctl-output')

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
}

/** Move a file, fallback to copy+unlink if rename fails */
async function moveFile(src: string, dest: string) {
  try {
    await fs.rename(src, dest)
  } catch {
    await fs.copyFile(src, dest)
    await fs.unlink(src)
  }
}

/**
 * krateoctl (via controller-gen) cannot express a JSON-Schema union like
 * `type: ["integer", "string"]` in a STRUCTURAL CRD schema — it collapses such a
 * node to `type: object`, which then rejects the real scalar values at apply time
 * (e.g. Statistic.widgetData.value `0` / `"1.4k"` → "must be of type object").
 * Post-process the generated CRD: any schema node whose `type` is an array (a
 * union) becomes the structural-schema-legal `x-kubernetes-int-or-string: true`,
 * which accepts an integer-or-string scalar (and still rejects objects) — type-
 * accurate, not relaxed. Today the only union across all widget schemas is
 * `Statistic.widgetData.value`.
 */
async function normalizeUnionTypes(schemaPath: string, crdPath: string): Promise<boolean> {
  // The SOURCE schema still has the union (`type: ["integer","string"]`); krateoctl
  // has already collapsed it to `type: object` in the CRD, so we can't detect it
  // from the CRD alone. Find the union paths in the source `spec` subtree, then
  // patch the same paths in the generated CRD's `spec` schema.
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8')) as Record<string, unknown>
  const unionPaths: string[][] = []
  const collect = (node: unknown, path: string[]): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) { return }
    const obj = node as Record<string, unknown>
    if (Array.isArray(obj.type)) { unionPaths.push(path) }
    for (const [key, value] of Object.entries(obj)) { collect(value, [...path, key]) }
  }
  collect((schema.properties as Record<string, unknown> | undefined)?.spec, [])
  if (unionPaths.length === 0) { return false }

  const doc = yaml.load(await fs.readFile(crdPath, 'utf8')) as {
    spec?: { versions?: Array<{ schema?: { openAPIV3Schema?: { properties?: { spec?: unknown } } } }> }
  }
  const crdSpec = doc.spec?.versions?.[0]?.schema?.openAPIV3Schema?.properties?.spec
  if (!crdSpec) { return false }

  let changed = false
  for (const path of unionPaths) {
    let node: unknown = crdSpec
    for (const key of path) {
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined
    }
    if (node && typeof node === 'object') {
      const target = node as Record<string, unknown>
      delete target.type
      delete target['x-kubernetes-preserve-unknown-fields']
      target['x-kubernetes-int-or-string'] = true
      changed = true
    }
  }
  if (changed) { await fs.writeFile(crdPath, yaml.dump(doc, { lineWidth: -1, noRefs: true })) }
  return changed
}

/**
 * krateoctl renders a typed string/scalar map (`additionalProperties: { type: string }` in
 * the SOURCE schema — e.g. `itemTemplate.color.map`) as a lossy
 * `x-kubernetes-preserve-unknown-fields: true`, which accepts ANY value shape and erodes
 * validation. Restore the source's typed `additionalProperties` at those exact paths so
 * value-maps stay strongly typed. Genuinely free-form nodes (no typed `additionalProperties`
 * in the source) are untouched and keep `preserve-unknown` — the only legitimate use.
 */
async function normalizeTypedMaps(schemaPath: string, crdPath: string): Promise<boolean> {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8')) as Record<string, unknown>
  const mapPaths: Array<{ additionalProperties: unknown; path: string[] }> = []
  const collect = (node: unknown, path: string[]): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) { return }
    const obj = node as Record<string, unknown>
    const ap = obj.additionalProperties
    if (obj.type === 'object' && ap !== null && typeof ap === 'object' && !Array.isArray(ap) && typeof (ap as Record<string, unknown>).type === 'string') {
      mapPaths.push({ additionalProperties: ap, path })
    }
    for (const [key, value] of Object.entries(obj)) { collect(value, [...path, key]) }
  }
  collect((schema.properties as Record<string, unknown> | undefined)?.spec, [])
  if (mapPaths.length === 0) { return false }

  const doc = yaml.load(await fs.readFile(crdPath, 'utf8')) as {
    spec?: { versions?: Array<{ schema?: { openAPIV3Schema?: { properties?: { spec?: unknown } } } }> }
  }
  const crdSpec = doc.spec?.versions?.[0]?.schema?.openAPIV3Schema?.properties?.spec
  if (!crdSpec) { return false }

  let changed = false
  for (const { additionalProperties, path } of mapPaths) {
    let node: unknown = crdSpec
    for (const key of path) {
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined
    }
    if (node && typeof node === 'object' && (node as Record<string, unknown>)['x-kubernetes-preserve-unknown-fields'] === true) {
      const target = node as Record<string, unknown>
      delete target['x-kubernetes-preserve-unknown-fields']
      target.additionalProperties = additionalProperties
      changed = true
    }
  }
  if (changed) { await fs.writeFile(crdPath, yaml.dump(doc, { lineWidth: -1, noRefs: true })) }
  return changed
}

/**
 * Inject `spec.identityContext` into every widget CRD (A6 §1.1). snowplow reads
 * `spec.identityContext` — enum-bounded to jwtutil.UserInfo fields (`username`/`groups`;
 * `displayName` is FORECLOSED per D1) — to inject the server-trusted identity into a widget's
 * L1 cache key + resolve input. The apiserver PRUNES fields absent from a structural CRD schema,
 * so the field MUST be declared in the CRD or snowplow's DeclaredIdentity always reads empty and
 * the whole author-declared cache-identity feature is silently dead. Applied here (CRD post-
 * process, mirroring normalizeUnionTypes/normalizeTypedMaps) so ALL widget kinds get it from ONE
 * place — the field is a uniform envelope member, not per-widget. See snowplow
 * docs/A6-chart-enablement-spec-2026-07-07.md §1.1.
 */
async function injectIdentityContext(crdPath: string): Promise<void> {
  const doc = yaml.load(await fs.readFile(crdPath, 'utf8')) as {
    spec?: { versions?: Array<{ schema?: { openAPIV3Schema?: { properties?: { spec?: { properties?: Record<string, unknown> } } } } }> }
  }
  const specNode = doc.spec?.versions?.[0]?.schema?.openAPIV3Schema?.properties?.spec
  if (!specNode?.properties || specNode.properties.identityContext) { return }
  specNode.properties.identityContext = {
    items: { enum: ['username', 'groups'], type: 'string' },
    type: 'array',
  }
  await fs.writeFile(crdPath, yaml.dump(doc, { lineWidth: -1, noRefs: true }))
}

/**
 * Inject `spec.keyExtras` into every widget CRD (F6 snowplow#130). snowplow's F6 flips the
 * widget cache key to a fold-nothing default: ONLY the request-extras keys a widget declares
 * in `spec.keyExtras` partition its cache cell — undeclared route/query widgets would share
 * one cell across routes/search/filters and serve stale cross-route content. Byte-for-byte
 * mirror of `identityContext` (same array-of-string shape, same optionality) EXCEPT no enum:
 * extras key names are author-open (a Select's queryParam is author-configurable, so an enum
 * would prune valid future declarations). The apiserver PRUNES fields absent from a structural
 * CRD schema, so the field MUST be declared here or the portal's declarations are silently
 * dropped. See snowplow docs/f6-portal-handoff-2026-07-13.md §1.
 */
async function injectKeyExtras(crdPath: string): Promise<void> {
  const doc = yaml.load(await fs.readFile(crdPath, 'utf8')) as {
    spec?: { versions?: Array<{ schema?: { openAPIV3Schema?: { properties?: { spec?: { properties?: Record<string, unknown> } } } } }> }
  }
  const specNode = doc.spec?.versions?.[0]?.schema?.openAPIV3Schema?.properties?.spec
  if (!specNode?.properties || specNode.properties.keyExtras) { return }
  specNode.properties.keyExtras = {
    description: "F6 (snowplow#130): the request-extras keys (route params / URL query folded into ?extras=) whose values this widget's resolution depends on. Only declared keys partition the widget cache cell. Absent/empty = the widget does not vary by any request extra (chrome/layout default).",
    items: { type: 'string' },
    type: 'array',
  }
  await fs.writeFile(crdPath, yaml.dump(doc, { lineWidth: -1, noRefs: true }))
}

/**
 * Inject `spec.freshness` into every widget CRD (opt-in staleness badge). The frontend's
 * freshness/staleness indicator is exception-only AND opt-in PER WIDGET: `freshness: true`
 * shows the subtle stale/refreshing dot overlay (exception states only); absent/false — the
 * default — renders NO badge ever, so healthy widgets stay unmarked (status indicators are
 * exception-only). Byte-for-byte mirror of `identityContext`/`keyExtras` (same optionality,
 * same CRD post-process seam) EXCEPT the shape is a plain boolean. The apiserver PRUNES
 * fields absent from a structural CRD schema, so the field MUST be declared here or an
 * author's opt-in is silently dropped and the badge can never appear.
 */
async function injectFreshness(crdPath: string): Promise<void> {
  const doc = yaml.load(await fs.readFile(crdPath, 'utf8')) as {
    spec?: { versions?: Array<{ schema?: { openAPIV3Schema?: { properties?: { spec?: { properties?: Record<string, unknown> } } } } }> }
  }
  const specNode = doc.spec?.versions?.[0]?.schema?.openAPIV3Schema?.properties?.spec
  if (!specNode?.properties || specNode.properties.freshness) { return }
  specNode.properties.freshness = {
    description: 'Opt-in staleness indicator: when true the widget shows the stale/refreshing dot overlay (exception states only). Absent/false = no badge ever (the default; healthy widgets stay unmarked).',
    type: 'boolean',
  }
  await fs.writeFile(crdPath, yaml.dump(doc, { lineWidth: -1, noRefs: true }))
}

/**
 * Normalize `spec.widgetData.allowedResources` into the COMMON container contract.
 *
 * Every widget that resolves children declares this field, and it is typed `string[]` with NO
 * enum. Both halves of that are deliberate.
 *
 * WHY IT IS ON EVERY CONTAINER: it was on seven kinds and absent from six others that resolve
 * children just as dynamically (`Breadcrumb`, `Card`, `Descriptions`, `Filters`, `Form`, `Steps`),
 * with no principle separating the two groups. A field that means something on `Flex` and nothing
 * on `Card` is not a contract.
 *
 * WHY NO ENUM: the per-widget enums were hand-maintained and had drifted into nonsense. `Flex`
 * listed 28 kinds, `Col` and `Row` 23, `Table` 11, and `Menu` named exactly two — `navmenuitems`
 * and `pages` — BOTH of which the registry documents as removed in the routing refactor. Dead
 * values in a live enum. Nothing could tell whether `Flex` permitting `images` while `Col` did not
 * was design or drift, and adding one widget kind meant editing six frozen lists by hand (adding
 * `pageheaders` did exactly that, and deliberately skipping `Tabs` is now indistinguishable from
 * forgetting it).
 *
 * The enum also bought nothing: `allowedResources` is enforced by NOTHING at runtime — not by
 * OpenAPI, not by a webhook, not by the renderer, which resolves `resourceRefId` without
 * consulting it. So the enum was a maintenance burden pretending to be a constraint.
 *
 * Enforcement therefore lives in the chart lint (design rule X5), which can check declarations
 * against the REAL widget registry instead of a list frozen at schema-authoring time.
 */
async function normalizeAllowedResources(crdPath: string): Promise<boolean> {
  const doc = yaml.load(await fs.readFile(crdPath, 'utf8')) as {
    spec?: { versions?: Array<{ schema?: { openAPIV3Schema?: { properties?: { spec?: { properties?: { widgetData?: { properties?: Record<string, unknown> } } } } } } }> }
  }
  const wd = doc.spec?.versions?.[0]?.schema?.openAPIV3Schema?.properties?.spec?.properties?.widgetData
  // Only containers. Most declare children through `items`, but not all: `Table` resolves them
  // through `columns`/`dataSource` cells (`kind: widget` + a `resourceRefId`) and has no `items`
  // at all — so an `items`-only test silently skips it, which is how it kept its enum on the
  // first pass. Already having the field is therefore also proof of containerhood.
  const isContainer = !!wd?.properties && ('items' in wd.properties || 'allowedResources' in wd.properties)
  if (!isContainer || !wd?.properties) { return false }
  const before = JSON.stringify(wd.properties.allowedResources ?? null)
  wd.properties.allowedResources = {
    description: 'the resource plurals this container may hold as children. Typed loosely on purpose — the per-widget enums drifted and enforced nothing; containment is checked by the chart lint (design rule X5) against the real widget registry.',
    items: { type: 'string' },
    type: 'array',
  }
  if (JSON.stringify(wd.properties.allowedResources) === before) { return false }
  await fs.writeFile(crdPath, yaml.dump(doc, { lineWidth: -1, noRefs: true }))
  return true
}

async function runKrateoctl(schemaPath: string) {
  const schemaName = basename(schemaPath)
  const widgetDir = dirname(schemaPath)
  const base = schemaName.replace(/\.schema\.json$/i, '')

  console.log(`⚙️  Generating CRD for ${chalk.cyan(schemaName)}...`)

  try {
    // Esegue il comando krateoctl
    await asyncExec(`krateoctl gen-widget "${schemaPath}"`, { cwd: widgetDir })

    // Il file generato è sempre <path>.crd.yaml (nella stessa cartella)
    const generatedPath = join(widgetDir, `${base}.schema.crd.yaml`)

    // Nome finale desiderato nella cartella di output
    const finalName = `${base}.crd.yaml`
    const destinationPath = join(OUTPUT_DIR, finalName)

    // Verifica che il file sia stato generato
    await fs.access(generatedPath)

    // Sposta e rinomina nella cartella di output
    await moveFile(generatedPath, destinationPath)

    // krateoctl can't emit JSON-Schema unions or typed maps as structural CRDs — fix them up.
    const normalized = await normalizeUnionTypes(schemaPath, destinationPath)
    const mapsFixed = await normalizeTypedMaps(schemaPath, destinationPath)
    // A6 §1.1: every widget CRD carries the author-declared identity-variance field.
    await injectIdentityContext(destinationPath)
    // F6 (snowplow#130): every widget CRD carries the author-declared extras-variance field.
    await injectKeyExtras(destinationPath)
    // Opt-in staleness badge: every widget CRD carries the `freshness` opt-in flag.
    await injectFreshness(destinationPath)
    // X5: every CONTAINER carries `allowedResources`, typed string[] with no enum.
    const containment = await normalizeAllowedResources(destinationPath)

    console.log(`✅ ${chalk.green(finalName)} moved to ${chalk.gray(OUTPUT_DIR)}${normalized ? chalk.yellow(' (union → x-kubernetes-int-or-string)') : ''}${mapsFixed ? chalk.yellow(' (typed maps → additionalProperties)') : ''}${containment ? chalk.yellow(' (allowedResources → common contract)') : ''}`)
    return true
  } catch (err) {
    console.error(`❌ Failed to generate CRD for ${chalk.red(schemaName)}:`)
    console.error(err instanceof Error ? err.message : String(err))
    return false
  }
}

async function main() {
  console.log(chalk.blue('🚀 Starting Krateo widget CRD generation...\n'))

  await ensureOutputDir()

  const schemaFiles = await glob('**/*.schema.json', {
    absolute: true,
    cwd: WIDGETS_DIR,
  })

  if (schemaFiles.length === 0) {
    console.error('❌ No .schema.json files found in', WIDGETS_DIR)
    process.exit(1)
  }

  console.log(`Found ${schemaFiles.length} schema files to process\n`)

  let successCount = 0
  let failureCount = 0

  for (const schemaFile of schemaFiles) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await runKrateoctl(schemaFile)
    if (ok) {
      successCount += 1
    } else {
      failureCount += 1
    }
  }

  console.log('\n📊 Summary:')
  console.log(`Total schemas: ${schemaFiles.length}`)
  console.log(`✅ Successful: ${successCount}`)
  console.log(`❌ Failed: ${failureCount}`)

  if (failureCount > 0) { process.exit(1) }
  console.log('\n🎉 All CRDs generated successfully!')
}

void main()
