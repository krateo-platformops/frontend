// @vitest-environment jsdom
/**
 * `krateo.page.publish` measures the platform, not the person: it starts at the LAST human gate.
 *
 * WHY THIS FILE EXISTS. Between a person pressing Publish and the BuilderPublish claim being written
 * sit two human gates, both the provider's: the destination form ("Where should this page be
 * committed?") and the blast-radius confirm. The span used to start at the press, so every publish
 * carried however long a person read those two modals — the confirm alone can stay open for five
 * minutes — in a span whose SLO is two seconds (acmp#21). Nothing in the browser shows that; the
 * p95 just reads as a slow portal.
 *
 * So this drives the press through the REAL chain — BuilderHost, the publish buses, runPersonPublish,
 * applyResourceSet and runRestSet's gate — holding each gate open for HOLD_MS of fake time, and
 * asserts the span STARTS at the confirm and lasts only the write that followed it. Those are the
 * assertions that cannot pass with the span started anywhere earlier.
 *
 * THE CLOCK, BOTH HALVES OF IT. The SDK dates a span's start from `Date.now()` and measures its
 * duration on `performance.now()` — the `performance` object `@opentelemetry/core` captured at
 * import. Fake timers replace the global `performance` with a new object, which that captured
 * reference never sees, so faking it would leave durations on the real clock: a few milliseconds
 * whatever the span covered, and a duration assertion that passes for the wrong reason. So only
 * `Date` is faked, and the real object's `now` is pinned to it — one clock, read by both halves.
 *
 * The provider below mirrors AgentikoProvider's publish handler line for line (the same
 * `onConfirmed` → publish-confirmed bus), as BuilderHost.stub.test.tsx mirrors it, with the two
 * gates and the write each answered by the test when it chooses.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { SpanStatusCode, trace } from '@opentelemetry/api'
import { hrTimeToMilliseconds } from '@opentelemetry/core'
import { WebTracerProvider, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-web'
import { ATTR_HTTP_RESPONSE_STATUS_CODE, ATTR_HTTP_ROUTE } from '@opentelemetry/semantic-conventions'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import yaml from 'js-yaml'
import { useEffect, useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))
vi.mock('../../components/Agentiko/previewBridge', async (importOriginal) => ({
  ...await importOriginal<object>(),
  callBlueprintRenderRA: vi.fn(),
}))
vi.mock('../../components/Agentiko/builderPublishGvr', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveBuilderPublishGvr: () => Promise.resolve({
    apiVersion: 'builder.krateo.io/v1alpha1',
    gvr: { group: 'builder.krateo.io', resource: 'builderpublishes', version: 'v1alpha1' },
  }),
}))
/** The gates and the write, each answered by the test. Hoisted: the destination mock answers through it. */
const { confirm, destination, write } = vi.hoisted(() => {
  const gates: Record<'confirm' | 'destination', { answer?: (confirmed: boolean) => void }> & { write: { answer?: (status: number) => void } } = {
    confirm: {},
    destination: {},
    write: {},
  }
  return gates
})

// The destination form, held open until the test answers it. The answer is the form's own prefill
// (the real function, headless), or a cancel.
vi.mock('../../components/Agentiko/publishTargetForm', async (importOriginal) => {
  const actual = await importOriginal<typeof PublishTargetFormModule>()
  return {
    ...actual,
    askPublishDestination: vi.fn((...args: Parameters<typeof actual.askPublishDestination>) =>
      new Promise((resolve) => { destination.answer = (confirmed) => { resolve(confirmed ? actual.askPublishDestination(...args) : null) } })),
  }
})

