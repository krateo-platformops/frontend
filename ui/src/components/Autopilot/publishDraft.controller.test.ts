/**
 * THE CONTROLLER PUBLISH, from the held tree (T8, frontend#412).
 *
 * A controller the Controller Builder composed publishes the way a blueprint does: the HELD files, one
 * BuilderPublish claim to a repository named for the controller under AUTOPILOT_KOG_BUILDER_REPO's
 * owner, seeded from AUTOPILOT_KOG_BUILDER_TEMPLATE, with compositiondefinition.yaml written at publish
 * — the Builder's spec.publish (targetKey, templateKey, registration) made real. There is no other
 * source (frontend#429): with nothing held, a publishRestDef — a person's or the agent's — is refused
 * with what to do instead, and an un-previewed controller is refused before the destination form.
 *
 * `buildClaimPublish` is mocked: what is under test is what publishDraft hands it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { load } from 'js-yaml'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./builderClaimPublish', () => ({
  buildClaimPublish: vi.fn(() => Promise.resolve({ branch: 'builder/x', compiled: { denial: null, ops: [] }, deepLink: null })),
}))

import { planPlaceGroup, planSetVerb, restDefinitionPath, type ControllerPlan } from '../../pages/ControllerComposer/controllerChart'
import { startController } from '../../pages/ControllerComposer/controllerStart'

import { createBlueprintDraftStore } from './blueprintDraftStore'
import { buildClaimPublish } from './builderClaimPublish'
import type { BuilderTargets } from './builderTargets'
import { NOTHING_HELD_CONTROLLER, publishDraft, REGISTRATION_PATH, type PublishDraftDeps } from './publishDraft'

const PETSTORE = readFileSync(join(__dirname, '..', '..', 'pages', 'ControllerComposer', '__fixtures__', 'petstore-v3.openapi.json'), 'utf8')
const SCAFFOLD = { owner: 'krateo-blueprints', repo: 'builder-scaffold' }
const NONE = { owner: '', repo: '' }

const targets = (over: Partial<BuilderTargets> = {}): BuilderTargets => ({
  blueprint: NONE,
  blueprintTemplate: { owner: 'acme', repo: 'blueprint-only' },
  kog: { owner: 'Krateo-Platformops', repo: 'krateo-oas' },
  kogTemplate: SCAFFOLD,
  page: NONE,
  pageTemplate: NONE,
  ...over,
})

const apply = (files: Record<string, string>, plan: ControllerPlan): Record<string, string> => {
  if (!plan.ok) { throw new Error(plan.reason) }
  return { ...files, ...(plan.add ?? {}), ...(plan.edit ?? {}) }
}

/** Petstore as the composer leaves it: pet (findby chosen) and store placed. */
const petstore = (settled = true): Record<string, string> => {
  const started = startController({ apiGroup: 'petstore.example.io', baseUrl: 'https://petstore3.swagger.io/api/v3', name: 'petstore', paths: null, spec: PETSTORE })
  if (!started.ok) { throw new Error(JSON.stringify(started.problems)) }
  let files = apply(started.files, planPlaceGroup(started.files, 'pet'))
  if (settled) { files = apply(files, planSetVerb(files, restDefinitionPath('Pet'), 'findby', { method: 'GET', path: '/pet/findByStatus' })) }
  return apply(files, planPlaceGroup(files, 'store'))
}

const deps = (files: Record<string, string> | null, over: Partial<PublishDraftDeps> = {}, kind: 'controller' | 'blueprint' = 'controller'): PublishDraftDeps => {
  const store = createBlueprintDraftStore()
  if (files) { expect(store.set(files, kind).ok).toBe(true) }
  return {
    blueprintGate: { evaluate: () => ({ allowed: true, reason: null }) },
    blueprintStore: store,
    builderTargets: targets(),
    config: { api: { AUTOPILOT_GIT_HOST: 'github.com' } },
    origin: { prompt: null, sessionId: null },
    ...over,
  } as unknown as PublishDraftDeps
}

const claimArgs = () => {
  expect(buildClaimPublish).toHaveBeenCalledTimes(1)
  const [[args]] = vi.mocked(buildClaimPublish).mock.calls
  return args
}

beforeEach(() => {
  vi.mocked(buildClaimPublish).mockClear()
})

