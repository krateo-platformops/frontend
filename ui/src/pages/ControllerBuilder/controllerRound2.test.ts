/**
 * Controller Builder round 2 (frontend#405) — the chart half, end to end over files:
 *   1. the served API version is pinned (info.version v1alpha1) on every write, kept in Chart.yaml,
 *      refused by the lint otherwise, and locked once published;
 *   3–5. ids come from status, nested leaves included, with a confirm step when ambiguous, and spec
 *      does not ask for what status carries (excludedSpecFields, editable);
 *   2. a findby envelope with two arrays waits for itemsPath; 8. configuration fields beyond auth.
 * Fixtures: petstore, and two constructed Aruba-like documents (__fixtures__/aruba-like-*.oas.yaml).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { createBlueprintDraftStore } from '../../components/Autopilot/blueprintDraftStore'

import {
  askedOnCreateNotes,
  configurationCandidates,
  exclusionCandidates,
  lintControllerDraft,
  lockedSnapshot,
  oasConfigMapPath,
  pathParamsOutsideSpec,
  planBindPathParam,
  planPlaceGroup,
  planSetItemsPath,
  planSetVerb,
  planToggleField,
  readController,
  restDefinitionPath,
  statusBoundPathParams,
  type ControllerPlan,
} from './controllerChart'
import { servedAsSentence, startController, type StartControllerInput } from './controllerStart'
import { pinServedVersion, SERVED_VERSION_COMMENT, SOURCE_SPEC_VERSION_ANNOTATION } from './servedVersion'

const fixture = (file: string): string => readFileSync(join(__dirname, '__fixtures__', file), 'utf8')

const start = (spec: string, over: Partial<StartControllerInput> = {}): Record<string, string> => {
  const result = startController({ apiGroup: 'example.io', baseUrl: 'https://api.example.test', name: 'demo', paths: null, spec, ...over })
  if (!result.ok) { throw new Error(JSON.stringify(result.problems)) }
  return result.files
}

const apply = (files: Record<string, string>, plan: ControllerPlan): Record<string, string> => {
  if (!plan.ok) { throw new Error(plan.reason) }
  for (const [path, bytes] of Object.entries(plan.expect ?? {})) { expect(files[path]).toBe(bytes) }
  const removed = new Set(plan.remove ?? [])
  return Object.fromEntries(Object.entries({ ...files, ...(plan.add ?? {}), ...(plan.edit ?? {}) }).filter(([path]) => !removed.has(path)))
}

const resourceOf = (files: Record<string, string>, path: string): Record<string, unknown> =>
  ((load(files[path]) as { spec: { resource: Record<string, unknown> } }).spec.resource)

const verbOf = (files: Record<string, string>, path: string, action: string): Record<string, unknown> =>
  (resourceOf(files, path).verbsDescription as Record<string, unknown>[]).find((verb) => verb.action === action) ?? {}

describe('1 — the served API version is pinned to v1alpha1', () => {
  const petstore = fixture('petstore-v3.openapi.json')

  it('a start holds the document as v1alpha1, keeps 1.0.27 on Chart.yaml, and says why in the ConfigMap', () => {
    const files = start(petstore)
    const model = readController(files)
    expect(model.servedVersion).toBe('v1alpha1')
    expect(model.sourceVersion).toBe('1.0.27')
    expect((load(files['Chart.yaml']) as { annotations: Record<string, string> }).annotations[SOURCE_SPEC_VERSION_ANNOTATION]).toBe('1.0.27')
    expect(files[oasConfigMapPath('demo')].startsWith(SERVED_VERSION_COMMENT)).toBe(true)
    expect(lintControllerDraft(files)).toEqual([])
    expect(servedAsSentence('example.io', JSON.parse(petstore) as Record<string, unknown>))
      .toBe(`example.io/v1alpha1 — pinned: the document says 1.0.27, and a vendor bump must not move the served version (kept as ${SOURCE_SPEC_VERSION_ANNOTATION})`)
  })

  it('a hand edit that bumps info.version is re-pinned by the ONE function, and the new vendor version recorded', () => {
    const files = start(petstore)
    const path = oasConfigMapPath('demo')
    const bumped = { ...files, [path]: files[path].replace('"version": "v1alpha1"', '"version": "1.0.28"') }
    expect(bumped[path]).toContain('"version": "1.0.28"')
    // Read without the store, the lint refuses it…
    expect(lintControllerDraft(bumped).join('\n')).toMatch(/info\.version is "1\.0\.28", not v1alpha1/)
    // …and the function every store write goes through puts it back.
    const pinned = pinServedVersion(bumped)
    expect(readController(pinned).servedVersion).toBe('v1alpha1')
    expect(readController(pinned).sourceVersion).toBe('1.0.28')
    expect(lintControllerDraft(pinned)).toEqual([])
    // A tree that needs nothing is the same object, byte for byte.
    expect(pinServedVersion(pinned)).toBe(pinned)
  })

  it('the draft store pins on EVERY write of a controller: start (set), a Files edit (updateFile), a batch (applyFiles)', () => {
    const store = createBlueprintDraftStore()
    const path = oasConfigMapPath('demo')
    const raw = start(petstore)
    const unpinned = { ...raw, [path]: raw[path].replace('"version": "v1alpha1"', '"version": "2.0.0"') }
    expect(store.set(unpinned, 'controller').ok).toBe(true)
    expect(readController(store.get()?.files ?? {}).servedVersion).toBe('v1alpha1')
    const held = store.get()?.files ?? {}
    store.updateFile(path, held[path].replace('"version": "v1alpha1"', '"version": "3.0.0"'))
    expect(readController(store.get()?.files ?? {}).servedVersion).toBe('v1alpha1')
    expect(readController(store.get()?.files ?? {}).sourceVersion).toBe('3.0.0')
    const again = store.get()?.files ?? {}
    store.applyFiles({ edit: { [path]: again[path].replace('"version": "v1alpha1"', '"version": "4.0.0"') } })
    expect(readController(store.get()?.files ?? {}).sourceVersion).toBe('4.0.0')
    expect(readController(store.get()?.files ?? {}).servedVersion).toBe('v1alpha1')
  })

  it('a YAML document is pinned as YAML', () => {
    const files = start(fixture('aruba-like-kms.oas.yaml'))
    const model = readController(files)
    expect(model.spec?.key).toBe('openapi.yaml')
    expect(model.servedVersion).toBe('v1alpha1')
    expect(model.sourceVersion).toBe('1.0.4')
  })

  it('published, the served version is LOCKED like the kind and the group', () => {
    const files = start(petstore)
    const locked = lockedSnapshot(files)
    const path = oasConfigMapPath('demo')
    expect(locked[path]).toEqual({ servedVersion: 'v1alpha1' })
    const moved = { ...files, [path]: files[path].replace('"version": "v1alpha1"', '"version": "v1beta1"') }
    expect(lintControllerDraft(moved, locked)).toContain(`cannot update the controller in place: the version its Kinds are served under is locked once published ("v1alpha1" → "v1beta1"). oasgen-provider would serve a new version and prune the published one, breaking every manifest written against it — set ${path}'s info.version back to v1alpha1.`)
  })
})

describe('3–5 — ids from status, nested and confirmed (Aruba-like dbaas)', () => {
  const placed = () => {
    const files = start(fixture('aruba-like-dbaas.oas.yaml'))
    return apply(files, planPlaceGroup(files, 'projects'))
  }
  const path = restDefinitionPath('Project')

  it('places the Kind with every item verb reading the NESTED id from status, and status carrying it', () => {
    const files = placed()
    expect(verbOf(files, path, 'get').fieldMapping).toEqual([{ inCustomResource: 'status.metadata.id', inPath: 'dbaasId' }])
    expect(verbOf(files, path, 'delete').fieldMapping).toEqual([{ inCustomResource: 'status.metadata.id', inPath: 'id' }])
    expect(verbOf(files, path, 'create').fieldMapping).toBeUndefined()
    const resource = resourceOf(files, path)
    expect(resource.identifiers).toEqual(['metadata.id'])
    // {dbaasId} and {id} are read from status on every verb that carries them, but the document declares
    // both on the path item — oasgen never puts them in spec, so there is nothing to exclude.
    expect(resource.excludedSpecFields).toBeUndefined()
  })

  it('{dbaasId} and {id} wait for a confirm — the lint says so — and a confirm settles it', () => {
    const files = placed()
    const [kind] = readController(files).kinds
    expect(kind.unconfirmed.map((binding) => binding.param)).toEqual(['dbaasId', 'id'])
    expect(lintControllerDraft(files)).toEqual([
      'Project: {dbaasId}, {id} name the same path segment in different operations — treated as one identifier; confirm the binding. Confirm {dbaasId} → status.metadata.id in the inspector, or bind it to another field.',
      'Project: {dbaasId}, {id} name the same path segment in different operations — treated as one identifier; confirm the binding. Confirm {id} → status.metadata.id in the inspector, or bind it to another field.',
    ])
    const confirmed = apply(files, planBindPathParam(files, path, 'dbaasId', 'status.metadata.id'))
    expect(readController(confirmed).kinds[0].confirmed).toEqual(['dbaasId', 'id'])
    expect(lintControllerDraft(confirmed)).toEqual([])
  })

  it('a binding never names an object, and never a field status could not carry', () => {
    const files = placed()
    expect(planBindPathParam(files, path, 'dbaasId', 'metadata.id')).toEqual({ ok: false, reason: 'metadata.id is not a field of the resource — bind {dbaasId} to spec.<field> or status.<field>.' })
    expect(planBindPathParam(files, path, 'dbaasId', 'status.nothere')).toEqual({ ok: false, reason: 'nothere is not a field the get response returns, so status would never carry it.' })
    expect(planBindPathParam(files, path, 'nope', 'status.metadata.id')).toEqual({ ok: false, reason: 'No verb of Project has {nope} in its path.' })
  })

  it('excludedSpecFields is editable like the other lists', () => {
    const files = placed()
    const toggled = apply(files, planToggleField(files, path, 'excludedSpecFields', 'properties.flavor'))
    expect(resourceOf(toggled, path).excludedSpecFields).toEqual(['properties.flavor'])
    expect(resourceOf(apply(toggled, planToggleField(toggled, path, 'excludedSpecFields', 'properties.flavor')), path).excludedSpecFields).toBeUndefined()
  })

  it('8 — configuration fields beyond auth: api-version on every verb (*), the findby\'s filter/sort/limit/offset', () => {
    const files = placed()
    const model = readController(files)
    const candidates = configurationCandidates(model, model.kinds[0])
    expect(candidates).toEqual([
      { actions: ['*'], in: 'header', name: 'api-version', nonAuth: true },
      { actions: ['findby'], in: 'query', name: 'filter', nonAuth: true },
      { actions: ['findby'], in: 'query', name: 'sort', nonAuth: true },
      { actions: ['findby'], in: 'query', name: 'limit', nonAuth: true },
      { actions: ['findby'], in: 'query', name: 'offset', nonAuth: true },
    ])
  })
})

describe('2 + 3 — no get, an envelope with two arrays, and keyId vs id (Aruba-like kms)', () => {
  const placed = () => {
    const files = start(fixture('aruba-like-kms.oas.yaml'))
    return apply(files, planPlaceGroup(files, 'kms'))
  }
  const path = restDefinitionPath('Km')

  it('places, and the lint names the envelope and the ambiguous id — then itemsPath and a confirm clear both', () => {
    let files = placed()
    expect(readController(files).kinds[0].kind).toBe('Km')
    expect(lintControllerDraft(files)).toEqual([
      'Km: {keyId} could be keyId or id — keyId is suggested; confirm it or choose another. Confirm {keyId} → status.keyId in the inspector, or bind it to status.id.',
      'Km (templates/restdefinition-km.yaml): findby (GET /kms/{kmsId}/keys): the findby response is an envelope with 2 array properties (data, included), and oasgen refuses to guess which holds the collection — set itemsPath',
    ])
    files = apply(files, planSetItemsPath(files, path, 'data'))
    expect(verbOf(files, path, 'findby').itemsPath).toBe('.data')
    files = apply(files, planBindPathParam(files, path, 'keyId', 'status.id'))
    expect(verbOf(files, path, 'delete').fieldMapping).toEqual([{ inCustomResource: 'status.id', inPath: 'keyId' }])
    // status must carry id now: it joins the status fields; keyId stays the identifier.
    expect(resourceOf(files, path).identifiers).toEqual(['keyId'])
    expect(resourceOf(files, path).additionalStatusFields).toEqual(['id'])
    expect(lintControllerDraft(files)).toEqual([])
    // 9 — no get: the Kind is told where its status comes from.
    expect(readController(files).kinds[0].validation?.warnings).toContain('Km has no get verb: oasgen builds its status from the findby response — one item of its envelope — and every observe walks the findby list (oasgen#146).')
  })

  it('itemsPath can be cleared, and is refused without a findby', () => {
    let files = placed()
    files = apply(files, planSetItemsPath(files, path, '.data'))
    files = apply(files, planSetItemsPath(files, path, null))
    expect(verbOf(files, path, 'findby').itemsPath).toBeUndefined()
    const petstore = start(fixture('petstore-v3.openapi.json'))
    const pet = apply(petstore, planPlaceGroup(petstore, 'pet'))
    expect(planSetItemsPath(pet, restDefinitionPath('Pet'), '.data')).toEqual({ ok: false, reason: 'There is no findby verb to set an itemsPath on — map findby first.' })
  })
})

describe('a path parameter read from status is not asked of spec (oasgen 0.25 excludedSpecFields)', () => {
  const PET = restDefinitionPath('Pet')
  const placedPet = () => {
    const files = start(fixture('petstore-v3.openapi.json'))
    return apply(files, planPlaceGroup(files, 'pet'))
  }

  it('petstore: {petId} ← status.id on get and delete, so spec leaves out both id and petId', () => {
    const files = placedPet()
    expect(resourceOf(files, PET).excludedSpecFields).toEqual(['id', 'petId'])
    const model = readController(files)
    expect(statusBoundPathParams(model.kinds[0].restDefinition)).toEqual(['petId'])
    // A candidate the inspector and controllerSetExcludedFields both offer, so it can be toggled off.
    expect(exclusionCandidates(model.kinds[0], model).slice(0, 2)).toEqual([
      { field: 'id', reason: 'status carries it — the id is read from there' },
      { field: 'petId', reason: 'path parameter read from status — spec need not ask for it' },
    ])
    const toggled = apply(files, planToggleField(files, PET, 'excludedSpecFields', 'petId'))
    expect(resourceOf(toggled, PET).excludedSpecFields).toEqual(['id'])
    expect(lintControllerDraft(files)).toEqual(lintControllerDraft(toggled))
  })

  it('read from status by one verb and from spec by another, it stays in spec', () => {
    const placed = placedPet()
    // As if delete had been bound to spec by hand before anything excluded petId.
    const mixed = {
      ...placed,
      [PET]: placed[PET]
        .replace('    excludedSpecFields:\n      - id\n      - petId\n', '    excludedSpecFields:\n      - id\n')
        .replace(/(- action: delete[\s\S]*?inCustomResource: )status\.id/, '$1spec.id'),
    }
    expect(verbOf(mixed, PET, 'delete').fieldMapping).toEqual([{ inCustomResource: 'spec.id', inPath: 'petId' }])
    expect(verbOf(mixed, PET, 'get').fieldMapping).toEqual([{ inCustomResource: 'status.id', inPath: 'petId' }])
    const model = readController(mixed)
    expect(statusBoundPathParams(model.kinds[0].restDefinition)).toEqual([])
    expect(exclusionCandidates(model.kinds[0], model).map((candidate) => candidate.field)).not.toContain('petId')
    // A settle (re-picking create) adds nothing for it.
    const settled = apply(mixed, planSetVerb(mixed, PET, 'create', { method: 'POST', path: '/pet' }))
    expect(resourceOf(settled, PET).excludedSpecFields).toEqual(['id'])
  })

  it('PUBLISHED before it was excluded: nothing changes, and the Kind says why petId is asked for', () => {
    const placed = placedPet()
    const published = { ...placed, [PET]: placed[PET].replace('    excludedSpecFields:\n      - id\n      - petId\n', '    excludedSpecFields:\n      - id\n') }
    const locked = lockedSnapshot(published)
    const sentence = 'petId is asked for on create because this controller was published before it was excluded; excluding it needs the RestDefinition recreated.'
    expect(askedOnCreateNotes(readController(published).kinds[0], true, readController(published).spec?.oas.doc)).toEqual([sentence])
    // Unpublished, there is no note — the settle excludes it instead.
    expect(askedOnCreateNotes(readController(published).kinds[0], false, readController(published).spec?.oas.doc)).toEqual([])
    for (const plan of [
      planSetVerb(published, PET, 'delete', { method: 'DELETE', path: '/pet/{petId}' }, locked),
      planBindPathParam(published, PET, 'petId', 'status.id', locked),
    ]) {
      const after = apply(published, plan)
      expect(resourceOf(after, PET).excludedSpecFields).toEqual(['id'])
      expect(lintControllerDraft(after, locked)).toEqual(lintControllerDraft(published, locked))
    }
    // The toggle is refused by the lock, like any change to excludedSpecFields.
    expect(planToggleField(published, PET, 'excludedSpecFields', 'petId', locked)).toMatchObject({ ok: false, reason: expect.stringMatching(/^cannot update Pet in place: excludedSpecFields is locked once published/) as unknown })
  })
})

describe('a path parameter spec never carries is not put in excludedSpecFields', () => {
  const WIDGET = restDefinitionPath('Widget')
  // oasgen builds spec from the create body plus each verb's OPERATION-level parameters, so where
  // {widget_id} is declared decides whether spec has a widget_id to exclude.
  const widgets = (where: 'path' | 'operation', bodyCarriesParam = false): string => {
    const param = { in: 'path', name: 'widget_id', required: true, schema: { type: 'string' } }
    const body = {
      properties: { id: { type: 'string' }, title: { type: 'string' }, ...(bodyCarriesParam ? { widget_id: { type: 'string' } } : {}) },
      type: 'object',
    }
    const ok = { content: { 'application/json': { schema: body } }, description: 'ok' }
    const own = where === 'operation' ? { parameters: [param] } : {}
    return JSON.stringify({
      info: { title: 'widgets', version: '1.0.0' },
      openapi: '3.0.3',
      paths: {
        '/widgets': { post: { requestBody: { content: { 'application/json': { schema: body } } }, responses: { 200: ok } } },
        '/widgets/{widget_id}': {
          ...(where === 'path' ? { parameters: [param] } : {}),
          delete: { ...own, responses: { 200: ok } },
          get: { ...own, responses: { 200: ok } },
        },
      },
    })
  }
  const placed = (spec: string): Record<string, string> => {
    const files = start(spec)
    return apply(files, planPlaceGroup(files, 'widgets'))
  }

  it('declared on the path item only and not in the body: not excluded, not offered, and the inspector says why', () => {
    const files = placed(widgets('path'))
    const model = readController(files)
    expect(statusBoundPathParams(model.kinds[0].restDefinition)).toEqual(['widget_id'])
    expect(resourceOf(files, WIDGET).excludedSpecFields).toEqual(['id'])
    expect(exclusionCandidates(model.kinds[0], model).map((candidate) => candidate.field)).not.toContain('widget_id')
    expect(pathParamsOutsideSpec(model.kinds[0], model)).toEqual([
      'widget_id is read from status, and spec never asks for it — the document declares it on the path, not on an operation, so there is nothing to exclude.',
    ])
    // Nor is it "asked for on create" once published — spec never had it.
    expect(askedOnCreateNotes(model.kinds[0], true, model.spec?.oas.doc)).toEqual([])
  })

  it('declared on the operation: excluded as before, and there is nothing to explain', () => {
    const files = placed(widgets('operation'))
    const model = readController(files)
    expect(resourceOf(files, WIDGET).excludedSpecFields).toEqual(['id', 'widget_id'])
    expect(exclusionCandidates(model.kinds[0], model).map((candidate) => candidate.field)).toContain('widget_id')
    expect(pathParamsOutsideSpec(model.kinds[0], model)).toEqual([])
  })

  it('declared on the path item but sent by the create body: bound to status, it is excluded as before', () => {
    const files = placed(widgets('path', true))
    // The body carries widget_id, so placing reads it from spec; bound to status, spec need not ask for it.
    const bound = apply(files, planBindPathParam(files, WIDGET, 'widget_id', 'status.id'))
    const model = readController(bound)
    expect(resourceOf(bound, WIDGET).excludedSpecFields).toEqual(expect.arrayContaining(['id', 'widget_id']))
    expect(exclusionCandidates(model.kinds[0], model).map((candidate) => candidate.field)).toContain('widget_id')
    expect(pathParamsOutsideSpec(model.kinds[0], model)).toEqual([])
  })
})