import { applyResourceSet, type ApplyResourceSetProposal } from '../../components/Agentiko/applyResourceSet'
import { createBlueprintGate } from '../../components/Agentiko/blueprintGate'
import type { BuilderTargets } from '../../components/Agentiko/builderTargets'
import { draftHistory } from '../../components/Agentiko/draftHistory'
import { callBlueprintRenderRA } from '../../components/Agentiko/previewBridge'
import { emitPublishConfirmed, emitPublishResult, onPublishRequest } from '../../components/Agentiko/previewPublishRequest'
import { heldDraftIdentity } from '../../components/Agentiko/publishCompile'
import { runPersonPublish } from '../../components/Agentiko/publishDraft'
import { askPublishDestination } from '../../components/Agentiko/publishTargetForm'
import type * as PublishTargetFormModule from '../../components/Agentiko/publishTargetForm'
import { useBlueprintAuthoringBuses } from '../../components/Agentiko/useBlueprintAuthoringBuses'
import { createBroadcastingDraftStore, useDraftFileBuses } from '../../components/Agentiko/useDraftFileBuses'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'
import { ConfigContext } from '../../context/ConfigContext'
import { ThemeModeProvider } from '../../context/ThemeModeContext'
import { runRestSet, type RunRestSetContext } from '../../hooks/runRestSet'
import { ContractSpanProcessor, SPAN_NAMES } from '../../otel/spanContract'
import { installAntdShims, installScrollShim } from '../../pages/BlueprintBuilder/blueprintTestHarness'
import { swapBuildersForTest } from '../builderRegistry'
import { parseBuilder, type Builder } from '../builderSpec'

import { builderRoutes } from './builderRoutes'

const STUB_ROUTE = '/stub-builder/compose'
/** How long a person keeps EACH gate open: far beyond the 2 s SLO, so a leak cannot hide in it. */
const HOLD_MS = 45_000
/** How long the claim's write takes once confirmed — the part that IS the platform's. */
const WRITE_MS = 700

const stubBuilder = (): Builder => {
  const raw = yaml.load(readFileSync(join(__dirname, '..', 'fixtures', 'blueprint-builder.builder.yaml'), 'utf8')) as { spec: Record<string, unknown> }
  const parsed = parseBuilder({
    ...raw,
    metadata: { name: 'stub-builder' },
    spec: { ...raw.spec, label: 'Stub Builder', route: STUB_ROUTE, verbs: { allowed: ['chartPut', 'previewBlueprint', 'publishBlueprint'] } },
  })
  if (!parsed.ok) { throw new Error(`stub Builder refused: ${parsed.problems.join('; ')}`) }
  return parsed.builder
}

const TARGETS: BuilderTargets = {
  blueprint: { owner: 'stub-org', repo: '<chart>' },
  blueprintTemplate: { owner: 'krateo-blueprints', repo: 'builder-scaffold' },
  kog: { owner: '', repo: '' },
  kogTemplate: { owner: '', repo: '' },
  page: { owner: '', repo: '' },
  pageTemplate: { owner: '', repo: '' },
}

const CONFIG = {
  api: { AUTOPILOT_BLUEPRINT_BUILDER_REPO: 'stub-org/<chart>', AUTOPILOT_GIT_HOST: 'git.example.com', SNOWPLOW_API_BASE_URL: 'http://snowplow' },
  params: { FRONTEND_NAMESPACE: 'krateo-system' },
}

/** runRestSet's context: its confirm is the blast-radius dialog, held open until the test answers. */
const setContext = (): RunRestSetContext => ({
  apiBaseUrl: 'http://snowplow',
  confirm: () => new Promise<boolean>((resolve) => { confirm.answer = resolve }),
  getAccessToken: () => 'tok',
  invalidateQueries: () => Promise.resolve(),
  message: { destroy: vi.fn() } as unknown as RunRestSetContext['message'],
  notification: { error: vi.fn(), success: vi.fn() } as unknown as RunRestSetContext['notification'],
  provenanceEnabled: false,
  registerCleanup: vi.fn(),
  setLoading: vi.fn(),
})

/**
 * AgentikoProvider's publish handler, with its `apply` taken down to what the bridge runs for
 * `applyResourceSet`: the real kernel and the real set fabric, given the same `onConfirmed`.
 */