describe('a person publishes the held controller', () => {
  it('as ONE claim of the held tree, named for the controller, under the KOG owner, seeded from the KOG template, registered at publish', async () => {
    const files = petstore()
    const outcome = await publishDraft(deps(files, { initiator: 'person' }), { label: 'Publish', verb: 'publishRestDef' })
    expect(outcome.compiled.denial).toBeNull()
    const args = claimArgs()
    expect(args.builder).toBe('controller')
    expect(args.slug).toBe('petstore')
    expect(args.dest).toMatchObject({ owner: 'Krateo-Platformops', repo: 'petstore' })
    expect(args.sourceUrl).toBe('https://github.com/krateo-blueprints/builder-scaffold.git')
    expect(args.files.map((file) => file.path).sort()).toEqual([
      'Chart.yaml',
      REGISTRATION_PATH,
      'templates/configmap-oas-petstore.yaml',
      'templates/restdefinition-pet.yaml',
      'templates/restdefinition-store.yaml',
      'values.schema.json',
      'values.yaml',
    ])
    const registration = args.files.find((file) => file.path === REGISTRATION_PATH)?.content ?? ''
    expect(load(registration)).toEqual({
      apiVersion: 'core.krateo.io/v1alpha1',
      kind: 'CompositionDefinition',
      metadata: { name: 'petstore', namespace: 'krateo-system' },
      spec: { chart: { url: 'oci://ghcr.io/krateo-platformops/charts/petstore', version: '0.1.0' } },
    })
    expect(registration).toContain('generates Pet, Store in petstore.example.io')
    // The held bytes, verbatim.
    expect(args.files.find((file) => file.path === 'templates/restdefinition-pet.yaml')?.content).toBe(files['templates/restdefinition-pet.yaml'])
  })

  it('is gated by the preview gate on the controller\'s name, like a blueprint', async () => {
    const evaluate = vi.fn(() => ({ allowed: true, reason: null }))
    await publishDraft(deps(petstore(), { blueprintGate: { evaluate } as never, initiator: 'person' }), { verb: 'publishRestDef' })
    claimArgs().gate([])
    expect(evaluate).toHaveBeenCalledWith([], 'petstore')
  })

  it('an un-previewed controller is refused BY NAME, in its own words, before anyone is asked where it goes', async () => {
    const evaluate = vi.fn(() => ({ allowed: false, reason: 'denied — preview first' }))
    const outcome = await publishDraft(deps(petstore(), { blueprintGate: { evaluate } as never }), { verb: 'publishRestDef' })
    expect(outcome.compiled.denial).toBe('denied — preview first: a controller "petstore" has not rendered since it last changed. Preview it (previewRestDef) — a render with no problems arms publishing.')
    expect(buildClaimPublish).not.toHaveBeenCalled()
  })

  it('a controller with a verb nobody settled is refused BY NAME, before anyone is asked where it goes', async () => {
    const outcome = await publishDraft(deps(petstore(false), { initiator: 'person' }), { verb: 'publishRestDef' })
    expect(outcome.compiled.denial).toMatch(/^denied — the draft fails the chart lint: Pet: 2 operations look like findby/)
    expect(buildClaimPublish).not.toHaveBeenCalled()
  })

  it('with nothing held, a person is told to start a controller first', async () => {
    const outcome = await publishDraft(deps(null, { initiator: 'person' }), { verb: 'publishRestDef' })
    expect(outcome.compiled.denial).toBe(NOTHING_HELD_CONTROLLER)
    expect(buildClaimPublish).not.toHaveBeenCalled()
  })
})

describe('the agent\'s publishRestDef (frontend#429: the held controller, and nothing else)', () => {
  it('publishes the held controller', async () => {
    await publishDraft(deps(petstore()), { verb: 'publishRestDef' })
    expect(claimArgs().slug).toBe('petstore')
  })

  it('with no controller held, is refused with what to do instead — the legacy rail source is gone', async () => {
    const outcome = await publishDraft(deps(null), { owner: 'acme', repo: 'pet', verb: 'publishRestDef' })
    expect(outcome.compiled.denial).toBe(NOTHING_HELD_CONTROLLER)
    expect(outcome.compiled.denial).toMatch(/Start one first \(controllerStart/)
    expect(outcome.held).toBeNull()
    expect(buildClaimPublish).not.toHaveBeenCalled()
  })

  it('with a chart held, is refused by kind', async () => {
    const outcome = await publishDraft(deps({ 'Chart.yaml': 'apiVersion: v2\nname: chart\nversion: 0.1.0\n' }, {}, 'blueprint'), { verb: 'publishRestDef' })
    expect(outcome.compiled.denial).toMatch(/^denied — the open draft is a blueprint chart, and publishRestDef publishes a controller/)
    expect(buildClaimPublish).not.toHaveBeenCalled()
  })
})
