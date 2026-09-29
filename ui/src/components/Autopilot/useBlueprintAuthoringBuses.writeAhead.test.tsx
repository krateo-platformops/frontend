// @vitest-environment jsdom
/**
 * WRITE-AHEAD for a person's blueprint Preview: the draft record is written BEFORE the render puts
 * anything in the sandbox, so a tab killed mid-Preview has already stored the chart; and a render
 * that succeeded is recorded on the record (renderedHash), one that failed is not.
 *
 * Real autosave, real store, one fake writer that sees every sandbox write in order — the record's
 * and the render's alike — so the order asserted is the order the apiserver would see.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./previewBridge', async (importOriginal) => ({
  ...await importOriginal<object>(),
  callRenderRestAction: vi.fn(),
}))

import type { Config } from '../../context/ConfigContext'
import type { SetDispatchOptions, WriteOpResult } from '../../hooks/runRestSet'
import type { WriteOp } from '../BlastRadius/buildBlastRadius'

import { CHART_YAML_PATH, VALUES_SCHEMA_PATH } from './blueprintDraft'
import { createBlueprintDraftStore } from './blueprintDraftStore'
import type { SandboxWriter } from './blueprintRenderSandbox'
import { readDraftRecord, treeHash } from './draftRecord'
import { draftSaveStatus } from './draftSaveStatus'
import { callRenderRestAction, type HelmRenderResult } from './previewBridge'
import { type DraftRenderResultDetail, emitDraftRenderRequest, onDraftRenderResult } from './previewDraftRender'
import { useBlueprintAuthoringBuses } from './useBlueprintAuthoringBuses'
import { createDraftAutosave, type DraftAutosave } from './useDraftAutosave'

const CONFIG = { api: { SNOWPLOW_API_BASE_URL: 'https://snowplow.test' }, params: { FRONTEND_NAMESPACE: 'krateo-system' } } as unknown as Config
const SANDBOX = 'krateo-preview'

const chart = (): Record<string, string> => ({
  [CHART_YAML_PATH]: 'apiVersion: v2\nname: demo-chart\nversion: 0.1.0\n',
  [VALUES_SCHEMA_PATH]: JSON.stringify({ properties: { enabled: { default: true, type: 'boolean' } }, type: 'object' }),
  'templates/configmap.yaml': '{{- if .Values.enabled }}\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ .Release.Name }}\n{{- end }}\n',
  'values.yaml': 'enabled: true\n',
})

const RENDERED: HelmRenderResult = { objects: [{ apiVersion: 'v1', kind: 'ConfigMap', name: 'demo' } as unknown as HelmRenderResult['objects'][number]] }

interface Seen { verb: WriteOp['verb']; name: string; payload: unknown }

const nameOf = (op: WriteOp): string =>
  ((op.payload as { metadata?: { name?: string } } | undefined)?.metadata?.name) ?? new URLSearchParams(op.path.split('?')[1]).get('name') ?? ''

const Host = ({ autosave, store, writer }: { autosave: DraftAutosave; store: ReturnType<typeof createBlueprintDraftStore>; writer: SandboxWriter }) => {
  useBlueprintAuthoringBuses(store, { forget: vi.fn(), recordPreview: vi.fn() }, CONFIG, writer, autosave)
  return null
}

const mount = () => {
  const seen: Seen[] = []
  const writer: SandboxWriter = {
    handleActionSet: (ops: readonly WriteOp[], _options?: SetDispatchOptions): Promise<WriteOpResult[] | null> => {
      ops.forEach((op) => seen.push({ name: nameOf(op), payload: op.payload, verb: op.verb }))
      return Promise.resolve(ops.map((_, index) => ({ index, message: 'OK', ok: true, status: 201 })))
    },
    sandboxNamespace: SANDBOX,
  }
  // A long debounce: nothing here may be saved by the timer — only by the write-ahead.
  const autosave = createDraftAutosave({ debounceMs: 60_000, username: () => 'diego' })
  autosave.setWriter(writer)
  const store = createBlueprintDraftStore(autosave.onHeldChange)
  store.set(chart(), 'blueprint')
  const results: DraftRenderResultDetail[] = []
  const stop = onDraftRenderResult((detail) => { results.push(detail) })
  render(<Host autosave={autosave} store={store} writer={writer} />)
  return { results, seen, stop }
}

/** Let the render's chain of awaited writes settle. */
const settle = () => act(async () => {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
})

beforeEach(() => {
  vi.mocked(callRenderRestAction).mockReset()
  draftSaveStatus.reset()
})

afterEach(() => {
  cleanup()
})

describe('blueprint Preview — write-ahead', () => {
  it('writes the draft record BEFORE the render writes its chart to the sandbox', async () => {
    vi.mocked(callRenderRestAction).mockResolvedValue(RENDERED)
    const { results, seen, stop } = mount()
    act(() => { emitDraftRenderRequest({ id: 'r1' }) })
    await settle()
    stop()
    expect(results.at(-1)?.outcome).toBe('rendered')
    const order = seen.map((write) => `${write.verb} ${write.name}`)
    // The record, then the render's chart ConfigMap (created, then deleted), then the record again
    // carrying the rendered hash.
    expect(order[0]).toBe('POST draft-blueprint-diego-demo-chart')
    expect(order[1]).toMatch(/^POST bp-preview-demo-chart-/)
    expect(seen[2].verb).toBe('DELETE')
    expect(order[3]).toBe('PUT draft-blueprint-diego-demo-chart')
    expect(readDraftRecord(seen[3].payload)?.renderedHash).toBe(treeHash(chart()))
  })

  it('a render that FAILED leaves no rendered hash on the record', async () => {
    vi.mocked(callRenderRestAction).mockResolvedValue({ error: 'template: configmap.yaml:3: unexpected EOF', objects: [] })
    const { results, seen, stop } = mount()
    act(() => { emitDraftRenderRequest({ id: 'r2' }) })
    await settle()
    stop()
    expect(results.at(-1)?.outcome).toBe('failed')
    const records = seen.filter((write) => write.name.startsWith('draft-'))
    expect(records.map((write) => write.verb)).toEqual(['POST'])
    expect(readDraftRecord(records[0].payload)?.renderedHash).toBeUndefined()
  })
})
