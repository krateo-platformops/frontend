// @vitest-environment jsdom
/**
 * A PERSON starting and previewing a chart — the two steps the agent's previewBlueprint verb does in
 * one, split so the composer can hold a chart before anything has rendered it.
 *
 * What these pin, each a way the person's chart could be lost or published unrendered:
 *   - a start holds the tree BEFORE the render answers, and never arms it;
 *   - a start over an open draft is refused out loud, and the open draft survives;
 *   - a render lints first and sends nothing when the lint fails;
 *   - a render with no transport leaves the chart held, disarmed, and says why;
 *   - only a render that succeeded, of the draft still held, arms the gate;
 *   - no outcome opens the drawer — the surface that asked shows it.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./previewBridge', async (importOriginal) => ({
  ...await importOriginal<object>(),
  callBlueprintRenderRA: vi.fn(),
}))

import type { Config } from '../../context/ConfigContext'

import { CHART_YAML_PATH, VALUES_SCHEMA_PATH } from './blueprintDraft'
import { type BlueprintDraftStore, createBlueprintDraftStore } from './blueprintDraftStore'
import { type BlueprintGate, createBlueprintGate } from './blueprintGate'
import { draftHistory } from './draftHistory'
import { callBlueprintRenderRA, type HelmRenderResult } from './previewBridge'
import { AUTOPILOT_PREVIEW_EVENT } from './previewBus'
import { type DraftRenderResultDetail, emitChartStart, emitDraftRenderRequest, onDraftRenderResult } from './previewDraftRender'
import { RENDER_NOT_CONFIGURED, useBlueprintAuthoringBuses } from './useBlueprintAuthoringBuses'

const CONFIG = { api: { SNOWPLOW_API_BASE_URL: 'https://snowplow.test' }, params: { FRONTEND_NAMESPACE: 'krateo-system' } } as unknown as Config

const chart = (name = 'demo-chart'): Record<string, string> => ({
  [CHART_YAML_PATH]: `apiVersion: v2\nname: ${name}\nversion: 0.1.0\n`,
  [VALUES_SCHEMA_PATH]: JSON.stringify({ properties: { enabled: { default: true, type: 'boolean' } }, type: 'object' }),
  'templates/configmap.yaml': '{{- if .Values.enabled }}\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ .Release.Name }}\n{{- end }}\n',
  'values.yaml': 'enabled: true\n',
})

const RENDERED: HelmRenderResult = { objects: [{ apiVersion: 'v1', kind: 'ConfigMap', name: 'demo' } as unknown as HelmRenderResult['objects'][number]] }

const gateFake = () => ({ forget: vi.fn(), recordPreview: vi.fn() })

const Host = ({ config, gate, store }: { config: Config | undefined; gate: Pick<BlueprintGate, 'forget' | 'recordPreview'>; store: BlueprintDraftStore }) => {
  useBlueprintAuthoringBuses(store, gate, config)
  return null
}

/** Mount the hook and collect every render result it answers. */
const mount = (config: Config | undefined = CONFIG) => {
  const store = createBlueprintDraftStore()
  const gate = gateFake()
  const results: DraftRenderResultDetail[] = []
  const stop = onDraftRenderResult((detail) => { results.push(detail) })
  render(<Host config={config} gate={gate} store={store} />)
  return { gate, results, stop, store }
}

/** Let the render's awaited promise settle. */
const settle = () => act(async () => { await Promise.resolve() })

let drawerOpens = 0
const countDrawerOpen = (): void => { drawerOpens += 1 }

beforeEach(() => {
  vi.mocked(callBlueprintRenderRA).mockReset()
  drawerOpens = 0
  window.addEventListener(AUTOPILOT_PREVIEW_EVENT, countDrawerOpen)
})

afterEach(() => {
  window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, countDrawerOpen)
  cleanup()
})

