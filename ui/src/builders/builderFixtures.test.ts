/**
 * The page and blueprint Builder CRs describe what the composers do TODAY.
 *
 * Nothing reads the fixtures yet (T2 wires the engine), so the only thing keeping them true is this
 * file: each must parse, validate against the CRD the chart ships, name only plugins, checks and
 * verbs this frontend has, and agree with the constants the composers still hardcode. A change to
 * either side then fails here instead of the day the engine starts reading the CR.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import Ajv from 'ajv'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { COMPOSE_VERBS } from '../components/Autopilot/actionBridge'
import { BLUEPRINT_DRAFT_MAX_BYTES } from '../components/Autopilot/blueprintDraftStore'
import { DRAFT_RENDER_RESTACTION } from '../components/Autopilot/blueprintRenderSandbox'
import { resolveBuilderTargets } from '../components/Autopilot/builderTargets'
import { CHART_VERBS } from '../components/Autopilot/chartVerbs'
import { REGISTRATION_PATH } from '../components/Autopilot/publishDraft'
import { PROJECTION_BUNDLE_PATH } from '../pages/BlueprintComposer/projectionCompile'
import { SLUG_PATTERN } from '../pages/PageComposer/startDraft'

import { parseBuilder, type Builder } from './builderSpec'
import { builderRefusals } from './pluginRegistry'

const ROOT = join(__dirname, '..', '..', '..')
const CRD_PATH = join(ROOT, 'helm', 'frontend-crds', 'templates', 'builders', 'Builder.yaml')
const FIXTURES = ['portal-builder', 'blueprint-builder']

type Schema = Record<string, unknown>

/**
 * The CRD's schema with every object CLOSED. The apiserver PRUNES an unknown field, which on a
 * fixture means a misspelled key would validate and then do nothing; closing each object makes it a
 * failure here instead.
 */
const closed = (node: unknown): unknown => {
  if (Array.isArray(node)) { return node.map(closed) }
  if (typeof node !== 'object' || node === null) { return node }
  const out: Schema = {}
  for (const [key, value] of Object.entries(node)) { out[key] = closed(value) }
  if (out.type === 'object' && out.properties && out.additionalProperties === undefined) { out.additionalProperties = false }
  return out
}

const crdSchema = (): Schema => {
  const crd = yaml.load(readFileSync(CRD_PATH, 'utf8')) as { spec: { versions: { schema: { openAPIV3Schema: Schema } }[] } }
  const schema = closed(crd.spec.versions[0].schema.openAPIV3Schema) as Schema
  // metadata is the apiserver's, not the CRD's: open it again.
  ;(schema.properties as Record<string, Schema>).metadata = { type: 'object' }
  return schema
}

const load = (name: string): unknown => yaml.load(readFileSync(join(__dirname, 'fixtures', `${name}.builder.yaml`), 'utf8'))

const parsed = (name: string): Builder => {
  const result = parseBuilder(load(name))
  if (!result.ok) { throw new Error(`${name}: ${result.problems.join('; ')}`) }
  return result.builder
}

describe('the Builder CRD', () => {
  it('is one well-formed CustomResourceDefinition in its own group', () => {
    const docs = yaml.loadAll(readFileSync(CRD_PATH, 'utf8')) as { kind: string; metadata: { name: string }; spec: { group: string; names: { categories: string[] } } }[]
    expect(docs).toHaveLength(1)
    expect(docs[0].kind).toBe('CustomResourceDefinition')
    expect(docs[0].metadata.name).toBe('builders.builders.templates.krateo.io')
    // Not a widget: snowplow would resolve it as one, and the widgets palette would offer it.
    expect(docs[0].spec.group).not.toBe('widgets.templates.krateo.io')
    expect(docs[0].spec.names.categories).not.toContain('widgets')
  })

  it('carries nothing Helm would try to template', () => {
    expect(readFileSync(CRD_PATH, 'utf8')).not.toMatch(/\{\{/)
  })
})

describe.each(FIXTURES)('the %s Builder', (name) => {
  it('parses', () => {
    expect(parseBuilder(load(name))).toMatchObject({ ok: true })
  })

  it('validates against the CRD, every object closed', () => {
    const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(crdSchema())
    const ok = validate(load(name))
    expect(validate.errors ?? [], JSON.stringify(validate.errors)).toEqual([])
    expect(ok).toBe(true)
  })

  it('names only plugins and checks this frontend ships', () => {
    expect(builderRefusals(parsed(name).spec)).toEqual([])
  })

  it('allows only verbs the action bridge knows', () => {
    const known = new Set([...COMPOSE_VERBS, ...CHART_VERBS, 'previewPage', 'previewBlueprint', 'publishPage', 'publishBlueprint'])
    expect(parsed(name).spec.verbs.allowed.filter((verb) => !known.has(verb))).toEqual([])
  })

  it('agrees with the byte cap, the registration path and the install-config keys the code uses', () => {
    const { spec } = parsed(name)
    expect(spec.start.maxDraftBytes).toBe(BLUEPRINT_DRAFT_MAX_BYTES)
    expect(spec.files.heldBytes).toBe(BLUEPRINT_DRAFT_MAX_BYTES)
    expect(spec.publish.registration.path).toBe(REGISTRATION_PATH)
    expect(spec.files.locked).toContain(REGISTRATION_PATH)
    // resolveBuilderTargets reads exactly these config.api keys; a key it does not read is a typo.
    const read: string[] = []
    resolveBuilderTargets(new Proxy({}, {
      get: (_target, key) => {
        read.push(String(key))
        return undefined
      },
    }))
    expect(read).toContain(spec.publish.targetKey)
    expect(read).toContain(spec.publish.templateKey)
  })

  it('is served at a route the shell registers', () => {
    const routes = readFileSync(join(__dirname, '..', 'context', 'RoutesContext.tsx'), 'utf8')
    expect(routes).toContain(`path: '${parsed(name).spec.route}'`)
  })
})

describe('what each fixture says about its own builder', () => {
  it('the Portal Builder: page drafts, a sandbox preview, the slug rule startDraft enforces', () => {
    const { spec } = parsed('portal-builder')
    expect(spec.draftKind).toBe('page')
    expect(spec.publish.builder).toBe('page')
    expect(spec.preview).toEqual({ mode: 'sandbox-apply' })
    expect(spec.start.fields.find((field) => field.name === 'slug')?.pattern).toBe(SLUG_PATTERN.source)
  })

  it('the Blueprint Builder: blueprint drafts, a render preview through the draft RESTAction', () => {
    const { spec } = parsed('blueprint-builder')
    expect(spec.draftKind).toBe('blueprint')
    expect(spec.publish.builder).toBe('blueprint')
    expect(spec.preview).toEqual({ mode: 'render', restActionRef: { name: DRAFT_RENDER_RESTACTION } })
    expect(spec.files.locked).toContain(PROJECTION_BUNDLE_PATH)
  })
})
