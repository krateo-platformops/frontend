/**
 * FE-B1 previewBlueprint INLINE-DRAFT mode — handler-level coverage (pure logic, the
 * drawer mocked at the previewBus seam, fetch stubbed):
 *   - happy path: rawTemplates in → POST /render with {rawTemplates, values} (and NO
 *     chart key) → drawer carries the rendered objects AND the create-form schema
 *     (verbatim draft values.schema.json);
 *   - exactly-one-of: both chart+rawTemplates, neither, or a malformed tree → denied
 *     (null), no fetch, no drawer — never a crash;
 *   - FE-B2 gate: a #46-class schema default or an over-cap draft → drawer verdicts
 *     only, ZERO network ("draft rejected" chip);
 *   - graceful absence: no renderBaseUrl → the unchanged "unavailable" chip, no fetch;
 *   - a render {error} on an inline draft is CONTENT, and suppresses the form section.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PortalActionProposal } from './actionBridge'
import { DRAFT_REJECTED_CAPTION, RAW_TEMPLATES_MAX_BYTES } from './blueprintDraft'
import type { AutopilotPreviewPayload } from './previewBus'
import { openAutopilotPreview } from './previewBus'
import { previewBlueprintSpec, RENDER_UNAVAILABLE_LABEL } from './previewHandlers'
import type { VerbDeps } from './verbRegistry'

vi.mock('./previewBus', () => ({ openAutopilotPreview: vi.fn() }))

const openPreviewMock = vi.mocked(openAutopilotPreview)

const makeDeps = (renderBaseUrl?: string): VerbDeps => ({
  handleAction: vi.fn((): Promise<void> => Promise.resolve()),
  routePatterns: [],
  ...(renderBaseUrl ? { renderBaseUrl } : {}),
})

const asProposal = (extra: Record<string, unknown>): PortalActionProposal =>
  ({ verb: 'previewBlueprint', ...extra })

const openedPayload = (): AutopilotPreviewPayload => openPreviewMock.mock.calls[0][0]

const SCHEMA_TEXT = JSON.stringify({
  properties: { size: { default: 'S', title: 'Size', type: 'string' } },
  type: 'object',
})

const DRAFT: Record<string, string> = {
  'Chart.yaml': 'apiVersion: v2\nname: pg-app\nversion: 0.1.0\n',
  'templates/deployment.yaml': 'kind: Deployment\nmetadata:\n  name: {{ .Release.Name }}\n',
  'values.schema.json': SCHEMA_TEXT,
  'values.yaml': 'size: S\n',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('previewBlueprint inline-draft mode (FE-B1)', () => {
  it('happy path: POSTs {rawTemplates, values} (no chart key) and opens the drawer with objects + form schema', async () => {
    const fetchMock = vi.fn((..._args: unknown[]) => Promise.resolve({
      json: () => Promise.resolve({
        objects: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'pg-app', namespace: 'demo', yaml: 'kind: Deployment' }],
        valuesSchema: JSON.parse(SCHEMA_TEXT) as unknown,
      }),
      ok: true,
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const chip = await previewBlueprintSpec.apply(
      asProposal({ rawTemplates: DRAFT, values: { size: 'M' } }),
      makeDeps('http://render.local'),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://render.local/render')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(body.rawTemplates).toEqual(DRAFT)
    expect(body.values).toEqual({ size: 'M' })
    expect(body.chart).toBeUndefined()
    expect(openPreviewMock).toHaveBeenCalledTimes(1)
    const payload = openedPayload()
    // An inline draft that rendered is the one blueprint preview the provider HOLDS.
    expect(payload.builder).toBe('blueprint')
    expect(payload.title).toBe('Blueprint preview — pg-app')
    expect(payload.error).toBeUndefined()
    expect(payload.objects).toHaveLength(1)
    // The form-preview half: the RAW draft schema string, verbatim (authoring order).
    expect(payload.formSchema).toBe(SCHEMA_TEXT)
    // `rendered` is what arms the gate — a positive signal, not the absence of a failure.
    expect(chip).toEqual({ label: 'preview pg-app (1 object)', readOnly: true, rendered: true, verb: 'previewBlueprint' })
  })

  it('denies ambiguous or malformed args: both sources, neither, or a bad tree — no fetch, no drawer', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const deps = makeDeps('http://render.local')
    const both = asProposal({ chart: { url: 'oci://ghcr.io/x/y' }, rawTemplates: DRAFT })
    const empty = asProposal({ rawTemplates: {} })
    const nonString = asProposal({ rawTemplates: { 'Chart.yaml': 42 } })
    for (const proposal of [both, empty, nonString, asProposal({})]) {
      expect(previewBlueprintSpec.argSchema(proposal)).toBe(false)
      expect(await previewBlueprintSpec.apply(proposal, deps)).toBeNull() // eslint-disable-line no-await-in-loop
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openPreviewMock).not.toHaveBeenCalled()
  })

  it('FE-B2: a #46-class schema default is a HARD ERROR — drawer verdicts only, ZERO network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const bad = {
      ...DRAFT,
      'values.schema.json': JSON.stringify({
        properties: {
          ingress: {
            properties: {
              hosts: { default: [{ host: 'chart-example.local' }], type: 'array' },
            },
            type: 'object',
          },
        },
        type: 'object',
      }),
    }
    const chip = await previewBlueprintSpec.apply(asProposal({ rawTemplates: bad }), makeDeps('http://render.local'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openPreviewMock).toHaveBeenCalledTimes(1)
    const payload = openedPayload()
    expect(payload.caption).toBe(DRAFT_REJECTED_CAPTION)
    // Refused before any render, so nothing holds it — an inspection, whose Files are not editable.
    expect(payload.builder).toBe('inspect')
    expect(payload.problems).toHaveLength(1)
    expect(payload.problems?.[0]).toContain('[CRDGEN-DEFAULTS]')
    expect(payload.problems?.[0]).toContain('properties.ingress.properties.hosts.default')
    expect(payload.formSchema).toBeUndefined()
    expect(payload.objects).toBeUndefined()
    expect(chip).toEqual({ label: 'preview pg-app (draft rejected)', readOnly: true, verb: 'previewBlueprint' })
  })

  it('an inline draft is linted AS A BLUEPRINT — a name that outgrew its version is refused BEFORE any fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // Kind 34: inside the budget at 0.1.0, three over it at 10.20.30. A page would pass; this is not one.
    const name = `a${'b'.repeat(33)}`
    const bumped = { ...DRAFT, 'Chart.yaml': `apiVersion: v2\nname: ${name}\nversion: 10.20.30\n` }
    const chip = await previewBlueprintSpec.apply(asProposal({ rawTemplates: bumped }), makeDeps('http://render.local'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openedPayload().problems?.join('\n')).toContain('at version 10.20.30 the Kind (the name without dashes) can be at most 31 characters')
    expect(chip?.label).toBe(`preview ${name} (draft rejected)`)
  })

  it('size-cap rejection: a draft over 512 KiB is refused BEFORE any fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const oversized = { ...DRAFT, 'templates/blob.yaml': 'x'.repeat(RAW_TEMPLATES_MAX_BYTES + 1) }
    const chip = await previewBlueprintSpec.apply(asProposal({ rawTemplates: oversized }), makeDeps('http://render.local'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openPreviewMock).toHaveBeenCalledTimes(1)
    expect(openedPayload().problems?.[0]).toContain('512 KiB')
    expect(chip?.label).toBe('preview pg-app (draft rejected)')
  })

  it('no renderBaseUrl → the unchanged graceful "unavailable" chip, ZERO network (inline mode too)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const chip = await previewBlueprintSpec.apply(asProposal({ rawTemplates: DRAFT }), makeDeps())
    expect(chip).toEqual({ label: RENDER_UNAVAILABLE_LABEL, readOnly: true, verb: 'previewBlueprint' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openPreviewMock).not.toHaveBeenCalled()
  })

  it('a render {error} on an inline draft is CONTENT — and suppresses the form section', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ error: 'template: deployment.yaml: function "boom" not defined' }),
      ok: true,
      status: 200,
    })))
    const chip = await previewBlueprintSpec.apply(asProposal({ rawTemplates: DRAFT }), makeDeps('http://render.local'))
    expect(openPreviewMock).toHaveBeenCalledTimes(1)
    const payload = openedPayload()
    // Not held (the gate never arms on a failed render), so its Chart files must not be editable.
    expect(payload.builder).toBe('inspect')
    expect(payload.error).toContain('function "boom" not defined')
    expect(payload.formSchema).toBeUndefined()
    // `previewFailed` is what stops the host arming the publish gate on a chart that does
    // not render. Asserted here rather than only in the provider, because it is the chip's
    // contract: the drawer showed this error all along and nothing acted on it.
    expect(chip).toEqual({ label: 'preview pg-app (render failed)', previewFailed: true, readOnly: true, verb: 'previewBlueprint' })
  })

  it('remote-chart mode still works and now carries the RESPONSE valuesSchema as the form schema', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({
        objects: [],
        valuesSchema: { properties: { size: { type: 'string' } }, type: 'object' },
      }),
      ok: true,
      status: 200,
    })))
    await previewBlueprintSpec.apply(
      asProposal({ chart: { url: 'oci://ghcr.io/x/aws-vpc' } }),
      makeDeps('http://render.local'),
    )
    expect(openedPayload().formSchema).toBe(JSON.stringify({ properties: { size: { type: 'string' } }, type: 'object' }))
  })
})