describe('starting a chart', () => {
  it('HOLDS the tree before the render answers, and does not arm it', async () => {
    let resolveRender: (value: HelmRenderResult) => void = () => undefined
    vi.mocked(callBlueprintRenderRA).mockReturnValue(new Promise((resolve) => { resolveRender = resolve }))
    const { gate, results, stop, store } = mount()

    act(() => { emitChartStart({ files: chart(), id: 's1' }) })

    expect(store.get()?.kind).toBe('blueprint')
    expect(store.get()?.files[CHART_YAML_PATH]).toMatch(/name: demo-chart/)
    expect(gate.recordPreview).not.toHaveBeenCalled()
    expect(results).toEqual([])

    resolveRender(RENDERED)
    await settle()
    expect(results.map((result) => result.outcome)).toEqual(['rendered'])
    stop()
  })

  it('arms on a rendered chart, answers by id with the payload, and opens no drawer', async () => {
    vi.mocked(callBlueprintRenderRA).mockResolvedValue(RENDERED)
    const { gate, results, stop } = mount()

    act(() => { emitChartStart({ files: chart(), id: 's2' }) })
    await settle()

    expect(gate.recordPreview).toHaveBeenCalledWith('demo-chart')
    // The start forgets any earlier arming of the name FIRST; only the render arms it.
    expect(gate.forget).toHaveBeenCalledTimes(1)
    expect(gate.forget.mock.invocationCallOrder[0]).toBeLessThan(gate.recordPreview.mock.invocationCallOrder[0])
    const [answer] = results
    expect(answer).toMatchObject({ id: 's2', message: null, outcome: 'rendered' })
    expect(answer.payload?.builder).toBe('blueprint')
    expect(answer.payload?.objects).toHaveLength(1)
    expect(answer.payload?.files?.map((file) => file.path)).toContain(CHART_YAML_PATH)
    expect(drawerOpens).toBe(0)
    // Through /call under the caller's own credential, with the held tree — never the direct render.
    expect(vi.mocked(callBlueprintRenderRA).mock.calls[0]).toEqual(['https://snowplow.test', 'krateo-system', { rawTemplates: chart() }])
    stop()
  })

  it('is REFUSED while a draft is held, and the held draft survives', async () => {
    const { gate, results, stop, store } = mount()
    store.set({ 'templates/flex.page-home.yaml': 'kind: Flex\n' }, 'page')
    const before = store.get()

    act(() => { emitChartStart({ files: chart(), id: 's3' }) })
    await settle()

    expect(store.get()).toBe(before)
    // A refused start touches nothing — not even the held draft's arming.
    expect(gate.forget).not.toHaveBeenCalled()
    expect(results).toEqual([expect.objectContaining({ id: 's3', outcome: 'refused' })])
    expect(results[0].message).toMatch(/already open/)
    expect(callBlueprintRenderRA).not.toHaveBeenCalled()
    stop()
  })

  it('never inherits an arming an earlier chart earned under the same name — a start never arms', () => {
    vi.mocked(callBlueprintRenderRA).mockReturnValue(new Promise(() => undefined))
    const { gate, stop } = mount()

    act(() => { emitChartStart({ files: chart(), id: 's6' }) })

    expect(gate.forget).toHaveBeenCalledWith('demo-chart')
    expect(gate.recordPreview).not.toHaveBeenCalled()
    stop()
  })

  it('…and with a REAL gate: the name an earlier chart armed is not armed for this one', () => {
    vi.mocked(callBlueprintRenderRA).mockReturnValue(new Promise(() => undefined))
    const gate = createBlueprintGate()
    gate.recordPreview('demo-chart')
    render(<Host config={CONFIG} gate={gate} store={createBlueprintDraftStore()} />)

    act(() => { emitChartStart({ files: chart(), id: 's7' }) })

    expect(gate.isArmed('demo-chart')).toBe(false)
  })

  it('starts with no undo history from the last draft', () => {
    vi.mocked(callBlueprintRenderRA).mockReturnValue(new Promise(() => undefined))
    const clear = vi.spyOn(draftHistory, 'clear')
    const { stop } = mount()

    act(() => { emitChartStart({ files: chart(), id: 's4' }) })

    expect(clear).toHaveBeenCalledTimes(1)
    clear.mockRestore()
    stop()
  })

  it('an empty tree is refused by the store, in the store\'s words', async () => {
    const { results, stop, store } = mount()

    act(() => { emitChartStart({ files: {}, id: 's5' }) })
    await settle()

    expect(store.get()).toBeNull()
    expect(results).toEqual([expect.objectContaining({ id: 's5', outcome: 'refused' })])
    expect(results[0].message).toMatch(/empty/)
    stop()
  })
})

