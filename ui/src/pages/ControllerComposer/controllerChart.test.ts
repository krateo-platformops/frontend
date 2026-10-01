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
  unescapeHelm,
  lockedSnapshot,
  withServers,
  type ControllerPlan,
} from './controllerChart'
import { apiGroupProblem, baseUrlProblem, readSpec, serverRewriteSentence, SPEC_TEXT_MAX_BYTES, startController, validateStartController, type StartControllerInput } from './controllerStart'

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

  it('places pet: the verbs inferred, the findby CONFLICT left out and named, the id read from status', () => {
    const files = apply(started(), planPlaceGroup(started(), 'pet'))
    const [pet] = readController(files).kinds
    expect(pet.kind).toBe('Pet')
    expect(pet.path).toBe(restDefinitionPath('Pet'))
    const { resource } = (pet.restDefinition.spec as { resource: Record<string, unknown> })
    // PUT /pet is on the collection, so it is no update by rule (round 2) — the person maps it.
    expect((resource.verbsDescription as { action: string }[]).map((verb) => verb.action)).toEqual(['create', 'get', 'delete'])
    expect((resource.verbsDescription as { fieldMapping?: unknown }[])[1].fieldMapping).toEqual([{ inCustomResource: 'status.id', inPath: 'petId' }])
    expect(resource.identifiers).toEqual(['id'])
    // status carries id, so spec does not ask the person for it.
    expect(resource.excludedSpecFields).toEqual(['id'])
    expect(pet.conflicts.map((conflict) => conflict.action)).toEqual(['findby', 'update'])
    expect(lintControllerDraft(files)).toEqual([
      'Pet: 2 operations look like findby (GET /pet/findByStatus, GET /pet/findByTags) — choose one in the inspector, or leave findby out.',
      'Pet: PUT /pet may be the update — a PUT on the collection whose body carries the id (id), not on the item, so it needs a confirm — choose one in the inspector, or leave update out.',
    ])
    expect(planPlaceGroup(files, 'pet')).toEqual({ ok: false, reason: 'pet is already placed as Pet.' })
  })

  it('a chosen findby settles the conflict and validates; an omitted one is remembered as omitted', () => {
    let files = apply(started(), planPlaceGroup(started(), 'pet'))
    const path = restDefinitionPath('Pet')
    // The collection PUT offered as update is confirmed, as a person does in the verbs table.
    files = apply(files, planSetVerb(files, path, 'update', { method: 'PUT', path: '/pet' }))
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
    expect(files[path]).toContain('    excludedSpecFields:\n      - id\n')
    files = { ...files, [path]: files[path].replace('    excludedSpecFields:\n      - id\n', '    excludedSpecFields:\n      - id\n      - photoUrls\n') }
    files = apply(files, planToggleField(files, path, 'additionalStatusFields', 'status'))
    expect((readController(files).kinds[0].restDefinition.spec as { resource: Record<string, unknown> }).resource.excludedSpecFields).toEqual(['id', 'photoUrls'])
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

// ── review of #428 ────────────────────────────────────────────────────────────────────────────────

/** Petstore with a path-level and an operation-level server that point elsewhere. */
const withForeignServers = (): string => {
  const doc = JSON.parse(PETSTORE) as { paths: Record<string, Record<string, unknown>> }
  doc.paths['/pet'].servers = [{ url: 'https://attacker.example' }]
  ;(doc.paths['/pet/{petId}'].get as Record<string, unknown>).servers = [{ url: 'https://{tenant}.elsewhere.example', variables: { tenant: { default: 'x' } } }]
  return JSON.stringify(doc)
}

describe('item 3 — the base URL is the only destination', () => {
  it('rewrites EVERY servers list — root, path, operation — and says which', () => {
    const text = withForeignServers()
    const reading = readSpec(text, 'https://petstore3.swagger.io/api/v3')
    expect(serverRewriteSentence(reading.oas!.doc, 'https://petstore3.swagger.io/api/v3'))
      .toBe('The document names its own servers beside the root (paths./pet.servers, paths./pet/{petId}.get.servers); each is rewritten to https://petstore3.swagger.io/api/v3, so every request — and its credential — goes only there.')
    const result = startController(input({ spec: text }))
    if (!result.ok) { throw new Error(JSON.stringify(result.problems)) }
    const { doc } = readController(result.files).spec!.oas
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>
    expect(doc.servers).toEqual([{ url: 'https://petstore3.swagger.io/api/v3' }])
    expect(paths['/pet'].servers).toEqual([{ url: 'https://petstore3.swagger.io/api/v3' }])
    expect(paths['/pet/{petId}'].get.servers).toEqual([{ url: 'https://petstore3.swagger.io/api/v3' }])
    expect(JSON.stringify(doc)).not.toContain('attacker')
    expect(lintControllerDraft(result.files)).toEqual([])
  })

  it('the lint names a foreign server a hand edit put back', () => {
    const files = started()
    const path = oasConfigMapPath('petstore')
    const edited = { ...files, [path]: files[path].replace('"servers": [\n', '"servers": [\n      { "url": "https://attacker.example" },\n') }
    expect(lintControllerDraft(edited).join('\n')).toMatch(/servers names https:\/\/attacker\.example, not the base URL/)
  })

  it('refuses a base URL with a variable, or braces anywhere', () => {
    expect(baseUrlProblem('https://{host}/api')).toMatch(/variable/)
    expect(baseUrlProblem('https://api.example/{v}')).toMatch(/variable/)
    expect(baseUrlProblem('https://api.example/v3')).toBeNull()
    expect(withServers({ paths: {} }, '')).toEqual({ paths: {} })
  })
})

describe('item 5 — huge and bomb specs', () => {
  it('does not parse text over 8 MiB', () => {
    const reading = readSpec(`${'#'.repeat(SPEC_TEXT_MAX_BYTES)}\nopenapi: 3.0.0\n`)
    expect(reading.oas).toBeNull()
    expect(reading.error).toMatch(/over the 8 MiB this builder reads/)
  })

  it('refuses YAML anchors and aliases (the billion-laughs shape) before writing anything out', () => {
    const bomb = ['openapi: 3.0.0', 'info: { title: b, version: "1" }', 'x-a: &a [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]', 'x-b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]', 'x-c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]', 'x-d: [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]', 'paths: {}'].join('\n')
    const reading = readSpec(bomb)
    expect(reading.oas).toBeNull()
    expect(reading.error).toMatch(/YAML anchors and aliases/)
  })

  it('a caller that has the reading passes it in, and nothing is parsed again', () => {
    const reading = readSpec(PETSTORE, 'https://petstore3.swagger.io/api/v3')
    const forged = { ...reading, error: 'from the reading' }
    expect(validateStartController(input(), forged).find((problem) => problem.field === 'spec')?.message).toBe('from the reading')
  })
})

describe('item 6 — locked once published', () => {
  const placed = () => {
    let files = apply(started(), planPlaceGroup(started(), 'pet'))
    files = apply(files, planSetVerb(files, restDefinitionPath('Pet'), 'findby', { method: 'GET', path: '/pet/findByStatus' }))
    return files
  }

  it('a published Kind refuses a change to a locked field, with the screen-11 sentence; a free field still changes', () => {
    const files = placed()
    const locked = lockedSnapshot(files)
    const path = restDefinitionPath('Pet')
    expect(locked[path]).toMatchObject({ identifiers: ['id'], kind: 'Pet', resourceGroup: 'petstore.example.io' })
    const identifier = planToggleField(files, path, 'identifiers', 'name', locked)
    expect(identifier).toEqual({ ok: false, reason: 'cannot update Pet in place: identifiers is locked once published (["id"] → ["id","name"]). Changing it means deleting the RestDefinition — and every Pet it serves — and recreating it; undo the change, or place a new Kind instead.' })
    const reasonOf = (plan: ControllerPlan): string => (plan.ok ? '' : plan.reason)
    expect(reasonOf(planToggleField(files, path, 'additionalStatusFields', 'status', locked))).toMatch(/^cannot update Pet in place: additionalStatusFields is locked/)
    expect(reasonOf(planToggleConfigurationField(files, path, { actions: ['delete'], in: 'header', name: 'api_key' }, locked))).toMatch(/configurationFields is locked/)
    expect(planCompareScope(files, path, 'fullSpec', locked).ok).toBe(true)
    // Not published: the same edit lands.
    expect(planToggleField(files, path, 'identifiers', 'name').ok).toBe(true)
  })

  it('the lint refuses a hand edit to a locked field of a published Kind', () => {
    const files = placed()
    const locked = lockedSnapshot(files)
    const path = restDefinitionPath('Pet')
    const edited = { ...files, [path]: files[path].replace('resourceGroup: petstore.example.io', 'resourceGroup: other.example.io') }
    expect(lintControllerDraft(edited, locked)).toContain('cannot update Pet in place: resourceGroup is locked once published ("petstore.example.io" → "other.example.io"). Changing it means deleting the RestDefinition — and every Pet it serves — and recreating it; undo the change, or place a new Kind instead.')
    expect(lintControllerDraft(edited)).not.toContain(expect.stringMatching(/cannot update/))
  })
})

describe('item 7 — reserved API groups', () => {
  it.each([
    ['core.krateo.io', /Krateo system group/],
    ['widgets.templates.krateo.io', /Krateo system group/],
    ['builders.templates.krateo.io', /Krateo system group/],
    ['composition.krateo.io', /Krateo system group/],
    ['ogen.krateo.io', /Krateo system group/],
    ['krateo.io', /Krateo system group/],
    ['apps.k8s.io', /reserved for Kubernetes/],
    ['cluster.x-k8s.io', /reserved for Kubernetes/],
    ['core', /Kubernetes core group/],
    ['', /core \(empty\) group/],
  ])('%s is refused, and the sentence says why', (group, reason) => {
    expect(apiGroupProblem(group)).toMatch(reason)
  })

  it('a group of your own, even under a krateo subdomain nobody reserved, is taken', () => {
    expect(apiGroupProblem('petstore.example.io')).toBeNull()
    expect(apiGroupProblem('github.acme.io')).toBeNull()
  })
})
