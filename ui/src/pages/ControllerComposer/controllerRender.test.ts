/**
 * T9 (frontend#413) — the controller preview's pure half: the draft.json controller-render-draft reads,
 * the verdict on its answer, and the create forms the Rendered tab draws. The composer walk is in
 * ControllerComposer.test.tsx; these pin the edges it does not reach.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SandboxWriter } from '../../components/Autopilot/blueprintRenderSandbox'
import type { WriteOp } from '../../components/BlastRadius/buildBlastRadius'

import { planPlaceGroup, restDefinitionPath, type ControllerPlan } from './controllerChart'
import {
  controllerDraftJson,
  controllerVerdict,
  readControllerRender,
  renderController,
  renderedForms,
} from './controllerRender'
import { startController } from './controllerStart'

const PETSTORE = readFileSync(join(__dirname, '__fixtures__', 'petstore-v3.openapi.json'), 'utf8')
const SANDBOX = 'krateo-preview'
const TARGET = { namespace: 'krateo-system', restAction: 'controller-render-draft', snowplowBaseUrl: 'https://snowplow.test' }

const apply = (files: Record<string, string>, plan: ControllerPlan): Record<string, string> => {
  if (!plan.ok) { throw new Error(plan.reason) }
  return { ...files, ...(plan.add ?? {}), ...(plan.edit ?? {}) }
}

const started = (): Record<string, string> => {
  const start = startController({ apiGroup: 'petstore.example.io', baseUrl: 'https://petstore3.swagger.io/api/v3', name: 'petstore', paths: null, spec: PETSTORE })
  if (!start.ok) { throw new Error(JSON.stringify(start.problems)) }
  return start.files
}
const withStore = (): Record<string, string> => apply(started(), planPlaceGroup(started(), 'store'))

const writer = (refuse = false) => {
  const ops: WriteOp[] = []
  const sandbox: SandboxWriter = {
    handleActionSet: (batch) => {
      ops.push(...batch)
      return Promise.resolve(batch.map((op, index) => ({ index, message: refuse && op.verb === 'POST' ? 'forbidden' : 'OK', ok: !(refuse && op.verb === 'POST'), status: refuse && op.verb === 'POST' ? 403 : 200 })))
    },
    sandboxNamespace: SANDBOX,
  }
  return { ops, sandbox }
}

const crd = (kind: string, spec: Record<string, unknown> | null) => JSON.stringify({
  kind: 'CustomResourceDefinition',
  metadata: { name: `${kind.toLowerCase()}s.petstore.example.io` },
  spec: { names: { kind }, versions: [{ name: 'v1alpha1', schema: { openAPIV3Schema: { properties: spec ? { spec } : {}, type: 'object' } }, served: true, storage: true }] },
})

afterEach(() => { vi.unstubAllGlobals() })

describe('controllerDraftJson — the body controller-render-draft renders', () => {
  it('each RestDefinition with the release namespace read as the sandbox\'s, and each document under exactly its oasPath', () => {
    const built = controllerDraftJson(withStore(), SANDBOX)
    if (!built.ok) { throw new Error(built.problems.join('\n')) }
    const key = `configmap://${SANDBOX}/petstore-oas/openapi.json`
    expect(built.draft.restDefinitions).toHaveLength(1)
    expect(built.draft.restDefinitions[0]).toMatchObject({ kind: 'RestDefinition', metadata: { name: 'petstore-store', namespace: SANDBOX }, spec: { oasPath: key } })
    expect(Object.keys(built.draft.oas)).toEqual([key])
    expect(JSON.parse(built.draft.oas[key])).toMatchObject({ info: { title: 'Swagger Petstore - OpenAPI 3.0' } })
    expect(JSON.stringify(built.draft)).not.toContain('.Release.Namespace')
  })

  it('a document with a literal {{ is sent as Helm would render it, not as the chart escapes it', () => {
    const files = withStore()
    const path = 'templates/configmap-oas-petstore.yaml'
    const escaped = { ...files, [path]: files[path].replace('Swagger Petstore - OpenAPI 3.0', 'Petstore {{`{{`}}v3}}') }
    const built = controllerDraftJson(escaped, SANDBOX)
    if (!built.ok) { throw new Error(built.problems.join('\n')) }
    expect(Object.values(built.draft.oas)[0]).toContain('Petstore {{v3}}')
  })

  it('refuses, by name, what it cannot render: no Kind, an oasPath the chart does not carry, a template action', () => {
    expect(controllerDraftJson(started(), SANDBOX)).toEqual({ ok: false, problems: ['No Kind is placed yet — place one from the palette, then preview the controller.'] })

    const files = withStore()
    const path = restDefinitionPath('Store')
    const elsewhere = controllerDraftJson({ ...files, [path]: files[path].replace(/oasPath: .*/, 'oasPath: https://specs.example/petstore.json') }, SANDBOX)
    expect(elsewhere.ok).toBe(false)
    expect(!elsewhere.ok && elsewhere.problems[0]).toMatch(/^Store \(templates\/restdefinition-store\.yaml\): spec\.oasPath https:\/\/specs\.example\/petstore\.json names no document this chart carries/)

    const templated = controllerDraftJson({ ...files, [path]: files[path].replace('kind: Store', 'kind: "{{ .Values.kind }}"') }, SANDBOX)
    expect(!templated.ok && templated.problems.join('\n')).toMatch(/carries a Helm template action the preview cannot evaluate/)
  })
})

