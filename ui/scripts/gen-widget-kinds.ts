/* eslint-disable no-console */
/**
 * Derive the composer's knowledge of widget kinds FROM THE CRDs, at build time.
 *
 * WHAT THIS REPLACES. Four separate hand-maintained facts, each of which had already drifted:
 *
 *   1. `LAYOUT_KINDS` — a five-entry literal of "things that hold children". The CRDs describe
 *      eleven, so the builder could not create a ButtonGroup, Filters, Form, Menu, PageHeader or
 *      Steps, and treated PageHeader as a LEAF in every draft it seeds.
 *   2. The set of kinds the palette can place — seven, hardcoded in the `page-composable`
 *      RESTAction in a DIFFERENT repository, against forty-four that exist.
 *   3. `newContainerYaml`'s skeleton — one hand-written shape that happens to satisfy Flex, Row,
 *      Col, Card and Tabs. Thirty-seven of the forty-four kinds have REQUIRED widgetData fields
 *      (BarChart wants data/xField/yField; Button wants actions/clickActionId), so one skeleton
 *      cannot serve them and a missing required field is rejected at apply — at publish, long
 *      after the gesture that caused it.
 *   4. Which kinds can be data-bound. All of them can: every widget CRD carries `spec.apiRef`.
 *
 * WHY BUILD TIME AND NOT DISCOVERY. The obvious move is to ask the cluster, and it is wrong here:
 * these CRDs ship FROM THIS REPOSITORY (`helm/frontend-crds`) and are pinned in lockstep with the
 * image that renders them — the installer carries `frontend` and `frontend-crd` at one version. A
 * runtime call would have the frontend ask a remote service to tell it something it compiled from
 * its own source tree, and would need a snowplow endpoint that does not exist: `/api-info/names` is
 * a per-KIND lookup and there is no group enumeration. Reading them here also preserves the
 * property `dropTargets` states — "no discovery, nothing to go stale".
 *
 * WHAT STILL NEEDS THE CLUSTER: which INSTANCES exist. That is data, it is per-user, and it stays a
 * runtime `/call` under the caller's own RBAC.
 *
 * DRIFT IS A CI EVENT. The generated module is committed, and `--check` re-derives and diffs. A
 * required field added to a CRD next quarter fails a pull request instead of a publish.
 */
import fs from 'node:fs/promises'
import { basename, join } from 'node:path'

import { glob } from 'glob'
import yaml from 'js-yaml'

const CRD_GLOB = join(process.cwd(), '..', 'helm', 'frontend-crds', 'templates', '*.crd.yaml')
const OUTPUT = join(process.cwd(), 'src', 'pages', 'PageComposer', 'widgetKinds.generated.ts')

interface Schema {
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  type?: string
  default?: unknown
}

interface CrdDoc {
  spec?: {
    names?: { kind?: string; plural?: string }
    versions?: { schema?: { openAPIV3Schema?: Schema } }[]
  }
}

/**
 * Does this kind hold ORDERED CHILD REFERENCES — the shape `placeChild` actually writes?
 *
 * `allowedResources` alone is not the test, and using it would be actively harmful: Table,
 * Breadcrumb and Descriptions declare the field while holding no child references at all, so they
 * would light up as drop targets, accept a drop, gain a resourcesRefs entry, and render nothing.
 * That is the failure `structureEdit` calls the worst available — the page publishes clean and
 * comes up with a hole in it.
 *
 * The real test is an ordered `widgetData.items[]` whose entries carry `resourceRefId`.
 */
const holdsChildren = (widgetData: Schema | undefined): boolean => {
  const items = widgetData?.properties?.items
  const entry = items?.items
  return !!entry?.properties && 'resourceRefId' in entry.properties
}

const widgetDataOf = (doc: CrdDoc): Schema | undefined => {
  const versions = doc.spec?.versions ?? []
  const root = versions[versions.length - 1]?.schema?.openAPIV3Schema
  return root?.properties?.spec?.properties?.widgetData
}

const build = async (): Promise<string> => {
  const files = (await glob(CRD_GLOB)).sort()
  if (!files.length) {
    throw new Error(`no widget CRDs matched ${CRD_GLOB}`)
  }

  // Read them all first: the loop that follows is pure, and reading inside it is what the
  // no-await-in-loop rule is about.
  const sources = await Promise.all(files.map(async (file) => ({
    doc: yaml.load(await fs.readFile(file, 'utf8')) as CrdDoc,
    file,
  })))

  const entries: string[] = []
  for (const { doc, file } of sources) {
    const kind = doc.spec?.names?.kind ?? basename(file).replace('.crd.yaml', '')
    const plural = doc.spec?.names?.plural
    const widgetData = widgetDataOf(doc)
    if (!plural || !widgetData) {
      // Refused rather than guessed: a plural derived from the kind is wrong for a good number of
      // them, and a kind with no widgetData schema is not something this builder can author.
      console.warn(`skipping ${kind}: no plural or no widgetData schema`)
      continue
    }
    entries.push([
      `  ${kind}: {`,
      `    plural: ${JSON.stringify(plural)},`,
      `    container: ${holdsChildren(widgetData)},`,
      `    required: ${JSON.stringify(widgetData.required ?? [])},`,
      `    schema: ${JSON.stringify(widgetData)},`,
      '  },',
    ].join('\n'))
  }

  return [
    '/* eslint-disable */',
    '// GENERATED by scripts/gen-widget-kinds.ts from helm/frontend-crds/templates/*.crd.yaml.',
    '// Do not edit by hand: `npm run gen-widget-kinds` rewrites it, and CI re-derives and diffs.',
    '//',
    '// See the generator for WHY this is derived at build time rather than discovered at runtime.',
    '',
    'export interface WidgetKind {',
    '  /** The CRD plural — what a parent writes in resourcesRefs and allowedResources. */',
    '  plural: string',
    '  /** Holds ORDERED child references (widgetData.items[].resourceRefId), so a drop may target it. */',
    '  container: boolean',
    '  /** widgetData fields the CRD REQUIRES — what a drop has to ask for before it can create one. */',
    '  required: readonly string[]',
    '  /** The widgetData schema, for the drop form. It is JSON Schema, which SchemaForm renders. */',
    '  schema: Record<string, unknown>',
    '}',
    '',
    'export const WIDGET_KINDS: Record<string, WidgetKind> = {',
    entries.join('\n'),
    '}',
    '',
  ].join('\n')
}

const main = async (): Promise<void> => {
  const next = await build()
  const check = process.argv.includes('--check')
  if (!check) {
    await fs.writeFile(OUTPUT, next, 'utf8')
    console.log(`wrote ${OUTPUT}`)
    return
  }
  const current = await fs.readFile(OUTPUT, 'utf8').catch(() => '')
  if (current !== next) {
    console.error('widgetKinds.generated.ts is out of date with the widget CRDs.')
    console.error('Run `npm run gen-widget-kinds` and commit the result.')
    process.exit(1)
  }
  console.log('widget kinds are in step with the CRDs')
}

void main()