const Provider = () => {
  const [gate] = useState(() => createBlueprintGate())
  const [store] = useState(() => createBroadcastingDraftStore(gate))
  useDraftFileBuses(store, gate, heldDraftIdentity)
  useBlueprintAuthoringBuses(store, gate, CONFIG as never)
  useEffect(() => onPublishRequest(({ id, verb }) => {
    void (async () => {
      const answer = await runPersonPublish({
        apply: (ops) => applyResourceSet({ label: 'Publish', ops, verb: 'applyResourceSet' } satisfies ApplyResourceSetProposal, {
          handleActionSet: (writeOps) => runRestSet(writeOps, setContext(), { actor: 'human' }, { onConfirmed: () => emitPublishConfirmed({ id }) }),
        }),
        blueprintGate: gate,
        blueprintStore: store,
        builderTargets: TARGETS,
        config: CONFIG as never,
        origin: { prompt: null, sessionId: null },
        track: () => undefined,
      }, verb)
      emitPublishResult({ id, ...answer })
    })()
  }), [gate, store])
  return null
}

const mountAtRoute = () => render(
  <AntdApp>
    <ConfigContext.Provider value={{ config: CONFIG } as never}>
      <ThemeModeProvider>
        <MemoryRouter initialEntries={[STUB_ROUTE]}>
          <Provider />
          <Routes>
            {builderRoutes().map((route) => <Route element={route.element} key={route.path} path={route.path} />)}
          </Routes>
        </MemoryRouter>
      </ThemeModeProvider>
    </ConfigContext.Provider>
  </AntdApp>,
)

/** Let the provider's awaited work land (microtasks only: no timer is faked but `Date`). */
const settle = async () => {
  await act(() => Array.from({ length: 12 }).reduce<Promise<void>>((turn) => turn.then(() => Promise.resolve()), Promise.resolve()))
}

/** A person, waiting `ms` with a gate open. */
const wait = (ms: number) => { vi.advanceTimersByTime(ms) }

const publishButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /Publish/ })

let recorded: ReadableSpan[] = []
const recorder = (): SpanProcessor => ({
  forceFlush: () => Promise.resolve(),
  onEnd: (span) => { recorded.push(span) },
  onStart: () => undefined,
  shutdown: () => Promise.resolve(),
})
const publishes = (): ReadableSpan[] => recorded.filter(({ name }) => name === SPAN_NAMES.pagePublish)

/** The real `performance.now`, pinned to the fake `Date` for the case (see THE CLOCK). */
let pinnedNow: { mockRestore: () => void } | undefined

/** Start a chart (its first render arms the gate), then put the clock in the test's hands. */
const startChartAndTakeTheClock = async () => {
  mountAtRoute()
  act(() => { screen.getByRole('button', { name: 'Start a chart' }).click() })
  act(() => { fireEvent.change(screen.getByLabelText('Chart name'), { target: { value: 'orders-api' } }) })
  act(() => { within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' }).click() })
  await settle()
  expect(publishButton().disabled).toBe(false)

  // See THE CLOCK above: fake `Date`, and pin the SDK's captured `performance.now` to it.
  vi.useFakeTimers({ toFake: ['Date'] })
  const origin = performance.timeOrigin
  pinnedNow = vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - origin)
}

/** Each request that wrote the BuilderPublish claim. */
const claimWrites: string[] = []

/** The claim's write: held until the test answers it with `status`. */
const stubWrite = () => {
  claimWrites.length = 0
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    // Anything but the claim is not this test's subject: unreachable, as it is with no cluster.
    if (!String(url).includes('builderpublishes')) {
      return Promise.reject(new TypeError('fetch failed'))
    }
    claimWrites.push(String(url))
    return new Promise<Response>((resolve) => {
      write.answer = (status) => {
        resolve({ ok: status < 300, status, text: () => Promise.resolve(status < 300 ? '{}' : '{"message":"builderpublishes.builder.krateo.io is forbidden"}') } as unknown as Response)
      }
    })
  }))
}

/** Press Publish, hold the destination form `HOLD_MS`, then answer it. */
const pressAndHoldDestination = async (confirmed: boolean) => {
  act(() => { publishButton().click() })
  await settle()
  expect(vi.mocked(askPublishDestination)).toHaveBeenCalledTimes(1)
  wait(HOLD_MS)
  act(() => { destination.answer?.(confirmed) })
  await settle()
}

/** Hold the blast-radius confirm `HOLD_MS`, then answer it; returns when it was answered. */
const holdConfirm = async (confirmed: boolean): Promise<number> => {
  expect(confirm.answer).toBeDefined()
  wait(HOLD_MS)
  const answeredAt = Date.now()
  act(() => { confirm.answer?.(confirmed) })
  await settle()
  return answeredAt
}

