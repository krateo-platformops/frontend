/**
 * EVERY WIDGET EXAMPLE IS A CR THE APISERVER ACCEPTS.
 *
 * src/examples/widgets is what a CR author copies, what `npm run apply-examples` sends to a cluster,
 * and what the visual-regression suite (ui/visual) renders. Nothing checked it, and it drifted as
 * widgets moved to antd's prop names: when this test was written **46 of 166 documents** failed
 * their widget's schema. Every Table example used `data` (the widget reads `dataSource`, so they
 * rendered empty), Card used `actions`, Col `size`, ButtonGroup `gap`, Filters described its fields
 * inline instead of referencing form controls, List still used the retired DataGrid shape, and
 * `allowedResources` named resources that no longer exist (`columns`, `panels`, `tablists`).
 *
 * VALIDATED AGAINST THE CRD, NOT THE WIDGET SCHEMA. The widget schema (`<Kind>.schema.json`) also
 * describes what the frontend RECEIVES — a resolved `resourcesRefs` entry carries `allowed` and
 * `path`, set server-side. The generated CRD (helm/frontend-crds) is what a CR is checked against,
 * and it has neither: six example files copied the resolved shape and were rejected by a server-side
 * dry run while passing the widget schema. So this reads the CRD, and closes every object the way
 * the apiserver does (an unknown field is an error unless the schema preserves unknown fields).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { load, loadAll } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const UI = join(__dirname, '..', '..')
const CRDS = join(UI, '..', 'helm', 'frontend-crds', 'templates')
const EXAMPLES = join(UI, 'src', 'examples', 'widgets')

type JsonSchema = { [key: string]: unknown; properties?: Record<string, JsonSchema>; items?: JsonSchema }
type Crd = { spec: { names: { kind: string }; versions: Array<{ name: string; schema: { openAPIV3Schema: JsonSchema } }> } }
type Example = { apiVersion?: string; kind: string; metadata?: { name?: string }; spec?: unknown }

/** Kubernetes structural-schema semantics: an object that lists its properties rejects any other. */
const closed = (schema: JsonSchema): JsonSchema => {
  const out: JsonSchema = { ...schema }
  if (out.properties) {
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([key, value]) => [key, closed(value)]))
    if (out.additionalProperties === undefined && !out['x-kubernetes-preserve-unknown-fields']) { out.additionalProperties = false }
  }
  if (out.items) { out.items = closed(out.items) }
  if (out.additionalProperties && typeof out.additionalProperties === 'object') { out.additionalProperties = closed(out.additionalProperties as JsonSchema) }
  return out
}

/** What reaches the apiserver: kubectl sends YAML `key:` (null) and an apply drops the field. */
const withoutNulls = (value: unknown): unknown => {
  if (Array.isArray(value)) { return value.map(withoutNulls) }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null).map(([key, entry]) => [key, withoutNulls(entry)]))
  }
  return value
}

/** `${kind}/${version}` → the CRD's `spec` schema. */
const specSchemas = new Map(readdirSync(CRDS)
  .filter((file) => file.endsWith('.crd.yaml'))
  .map((file) => load(readFileSync(join(CRDS, file), 'utf8')) as Crd)
  .flatMap((crd) => crd.spec.versions.map((version) => [
    `${crd.spec.names.kind}/${version.name}`,
    closed(version.schema.openAPIV3Schema.properties?.spec ?? {}),
  ] as const)))

const documents = readdirSync(EXAMPLES).flatMap((folder) => readdirSync(join(EXAMPLES, folder))
  .filter((file) => file.endsWith('.yaml'))
  .flatMap((file) => (loadAll(readFileSync(join(EXAMPLES, folder, file), 'utf8')) as Array<Example | null>)
    .filter((doc): doc is Example => !!doc)
    .map((doc, index) => ({ doc, where: `${folder}/${file}#${index} (${doc.kind} ${doc.metadata?.name ?? ''})` }))))

describe('widget examples', () => {
  it('has examples and CRDs to check — neither walk silently matched nothing', () => {
    expect(documents.length).toBeGreaterThan(100)
    expect(specSchemas.size).toBeGreaterThan(30)
  })

  it('every document is valid against its own kind’s CRD, as the apiserver would judge it', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    addFormats(ajv)
    const problems = documents.flatMap(({ doc, where }) => {
      const version = doc.apiVersion?.split('/')[1] ?? ''
      const schema = specSchemas.get(`${doc.kind}/${version}`)
      if (!schema) { return [`${where}: no CRD for ${doc.kind} ${doc.apiVersion}`] }
      return ajv.validate(schema, withoutNulls(doc.spec ?? {})) ? [] : [`${where}: ${ajv.errorsText(ajv.errors, { dataVar: 'spec' })}`]
    })
    expect(problems).toEqual([])
  })
})