describe('controllerVerdict — armed only on CRDs and zero problems', () => {
  const ok = { objects: [{ kind: 'CustomResourceDefinition', name: 'stores.petstore.example.io', yaml: crd('Store', { properties: {}, type: 'object' }) }], problems: [], warnings: ['skipped: oauth'] }

  it('rendered, with its warnings kept', () => {
    expect(controllerVerdict(ok)).toEqual({ outcome: 'rendered', render: ok })
  })

  it('any problem fails it; no CRD at all fails it too', () => {
    expect(controllerVerdict({ ...ok, problems: ['gh-issue: poll path must be a path of the same API'] })).toMatchObject({ outcome: 'failed', render: { objects: [], problems: ['gh-issue: poll path must be a path of the same API'] } })
    expect(controllerVerdict({ objects: [], problems: [], warnings: [] })).toMatchObject({ outcome: 'failed', render: { problems: ['oasgen-render generated no CRD for this controller, so there is nothing to publish yet.'] } })
  })

  it('oasgen-render missing is UNAVAILABLE, in the RESTAction\'s own words', () => {
    const down = 'Controller preview needs oasgen-render (oasgen-provider ≥0.25.0 with render.enabled): no such host'
    expect(controllerVerdict({ objects: [], problems: [down], warnings: [] })).toEqual({ message: down, outcome: 'unavailable' })
  })

  it('an answer with only `error` (no problems list) still fails; each CRD\'s JSON is shown as YAML', () => {
    const read = readControllerRender({ error: 'the controller draft could not be read: 403', objects: [] })
    expect(read.problems).toEqual(['the controller draft could not be read: 403'])
    const shown = readControllerRender({ objects: [{ kind: 'CustomResourceDefinition', name: 'stores.petstore.example.io', yaml: crd('Store', null) }] })
    expect(shown.objects[0].yaml).toMatch(/^kind: CustomResourceDefinition\n/)
  })
})

describe('renderedForms — the Rendered tab', () => {
  it('each CRD\'s spec schema, by Kind; a CRD with no spec schema has no form', () => {
    const forms = renderedForms([
      { kind: 'CustomResourceDefinition', name: 'pets.petstore.example.io', yaml: crd('Pet', { properties: { status: { type: 'string' } }, type: 'object' }) },
      { kind: 'CustomResourceDefinition', name: 'bare.petstore.example.io', yaml: crd('Bare', null) },
    ])
    expect(forms).toEqual([{ crd: 'pets.petstore.example.io', kind: 'Pet', schema: JSON.stringify({ properties: { status: { type: 'string' } }, type: 'object' }) }])
  })
})

describe('renderController — no fallback, no fake success', () => {
  it('a refused sandbox write renders nothing and says so', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { sandbox } = writer(true)
    const answer = await renderController(withStore(), TARGET, sandbox, 'petstore', 'n0nce')
    expect(answer).toEqual({ message: `The controller could not be written into the preview sandbox (${SANDBOX}: 403 forbidden), so it was not rendered. It is still held; Publish stays off.`, outcome: 'unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a portal without the RESTAction is unavailable — and the ConfigMap is still deleted', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve(null), ok: false, status: 404 })))
    const { ops, sandbox } = writer()
    const answer = await renderController(withStore(), TARGET, sandbox, 'petstore', 'n0nce')
    expect(answer).toMatchObject({ outcome: 'unavailable' })
    expect(answer.outcome === 'unavailable' && answer.message).toMatch(/^controller-render-draft RESTAction responded 404 — /)
    expect(ops.map((op) => op.verb)).toEqual(['POST', 'DELETE'])
    expect(new URL(ops[1].path, 'http://x').searchParams.get('name')).toBe('ctl-preview-petstore-n0nce')
  })

  it('nothing to render is refused before anything is written', async () => {
    const { ops, sandbox } = writer()
    const answer = await renderController(started(), TARGET, sandbox, 'petstore')
    expect(answer).toMatchObject({ outcome: 'refused', problems: ['No Kind is placed yet — place one from the palette, then preview the controller.'] })
    expect(ops).toEqual([])
  })
})
