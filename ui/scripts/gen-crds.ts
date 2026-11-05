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
const OUTPUT_DIR = join(process.cwd(), 'scripts', 'generated-crds')

/**
 * The CRD generator, which lives in THIS repo (`crdgen/`) rather than in krateoctl.
 *
 * It used to be `krateoctl gen-widget`, a binary CI installed by piping a release script to bash
 * at a version three workflows had to keep in agreement. That put the definition of this repo's
 * own CRDs in another repository on another release cadence. The schemas are here and the CRDs
 * ship from here, so the generator is here too — and `go build` replaces the `curl | bash`.
 *
 * It still calls krateo-platformops/plumbing/crdgen, so the output is unchanged: generation is
 * validated through the apiserver's own structural check before anything is written. See
 * crdgen/doc.go for why that property rules out a second implementation.
 */
const GENERATOR_DIR = join(process.cwd(), '..', 'crdgen')
const GENERATOR_BIN = join(GENERATOR_DIR, 'bin', 'gencrd')

/**
 * Build the generator once per run.
 *
 * `go build` is incremental, so this is a no-op after the first call in a warm checkout and a few
 * seconds in CI. Building rather than expecting a prebuilt binary keeps there being exactly one
 * way to get the generator, which is the whole point of moving it in-repo: nothing to install,
 * nothing to pin, nothing to drift.
 */
async function buildGenerator() {
  console.log(`\u{1F528}  Building the CRD generator (${chalk.cyan('crdgen/')})...`)
  try {
    await asyncExec(`go build -o "${GENERATOR_BIN}" .`, { cwd: GENERATOR_DIR })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `could not build the CRD generator in ${GENERATOR_DIR}.\n`
      + `It needs a Go toolchain at the version crdgen/go.mod declares.\n${detail}`,
    )
  }
}

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

/*
 * `normalizeUnionTypes` USED TO BE HERE. It is gone because plumbing/crdgen now does the job, as of
 * v1.25.0 (krateo-platformops/plumbing#79), and this change bumps the dependency in the same commit
 * so the two can never disagree.
 *
 * What it did: crdgen collapsed a JSON Schema `type: ["integer","string"]` union to its FIRST member
 * — `Flex.gap` became `type: string`, the other four `type: integer` — so this pass re-read the
 * SOURCE schema, found the union paths, and rewrote those nodes to `x-kubernetes-int-or-string`. It
 * had to read the source because the union is gone by the time the CRD exists.
 *
 * Five sites, and the cost of not having it: `Image.width: "100%"` and `Flex.gap: 8` were both
 * refused by the apiserver while the widget schema accepted them.
 *
 * MEASURED IN TWO STEPS so the bump and the deletion could not hide each other:
 *
 *   bump 1.19.0 -> 1.25.0, pass still in place   0 of 44 CRDs change
 *   then delete the pass                          0 of 44 CRDs change
 *
 * The first number is the interesting one: six minors of plumbing move nothing in our output, so the
 * bump carries no surprise of its own. The second is the proof the generator now produces what the
 * pass used to repair.
 *
 * Its sibling `normalizeTypedMaps` went the same way in #619 and for the same reason. What remains
 * in this file are the ENVELOPE injections (identityContext, keyExtras, freshness), the
 * allowedResources container contract, and the vocabulary enum — none of which is a repair of a
 * generator defect, so none of them is waiting on an upstream fix.
 */

/*
 * `normalizeTypedMaps` USED TO BE HERE, and it is gone because it had become a no-op.
 *
 * It existed because krateoctl rendered a typed scalar map (`additionalProperties: {type: string}`
 * in the source) as a lossy `x-kubernetes-preserve-unknown-fields: true`, eroding validation; it
 * restored the typed `additionalProperties` at those exact paths. The generator this repo now uses
 * — plumbing/crdgen via `crdgen/` — gets it right, so the pass found nothing to fix.
 *
 * MEASURED, not inferred, and that distinction is the reason this note exists rather than a silent
 * deletion. Diffing the RAW generator output against the shipped chart across all 44 CRDs shows
 * what the post-passes actually do: the envelope injections on 44 each, the int-or-string repair on
 * 5, the allowedResources normalisation on 8 — and nothing at all from this one, on any of the 5
 * scalar-map sites (LineChart/PieChart `colorMap`, Form `submitActionSelector.map`, Listy
 * `itemTemplate.color.map` and `.bar.color.map`). Removing it leaves all 44 CRDs byte-identical.
 *
 * ITS SIBLING `normalizeUnionTypes` IS NOT DEAD and must not be removed by analogy: crdgen still
 * collapses a `type: ["integer","string"]` union to its first member, so without that pass
 * `Image.width: "100%"` and `Flex.gap: 8` are unappliable. plumbing#77 fixes it upstream; that pass
 * goes when the fix is released, and not before.
 *
 * The risk a dead pass carries is not runtime cost — it is that its comment asserts the generator
 * still has a defect it no longer has, which is the belief that cost a day on the allowedResources
 * enum.
 */