const startMs = (span: ReadableSpan) => hrTimeToMilliseconds(span.startTime)
const durationMs = (span: ReadableSpan) => hrTimeToMilliseconds(span.duration)

let restore: () => void

beforeAll(() => {
  installScrollShim()
  restore = swapBuildersForTest([stubBuilder()])
})
afterAll(() => restore())
beforeEach(() => {
  recorded = []
  trace.disable()
  trace.setGlobalTracerProvider(new WebTracerProvider({ spanProcessors: [new ContractSpanProcessor(recorder(), 'https://portal.krateo.dev/content')] }))
  graphDouble.reset()
  draftHistory.clear()
  vi.mocked(askPublishDestination).mockClear()
  delete destination.answer
  delete confirm.answer
  delete write.answer
  vi.mocked(callBlueprintRenderRA).mockReset()
  vi.mocked(callBlueprintRenderRA).mockResolvedValue({ objects: [] })
  // Per case, because afterEach unstubs every global — the write's `fetch` and antd's matchMedia.
  installAntdShims()
  stubWrite()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  pinnedNow?.mockRestore()
  pinnedNow = undefined
  vi.unstubAllGlobals()
  trace.disable()
})

describe('krateo.page.publish starts at the final confirm, not at Publish', () => {
  it('excludes both gates: it starts when the confirm is answered and lasts only the write', async () => {
    await startChartAndTakeTheClock()
    const pressedAt = Date.now()

    await pressAndHoldDestination(true)
    // The destination is answered and the confirm is open: still no span — nothing is committed.
    expect(publishes()).toHaveLength(0)
    const confirmedAt = await holdConfirm(true)

    wait(WRITE_MS)
    act(() => { write.answer?.(201) })
    await settle()

    expect(screen.getByText('Published — the change request is open for review.')).toBeTruthy()
    expect(claimWrites).toHaveLength(1)
    const [span] = publishes()
    expect(publishes()).toHaveLength(1)
    // THE BOUNDARY: the confirm's answer, 2 × HOLD_MS after the press — not the press.
    expect(confirmedAt - pressedAt).toBe(2 * HOLD_MS)
    expect(startMs(span)).toBe(confirmedAt)
    // And so the duration is the write, with neither gate's dwell in it.
    expect(durationMs(span)).toBe(WRITE_MS)
    expect(durationMs(span)).toBeLessThan(HOLD_MS)
    // The attributes it always carried, and a success carries no ERROR.
    expect(span.attributes).toEqual({ [ATTR_HTTP_ROUTE]: STUB_ROUTE })
    expect(span.status.code).toBe(SpanStatusCode.UNSET)
  })

  it('a cancelled destination form records no span', async () => {
    await startChartAndTakeTheClock()

    await pressAndHoldDestination(false)

    expect(confirm.answer).toBeUndefined()
    expect(screen.getByText('publish cancelled — destination not confirmed')).toBeTruthy()
    expect(publishes()).toHaveLength(0)
  })

  it('a declined confirm records no span', async () => {
    await startChartAndTakeTheClock()

    await pressAndHoldDestination(true)
    await holdConfirm(false)

    expect(claimWrites).toEqual([])
    expect(screen.getByText(/^Not published — nothing was written/)).toBeTruthy()
    expect(publishes()).toHaveLength(0)
  })

  it('a claim refused after the confirm still ends the span — with ERROR and no status code', async () => {
    await startChartAndTakeTheClock()

    await pressAndHoldDestination(true)
    const confirmedAt = await holdConfirm(true)
    wait(WRITE_MS)
    act(() => { write.answer?.(403) })
    await settle()

    expect(screen.getByText(/^Not published — the claim was refused: HTTP 403/)).toBeTruthy()
    const [span] = publishes()
    expect(publishes()).toHaveLength(1)
    expect(startMs(span)).toBe(confirmedAt)
    expect(durationMs(span)).toBe(WRITE_MS)
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.attributes[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBeUndefined()
    expect(span.attributes).toEqual({ [ATTR_HTTP_ROUTE]: STUB_ROUTE })
  })
})
