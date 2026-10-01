/**
 * Review of #428 — the guards that are not the kernel's: reading a spec from a URL (item 5), and what a
 * publish LOCKS reaching the composer through the draft record (item 6).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBlueprintDraftStore } from '../../components/Autopilot/blueprintDraftStore'
import type { SandboxWriter } from '../../components/Autopilot/blueprintRenderSandbox'
import { DRAFT_RECORD_KEY, readDraftRecord, type DraftRecordBody } from '../../components/Autopilot/draftRecord'
import { lintHeldDraft } from '../../components/Autopilot/proposedChart'
import { lockedFor, publishedLocks } from '../../components/Autopilot/publishedLocks'
import { createDraftAutosave } from '../../components/Autopilot/useDraftAutosave'

import { controllerCompositionDefinition, planPlaceGroup, restDefinitionPath, type ControllerPlan } from './controllerChart'
import { readSpecUrl, SPEC_TEXT_MAX_BYTES, startController } from './controllerStart'

const PETSTORE = readFileSync(join(__dirname, '__fixtures__', 'petstore-v3.openapi.json'), 'utf8')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  publishedLocks.set(null)
})

describe('item 5 — a spec read from a URL', () => {
  const answer = (body: string, headers: Record<string, string> = {}, status = 200) =>
    vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ headers: new Headers(headers), ok: status < 300, status, text: () => Promise.resolve(body) }))

  it('is fetched with no credentials, and a signal to abandon it', async () => {
    const fetchMock = answer(PETSTORE)
    vi.stubGlobal('fetch', fetchMock)
    expect(await readSpecUrl('https://specs.example/petstore.json')).toEqual({ text: PETSTORE })
    const [[, init]] = fetchMock.mock.calls
    expect(init?.credentials).toBe('omit')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('a declared Content-Length over the cap is refused before the body is read', async () => {
    const text = vi.fn(() => Promise.resolve('never read'))
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ headers: new Headers({ 'content-length': String(SPEC_TEXT_MAX_BYTES + 1) }), ok: true, status: 200, text })))
    expect(await readSpecUrl('https://specs.example/huge.json')).toEqual({ problem: 'The URL serves 9 MiB — over the 8 MiB this builder reads. Nothing more was downloaded.' })
    expect(text).not.toHaveBeenCalled()
  })

  it('a URL that does not answer is abandoned at the timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    const read = readSpecUrl('https://slow.example/spec.json')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await read).toEqual({ problem: 'The URL did not answer within 20 s — paste or upload the document instead.' })
  })
})

describe('item 6 — what a publish locked reaches the composer, and survives a resume', () => {
  const apply = (files: Record<string, string>, plan: ControllerPlan): Record<string, string> => {
    if (!plan.ok) { throw new Error(plan.reason) }
    return { ...files, ...(plan.add ?? {}), ...(plan.edit ?? {}) }
  }
  const petstore = (): Record<string, string> => {
    const started = startController({ apiGroup: 'petstore.example.io', baseUrl: 'https://petstore3.swagger.io/api/v3', name: 'petstore', paths: null, spec: PETSTORE })
    if (!started.ok) { throw new Error(JSON.stringify(started.problems)) }
    return apply(started.files, planPlaceGroup(started.files, 'store'))
  }
  const writer = (): { seen: Record<string, unknown>[]; writer: SandboxWriter } => {
    const seen: Record<string, unknown>[] = []
    return {
      seen,
      writer: {
        handleActionSet: (ops) => {
          ops.forEach((op) => seen.push(op.payload as Record<string, unknown>))
          return Promise.resolve(ops.map((_op, index) => ({ index, message: 'OK', ok: true, status: 201 })))
        },
        sandboxNamespace: 'krateo-preview',
      },
    }
  }

  it('a landed publish snapshots the locked fields onto the record and into publishedLocks; the lint then refuses a locked change', async () => {
    const autosave = createDraftAutosave({ now: () => new Date('2026-09-30T10:00:00Z'), username: () => 'diego' })
    const store = createBlueprintDraftStore(autosave.onHeldChange)
    const { seen, writer: sandbox } = writer()
    autosave.setWriter(sandbox)
    const files = petstore()
    store.set(files, 'controller')
    await autosave.markPublished(store.get()!, { target: { owner: 'krateo-platformops', repo: 'petstore' } }, null)
    const path = restDefinitionPath('Store')
    const record = readDraftRecord(seen.at(-1)) as DraftRecordBody
    expect(record.publish?.locked?.[path]).toMatchObject({ identifiers: ['id'], kind: 'Store', resourceGroup: 'petstore.example.io' })
    expect(lockedFor(publishedLocks.get(), 'controller', 'petstore')).toEqual(record.publish?.locked)
    // Another draft's name, or another kind: no lock applies.
    expect(lockedFor(publishedLocks.get(), 'controller', 'other')).toBeNull()
    const edited = { ...files, [path]: files[path].replace('kind: Store', 'kind: Order') }
    expect(lintHeldDraft(edited, 'controller').join('\n')).toMatch(/cannot update Store in place: kind is locked once published \("Store" → "Order"\)/)
    autosave.dispose()
  })

  it('a resumed published record restores the lock; an open one clears it', () => {
    const autosave = createDraftAutosave({ now: () => new Date(), username: () => 'diego' })
    const locked = { [restDefinitionPath('Store')]: { identifiers: ['orderId'], kind: 'Store', resourceGroup: 'petstore.example.io' } }
    const body: DraftRecordBody = { files: petstore(), kind: 'controller', name: 'petstore', publish: { locked, repo: 'krateo-platformops/petstore' }, state: 'published', updatedAt: '2026-09-30T10:00:00Z', version: 1 }
    // The record reads back with its lock (the ConfigMap round trip).
    expect(readDraftRecord({ data: { [DRAFT_RECORD_KEY]: JSON.stringify(body) } })?.publish?.locked).toEqual(locked)
    autosave.seedFromRecord(body)
    expect(publishedLocks.get()).toEqual({ kind: 'controller', locked, name: 'petstore' })
    autosave.seedFromRecord({ ...body, publish: undefined, state: 'open' })
    expect(publishedLocks.get()).toBeNull()
    autosave.dispose()
  })
})

describe('item 8 — the registration names the portal step', () => {
  it('says Register, then Install, in the Controller Builder (portal#275)', () => {
    const text = controllerCompositionDefinition('petstore', 'krateo-platformops', 'petstore', '0.1.0', {}) ?? ''
    expect(text).toContain('register it from the portal: Controller Builder -> your controllers')
    expect(text).toContain('-> Register; Install then creates a composition of it, which applies the RestDefinitions (portal#275).')
  })
})