/**
 * Inject `spec.identityContext` into every widget CRD (A6 §1.1). snowplow reads
 * `spec.identityContext` — enum-bounded to jwtutil.UserInfo fields (`username`/`groups`;
 * `displayName` is FORECLOSED per D1) — to inject the server-trusted identity into a widget's
 * L1 cache key + resolve input. The apiserver PRUNES fields absent from a structural CRD schema,
 * so the field MUST be declared in the CRD or snowplow's DeclaredIdentity always reads empty and
 * the whole author-declared cache-identity feature is silently dead. Applied here (CRD post-
 * process, mirroring the retired normalize passes) so ALL widget kinds get it from ONE
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
 * NO PER-WIDGET ENUM, AND A DERIVED VOCABULARY ENUM INSTEAD. The hand-maintained per-widget enums
 * were deleted because they had drifted into nonsense: `Flex` listed 28 kinds, `Col` and `Row` 23,
 * `Table` 11, and `Menu` named exactly two — `navmenuitems` and `pages` — BOTH removed in the
 * routing refactor. Dead values in a live enum. Nothing could tell whether `Flex` permitting
 * `images` while `Col` did not was design or drift, and adding one widget kind meant editing six
 * frozen lists by hand.
 *
 * Measured before restoring anything, across four clusters: seeding an enum from those lists would
 * have REJECTED live CRs in four kinds — Flex (alerts, descriptions, results), Menu (flexes, its
 * only live value), Row (descriptions), Tabs (flexes). They were not merely stale, they were wrong
 * against production.
 *
 * SO THE ENUM THIS FILE NOW WRITES IS AT A DIFFERENT LEVEL, and that distinction is the whole
 * design. `allowedResources` is a PER-INSTANCE declaration: of 97 live Flex CRs, each lists
 * between 1 and 11 plurals describing what THAT slot is for. A per-widget-kind enum caps what any
 * instance may say, which cannot express "this slot holds cards and paragraphs" and is a blunter
 * constraint than the thing it would replace. So:
 *
 *   the CRD enum  = the VOCABULARY. Every real widget plural. It refuses a typo (`buton`) and a
 *                   non-widget kind (`deployments`), which is the failure people actually hit, and
 *                   it cannot refuse an object that exists.
 *   the X5 lint   = the POLICY. Every actual child is within that instance's own declaration.
 *
 * Non-overlapping: X5 compares children against the declaration and never checks the declaration's
 * vocabulary, so a declared `panels` passes it today. The enum closes exactly that gap.
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
    description: 'the resource plurals this container may hold as children. The enum is the VOCABULARY — every real widget plural — so a typo or a non-widget kind is refused by the apiserver. WHICH of them a given container actually accepts is this instance\'s own declaration, checked against its real children by the chart lint (design rule X5).',
    items: { type: 'string' },
    type: 'array',
  }
  if (JSON.stringify(wd.properties.allowedResources) === before) { return false }
  await fs.writeFile(crdPath, yaml.dump(doc, { lineWidth: -1, noRefs: true }))
  return true
}

/**
 * The plurals that are LEGACY: present in live `allowedResources` on clusters we can reach, but
 * naming widget kinds the chart no longer ships. They are in the vocabulary so that the enum
 * cannot make an existing object unappliable — the whole point of a vocabulary enum is that it
 * refuses typos, not history.
 *
 * Measured by the installer session across four clusters (krateo-057, krateo-demo,
 * krateo-demo-alpitour, krateo-installer-release). `navmenuitems` and `pages` are the two the
 * routing refactor removed, which this file's own note above already recorded from the other
 * direction; `panels` appears on a Row.
 *
 * They are NOT an invitation: X5 checks real children against an instance's declaration, so a page
 * that newly declares one and then holds such a child is caught in this repo at lint time. This
 * list should shrink as those CRs are rewritten, and a value should only ever leave it once no
 * reachable cluster carries it.
 *
 * FOUR CLUSTERS IS A FLOOR, NOT THE POPULATION — three more contexts were unreachable and customer
 * clusters are outside it entirely. That is the known limit of this list, and it is the reason the
 * enum is the vocabulary rather than a policy: a vocabulary of every real plural plus known
 * history can only reject a value that names nothing, which no working page depends on.
 */
const LEGACY_ALLOWED_RESOURCES = ['navmenuitems', 'pages', 'panels'] as const