describe('previewing the held chart', () => {
  it('refuses when no chart is held — a held PAGE is not a chart', async () => {
    const { results, stop, store } = mount()
    store.set({ 'templates/flex.page-home.yaml': 'kind: Flex\n' }, 'page')

    act(() => { emitDraftRenderRequest({ id: 'r1' }) })
    await settle()

    expect(results).toEqual([expect.objectContaining({ id: 'r1', outcome: 'refused' })])
    expect(callBlueprintRenderRA).not.toHaveBeenCalled()
    stop()
  })

  it('LINTS first: a dirty chart sends nothing, is disarmed, and the problems ride the answer', async () => {
    const { gate, results, stop, store } = mount()
    store.set({ ...chart(), [CHART_YAML_PATH]: 'apiVersion: v2\nname: Not_A_Chart\n' }, 'blueprint')

    act(() => { emitDraftRenderRequest({ id: 'r2' }) })
    await settle()

    expect(callBlueprintRenderRA).not.toHaveBeenCalled()
    expect(gate.forget).toHaveBeenCalledTimes(1)
    expect(gate.recordPreview).not.toHaveBeenCalled()
    expect(results[0]).toMatchObject({ id: 'r2', outcome: 'refused' })
    expect(results[0].problems?.join(' ')).toMatch(/Not_A_Chart/)
    stop()
  })

  it('LINTS the chart identity at the version held NOW: a bump past the name\'s budget sends nothing', async () => {
    const { gate, results, stop, store } = mount()
    // Kind 42 fits at 0.1.0 (where Start accepted it) and not at 10.20.30 — the controller container would be 64.
    const name = `a${'b'.repeat(41)}`
    store.set({ ...chart(), [CHART_YAML_PATH]: `apiVersion: v2\nname: ${name}\nversion: 10.20.30\n` }, 'blueprint')

    act(() => { emitDraftRenderRequest({ id: 'r2b' }) })
    await settle()

    expect(callBlueprintRenderRA).not.toHaveBeenCalled()
    expect(gate.recordPreview).not.toHaveBeenCalled()
    expect(results[0]).toMatchObject({ id: 'r2b', outcome: 'refused' })
    expect(results[0].problems?.join(' ')).toMatch(/at version 10\.20\.30 the Kind .* at most 39 characters/)
    stop()
  })

  it('with no render transport, the chart stays HELD and disarmed, and the answer says why', async () => {
    const { gate, results, stop, store } = mount({ api: {}, params: {} } as unknown as Config)

    act(() => { emitChartStart({ files: chart(), id: 'r3' }) })
    await settle()

    expect(store.get()?.kind).toBe('blueprint')
    expect(gate.forget).toHaveBeenCalledWith('demo-chart')
    expect(gate.recordPreview).not.toHaveBeenCalled()
    expect(results).toEqual([{ id: 'r3', message: RENDER_NOT_CONFIGURED, outcome: 'unavailable' }])
    expect(callBlueprintRenderRA).not.toHaveBeenCalled()
    stop()
  })

  it('a render that FAILED disarms, keeps the chart, and carries the error in the payload', async () => {
    vi.mocked(callBlueprintRenderRA).mockResolvedValue({ error: 'template: configmap.yaml:3: unexpected EOF', objects: [] })
    const { gate, results, stop, store } = mount()
    store.set(chart(), 'blueprint')

    act(() => { emitDraftRenderRequest({ id: 'r4' }) })
    await settle()

    expect(store.get()?.kind).toBe('blueprint')
    expect(gate.forget).toHaveBeenCalledWith('demo-chart')
    expect(gate.recordPreview).not.toHaveBeenCalled()
    expect(results[0]).toMatchObject({ id: 'r4', outcome: 'failed' })
    expect(results[0].payload?.error).toMatch(/unexpected EOF/)
    expect(drawerOpens).toBe(0)
    stop()
  })

  it('an edit that lands while the render is on the wire makes it STALE — nothing is armed', async () => {
    let resolveRender: (value: HelmRenderResult) => void = () => undefined
    vi.mocked(callBlueprintRenderRA).mockReturnValue(new Promise((resolve) => { resolveRender = resolve }))
    const { gate, results, stop, store } = mount()
    store.set(chart(), 'blueprint')

    act(() => { emitDraftRenderRequest({ id: 'r5' }) })
    store.updateFile('values.yaml', 'enabled: false\n')
    resolveRender(RENDERED)
    await settle()

    expect(gate.recordPreview).not.toHaveBeenCalled()
    expect(results).toEqual([expect.objectContaining({ id: 'r5', outcome: 'stale' })])
    stop()
  })

  it('arms under the chart NAME the gate keys on — the name the publish evaluates', async () => {
    vi.mocked(callBlueprintRenderRA).mockResolvedValue(RENDERED)
    const { gate, stop, store } = mount()
    store.set(chart('orders-api'), 'blueprint')

    act(() => { emitDraftRenderRequest({ id: 'r6' }) })
    await settle()

    expect(gate.recordPreview).toHaveBeenCalledWith('orders-api')
    stop()
  })
})
