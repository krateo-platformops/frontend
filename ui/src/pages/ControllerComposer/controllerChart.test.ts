/**
 * controllerChart — a controller draft as files: start, read back, place a group, settle a conflict,
 * the lint, and the registration. Petstore is the document (__fixtures__/petstore-v3.openapi.json).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { lintValuesSchemaDefaults } from '../../components/Autopilot/blueprintDraft'

import {
  controllerCompositionDefinition,
  escapeHelm,
  kindForGroup,
  lintControllerDraft,
  oasConfigMapPath,
  planCompareScope,
  planPlaceGroup,
  planRemoveKind,
  planSetVerb,
  planToggleConfigurationField,
  planToggleField,
  pluralOf,
  readController,
  restDefinitionPath,
  SPEC_BUDGET_BYTES,
  startController,
  unescapeHelm,
  validateStartController,
  type ControllerPlan,
  type StartControllerInput,
} from './controllerChart'

const PETSTORE = readFileSync(join(__dirname, '__fixtures__', 'petstore-v3.openapi.json'), 'utf8')

const input = (over: Partial<StartControllerInput> = {}): StartControllerInput => ({
  apiGroup: 'petstore.example.io',
  baseUrl: 'https://petstore3.swagger.io/api/v3',
  name: 'petstore',
  paths: null,
  spec: PETSTORE,
  ...over,
})

const started = (): Record<string, string> => {
  const result = startController(input())
  if (!result.ok) { throw new Error(JSON.stringify(result.problems)) }
  return result.files
}

const apply = (files: Record<string, string>, plan: ControllerPlan): Record<string, string> => {
  if (!plan.ok) { throw new Error(plan.reason) }
  for (const [path, bytes] of Object.entries(plan.expect ?? {})) { expect(files[path]).toBe(bytes) }
  const removed = new Set(plan.remove ?? [])
  return Object.fromEntries(Object.entries({ ...files, ...(plan.add ?? {}), ...(plan.edit ?? {}) }).filter(([path]) => !removed.has(path)))
}

describe('start', () => {
  it('holds Chart.yaml, values, a closed schema with no defaults, and the document in its ConfigMap', () => {
    const files = started()
    expect(Object.keys(files).sort()).toEqual(['Chart.yaml', 'templates/configmap-oas-petstore.yaml', 'values.schema.json', 'values.yaml'])
    expect(load(files['Chart.yaml'])).toMatchObject({
      annotations: { 'controller.builders.krateo.io/api-group': 'petstore.example.io', 'controller.builders.krateo.io/base-url': 'https://petstore3.swagger.io/api/v3' },
      name: 'petstore',
      version: '0.1.0',
    })
    expect(lintValuesSchemaDefaults(files['values.schema.json'])).toEqual([])
    expect(files['values.schema.json']).not.toMatch(/"default"/)
    const model = readController(files)
    expect(model.spec?.key).toBe('openapi.json')
    expect(model.spec?.oas.doc.servers).toEqual([{ url: 'https://petstore3.swagger.io/api/v3' }])
    expect(model.spec?.oas.summary.paths).toBe(13)
    expect(model.kinds).toEqual([])
    expect(lintControllerDraft(files)).toEqual([])
  })

  it('refuses each field in words', () => {
    const problems = validateStartController(input({ apiGroup: 'petstore', baseUrl: 'ftp://x', name: 'Pet Store', spec: '{"swagger": "2.0"}' }))
    expect(problems.map((problem) => problem.field).sort()).toEqual(['apiGroup', 'baseUrl', 'name', 'spec'])
    expect(problems.find((problem) => problem.field === 'spec')?.message).toMatch(/Swagger 2\.0/)
    expect(validateStartController(input({ spec: 'openapi: 3.0.0\npaths: {\n' }))[0].message).toMatch(/line/)
  })

  it('over the budget, asks for paths — and trims to them', () => {
    const huge = JSON.parse(PETSTORE) as Record<string, unknown>
    huge.info = { ...(huge.info as object), description: 'x'.repeat(SPEC_BUDGET_BYTES) }
    const text = JSON.stringify(huge)
    expect(validateStartController(input({ spec: text })).map((problem) => problem.field)).toEqual(['paths'])
    // The trim keeps top-level fields; with the huge description it is still over — said, not held.
    expect(validateStartController(input({ paths: ['/pet'], spec: text }))[0].message).toMatch(/still/)
    const trimmed = startController(input({ paths: ['/pet', '/pet/{petId}'] }))
    expect(trimmed.ok).toBe(true)
    if (trimmed.ok) { expect(Object.keys(readController(trimmed.files).spec?.oas.doc.paths as object)).toEqual(['/pet', '/pet/{petId}']) }
  })

  it('escapes a literal {{ so Helm renders the document byte for byte', () => {
    expect(unescapeHelm(escapeHelm('a {{ b }} {{c'))).toBe('a {{ b }} {{c')
    expect(escapeHelm('{{ x }}')).toBe('{{`{{`}} x }}')
  })
})

describe('placing and mapping', () => {
  it('names Kinds and plurals the way APIs name things', () => {
    expect(['pet', 'store', 'user', 'store-orders', '{tenant}', 'policies'].map(kindForGroup)).toEqual(['Pet', 'Store', 'User', 'StoreOrder', 'Tenant', 'Policy'])
    expect(['Pet', 'Policy', 'Address'].map(pluralOf)).toEqual(['pets', 'policies', 'addresses'])
  })

  it('places pet: the verbs inferred, the findby CONFLICT left out and named, identifiers from the GET response', () => {
    const files = apply(started(), planPlaceGroup(started(), 'pet'))
    const [pet] = readController(files).kinds
    expect(pet.kind).toBe('Pet')
    expect(pet.path).toBe(restDefinitionPath('Pet'))
    const { resource } = (pet.restDefinition.spec as { resource: Record<string, unknown> })
    expect((resource.verbsDescription as { action: string }[]).map((verb) => verb.action)).toEqual(['create', 'get', 'update', 'delete'])
    expect(resource.identifiers).toEqual(['id'])
    expect(pet.conflicts.map((conflict) => conflict.action)).toEqual(['findby'])
    expect(lintControllerDraft(files)).toEqual(['Pet: 2 operations look like findby (GET /pet/findByStatus, GET /pet/findByTags) — choose one in the inspector, or leave findby out.'])
    expect(planPlaceGroup(files, 'pet')).toEqual({ ok: false, reason: 'pet is already placed as Pet.' })
  })

  it('a chosen findby settles the conflict and validates; an omitted one is remembered as omitted', () => {
    let files = apply(started(), planPlaceGroup(started(), 'pet'))
    const path = restDefinitionPath('Pet')
    const chosen = apply(files, planSetVerb(files, path, 'findby', { method: 'GET', path: '/pet/findByStatus' }))
    expect(readController(chosen).kinds[0].conflicts).toEqual([])
    expect(lintControllerDraft(chosen)).toEqual([])
    files = apply(files, planSetVerb(files, path, 'findby', null))
    expect(readController(files).kinds[0].omitted).toEqual(['findby'])
    expect(lintControllerDraft(files)).toEqual([])
  })

  it('identifiers, status fields, compare scope and configuration fields are edits of the held object', () => {
    let files = apply(started(), planPlaceGroup(started(), 'pet'))
    const path = restDefinitionPath('Pet')
    files = apply(files, planToggleField(files, path, 'additionalStatusFields', 'status'))
    files = apply(files, planCompareScope(files, path, 'fullSpec'))
    files = apply(files, planToggleConfigurationField(files, path, { actions: ['delete'], in: 'header', name: 'api_key' }))
    const { resource } = (readController(files).kinds[0].restDefinition.spec as { resource: Record<string, unknown> })
    expect(resource.additionalStatusFields).toEqual(['status'])
    expect(resource.compareScope).toBe('fullSpec')
    expect(resource.configurationFields).toEqual([{ fromOpenAPI: { in: 'header', name: 'api_key' }, fromRestDefinition: { actions: ['delete'] } }])
    files = apply(files, planToggleConfigurationField(files, path, { actions: ['delete'], in: 'header', name: 'api_key' }))
    expect((readController(files).kinds[0].restDefinition.spec as { resource: Record<string, unknown> }).resource.configurationFields).toBeUndefined()
    files = apply(files, planRemoveKind(files, path))
    expect(readController(files).kinds).toEqual([])
  })

  it('a hand edit in the file survives an inspector edit', () => {
    let files = apply(started(), planPlaceGroup(started(), 'pet'))
    const path = restDefinitionPath('Pet')
    files = { ...files, [path]: files[path].replace('kind: Pet\n', 'kind: Pet\n    excludedSpecFields:\n      - photoUrls\n') }
    files = apply(files, planToggleField(files, path, 'additionalStatusFields', 'status'))
    expect((readController(files).kinds[0].restDefinition.spec as { resource: Record<string, unknown> }).resource.excludedSpecFields).toEqual(['photoUrls'])
  })

  it('a ConfigMap template is not read as a Kind, and the document path is where the RestDefinitions point', () => {
    const files = apply(started(), planPlaceGroup(started(), 'store'))
    const [store] = readController(files).kinds
    expect((store.restDefinition.spec as { oasPath: string }).oasPath).toBe('configmap://{{ .Release.Namespace }}/petstore-oas/openapi.json')
    expect(files[oasConfigMapPath('petstore')]).toContain("namespace: '{{ .Release.Namespace }}'")
  })
})

describe('registration', () => {
  it('names the chart at the confirmed owner, and the Kinds it serves', () => {
    const files = apply(started(), planPlaceGroup(started(), 'store'))
    const text = controllerCompositionDefinition('petstore', 'Krateo-Platformops', 'petstore', '0.1.0', files)
    expect(text).toContain('url: oci://ghcr.io/krateo-platformops/charts/petstore')
    expect(text).toContain('generates Store in petstore.example.io')
    expect(load(text as string)).toMatchObject({ kind: 'CompositionDefinition', metadata: { name: 'petstore' }, spec: { chart: { version: '0.1.0' } } })
    expect(controllerCompositionDefinition('petstore', '', 'petstore', '0.1.0', files)).toBeNull()
  })
})