/**
 * Write the vocabulary enum into every container's `allowedResources`, AFTER every CRD exists.
 *
 * A second pass rather than part of the per-schema one, because the vocabulary is every widget's
 * plural and no single-schema pass knows them. The plurals are read from the GENERATED CRDs rather
 * than derived from the kind: 9 of the 44 are not `kind.toLowerCase() + 's'` — `Listy` is
 * `listies`, `Flex` is `flexes`, `Checkbox` is `checkboxes`, `Switch` is `switches`, `Progress` is
 * `progresses`, and `Descriptions`/`Filters`/`Steps`/`Tabs` are already plural — so a derivation
 * rule would be wrong for a fifth of them and wrong in a way that REJECTS valid values.
 */
async function injectContainmentVocabulary(expectedKinds: number): Promise<number> {
  const files = await glob('*.crd.yaml', { absolute: true, cwd: OUTPUT_DIR })
  const plurals: string[] = []
  const docs = new Map<string, Record<string, unknown>>()
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const doc = yaml.load(await fs.readFile(file, 'utf8')) as Record<string, unknown>
    const names = ((doc.spec as Record<string, unknown> | undefined)?.names ?? {}) as { plural?: string }
    if (names.plural) { plurals.push(names.plural) }
    docs.set(file, doc)
  }

  // A TRUNCATED VOCABULARY WOULD REJECT LIVE VALUES, so a partial run must not write one. This is
  // the one failure mode of this pass that reaches a cluster: every other way it can go wrong
  // produces a generation error, while a short enum produces a valid CRD that refuses real pages.
  if (plurals.length < expectedKinds) {
    throw new Error(
      `refusing to write the allowedResources vocabulary from ${plurals.length} CRD(s) when `
      + `${expectedKinds} schemas were processed: a truncated vocabulary is a valid CRD that `
      + `refuses values live pages already use`,
    )
  }

  const vocabulary = [...new Set([...plurals, ...LEGACY_ALLOWED_RESOURCES])].sort()
  let touched = 0
  for (const [file, doc] of docs) {
    const wd = (doc as { spec?: { versions?: Array<{ schema?: { openAPIV3Schema?: { properties?: { spec?: { properties?: { widgetData?: { properties?: Record<string, { items?: Record<string, unknown> }> } } } } } } }> } })
      .spec?.versions?.[0]?.schema?.openAPIV3Schema?.properties?.spec?.properties?.widgetData
    const ar = wd?.properties?.allowedResources
    if (!ar?.items) { continue }
    ar.items.enum = vocabulary
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(file, yaml.dump(doc, { lineWidth: -1, noRefs: true }))
    touched += 1
  }
  return touched
}

async function runKrateoctl(schemaPath: string) {
  const schemaName = basename(schemaPath)
  const widgetDir = dirname(schemaPath)
  const base = schemaName.replace(/\.schema\.json$/i, '')

  console.log(`⚙️  Generating CRD for ${chalk.cyan(schemaName)}...`)

  try {
    // Run the generator: crdgen/, built above. (Was `krateoctl gen-widget`, retired in #604.)
    await asyncExec(`"${GENERATOR_BIN}" "${schemaName}"`, { cwd: widgetDir })

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
    // A6 §1.1: every widget CRD carries the author-declared identity-variance field.
    await injectIdentityContext(destinationPath)
    // F6 (snowplow#130): every widget CRD carries the author-declared extras-variance field.
    await injectKeyExtras(destinationPath)
    // Opt-in staleness badge: every widget CRD carries the `freshness` opt-in flag.
    await injectFreshness(destinationPath)
    // X5: every CONTAINER carries `allowedResources`, typed string[] with no enum.
    const containment = await normalizeAllowedResources(destinationPath)

    console.log(`✅ ${chalk.green(finalName)} moved to ${chalk.gray(OUTPUT_DIR)}${containment ? chalk.yellow(' (allowedResources → common contract)') : ''}`)
    return true
  } catch (err) {
    console.error(`❌ Failed to generate CRD for ${chalk.red(schemaName)}:`)
    console.error(err instanceof Error ? err.message : String(err))
    return false
  }
}

async function main() {
  console.log(chalk.blue('🚀 Starting Krateo widget CRD generation...\n'))

  // Before anything else: a generator that will not build must stop the run here, not partway
  // through the schemas with some CRDs regenerated and others stale.
  await buildGenerator()
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

  // AFTER the loop: the vocabulary is every widget's plural, so it is only knowable once every
  // CRD exists. Failing here fails the run — a CRD set whose enum was never written is a CRD set
  // that silently stops refusing typos.
  const vocabTouched = await injectContainmentVocabulary(schemaFiles.length)
  console.log(`\n🔤 allowedResources vocabulary written into ${vocabTouched} container CRD(s)`)

  console.log('\n📊 Summary:')
  console.log(`Total schemas: ${schemaFiles.length}`)
  console.log(`✅ Successful: ${successCount}`)
  console.log(`❌ Failed: ${failureCount}`)

  if (failureCount > 0) { process.exit(1) }
  console.log('\n🎉 All CRDs generated successfully!')
}

void main()
