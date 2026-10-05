// @vitest-environment jsdom
/**
 * Review of #434 (frontend#405 round 2) — a controller PUBLISHED BEFORE the served version was pinned.
 *
 * The fixture is the live record draft-controller-admin-petstore on krateo-057: published, its lock
 * names the Pet RestDefinition's fields but no served version, its document says info.version 1.0.27,
 * and the CRD oasgen generated serves v1-0-27. What these pin:
 *   1. it is NOT pinned to v1alpha1 on Resume — its lock is completed from the held document (1.0.27),
 *      the lint holds it there, and the inspector says what it serves; only never-published
 *      controllers are pinned;
 *   2. resuming it writes nothing (the record is not dirtied); an UNPUBLISHED old record is pinned and
 *      the Resume says "Updated to the current format";
 *   3. re-picking an id verb of a published Kind keeps its binding and touches no locked list;
 *   4. (second review) a published record with NO lock at all is completed too; the held document is
 *      trusted only while it is the tree that rendered — otherwise the version is unknown and Publish
 *      is refused until a Preview; and a published document is held to its locked version.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, render } from '@testing-library/react'
import { load } from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { draftKindPlugin } from '../../builders/draftKinds'
import type { SetDispatchOptions, WriteOpResult } from '../../hooks/runRestSet'
import {
  askedOnCreateNotes,
  completeLockedSnapshot,
  lintControllerDraft,
  lockedSnapshot,
  oasConfigMapPath,
  planSetVerb,
  readController,
  restDefinitionPath,
  type LockedSnapshot,
} from '../../pages/ControllerComposer/controllerChart'
import { servedAsText } from '../../pages/ControllerComposer/servedVersion'
import type { WriteOp } from '../BlastRadius/buildBlastRadius'

import { createBlueprintDraftStore } from './blueprintDraftStore'
import { createBlueprintGate } from './blueprintGate'
import type { SandboxWriter } from './blueprintRenderSandbox'
import type { DraftRecordBody } from './draftRecord'
import { draftSaveStatus } from './draftSaveStatus'
import { summarizeController } from './draftStructure'
import { emitDraftResume, onDraftResumeResult, type DraftResumeResultDetail } from './previewDraftResume'
import { publishedLocks } from './publishedLocks'
import { createDraftAutosave, DRAFT_AUTOSAVE_DEBOUNCE_MS } from './useDraftAutosave'
import { useDraftResumeBus } from './useDraftResumeBus'

const FIXTURE = join(__dirname, '..', '..', 'pages', 'ControllerComposer', '__fixtures__', 'draft-controller-admin-petstore.record.json')
const live = (): DraftRecordBody => {
  const { _comment: _ignored, ...body } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as DraftRecordBody & { _comment: string }
  return body
}
const CONFIGMAP = oasConfigMapPath('petstore')
const PET = restDefinitionPath('Pet')

/** A writer that records every write and answers OK. */
const writerFake = () => {
  const calls: string[] = []
  const writer: SandboxWriter = {
    handleActionSet: vi.fn((ops: readonly WriteOp[], _options?: SetDispatchOptions): Promise<WriteOpResult[] | null> => {
      calls.push(`${ops[0].verb} ${ops[0].path}`)
      return Promise.resolve([{ index: 0, message: 'OK', ok: true, status: ops[0].verb === 'POST' ? 201 : 200 }])
    }),
    sandboxNamespace: 'krateo-preview',
  }
  return { calls, writer }
}

const Host = ({ autosave, store }: { autosave: ReturnType<typeof createDraftAutosave>; store: ReturnType<typeof createBlueprintDraftStore> }) => {
  useDraftResumeBus(store, createBlueprintGate(), { autosave })
  return null
}

/** The provider's resume path, with the real autosave and store: what a Resume answers, and every write. */
const resumeLive = async (record: DraftRecordBody) => {
  const autosave = createDraftAutosave({ now: () => new Date('2026-10-01T12:00:00Z'), username: () => 'admin' })
  const store = createBlueprintDraftStore(autosave.onHeldChange)
  const { calls, writer } = writerFake()
  autosave.setWriter(writer)
  render(<Host autosave={autosave} store={store} />)
  const results: DraftResumeResultDetail[] = []
  const stop = onDraftResumeResult((result) => { results.push(result) })
  act(() => { emitDraftResume({ id: 'r1', record }) })
  await vi.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS * 2)
  stop()
  return { autosave, calls, results, store }
}

const versionOf = (files: Record<string, string>): string | null => readController(files).servedVersion

beforeEach(() => {
  vi.useFakeTimers()
  draftSaveStatus.reset()
  publishedLocks.set(null)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  publishedLocks.set(null)
})

describe('1 — a controller published before pinning keeps the version it serves', () => {
  it('the live record is what this suite says it is: published, no served version locked, 1.0.27', () => {
    const record = live()
    expect(record.state).toBe('published')
    expect(Object.keys(record.publish?.locked ?? {})).toEqual([PET])
    expect(versionOf(record.files)).toBe('1.0.27')
  })

  it('its lock is completed from the held document — the version that was actually published', () => {
    const record = live()
    const completed = completeLockedSnapshot(record.publish?.locked as LockedSnapshot, record.files, true)
    expect(completed[CONFIGMAP]).toEqual({ servedVersion: '1.0.27' })
    expect(completed[PET]).toEqual(record.publish?.locked?.[PET])
    // A lock that already names one is left as it is.
    expect(completeLockedSnapshot(completed, record.files, true)).toBe(completed)
    expect(completeLockedSnapshot(completed, record.files, false)).toBe(completed)
  })

  it('Resume holds it UNPINNED, writes nothing, says nothing about a format update — and the lint passes', async () => {
    const record = live()
    const { calls, results, store } = await resumeLive(record)
    expect(results).toEqual([{ id: 'r1', outcome: 'resumed', previewed: true, relinked: false }])
    expect(store.get()?.files).toEqual(record.files)
    expect(versionOf(store.get()?.files ?? {})).toBe('1.0.27')
    expect(calls).toEqual([])
    const locked = publishedLocks.get()?.locked
    expect(locked?.[CONFIGMAP]).toEqual({ servedVersion: '1.0.27' })
    expect(lintControllerDraft(store.get()?.files ?? {}, locked)).toEqual([])
  })

  it('it is said as served: <group>/v1-0-27 (published before v1alpha1 pinning)', () => {
    const model = readController(live().files)
    expect(servedAsText(model.group, model.servedVersion, model.sourceVersion)).toBe('petstore.example.io/v1-0-27 (published before v1alpha1 pinning)')
  })

  it('a later edit never moves the version — the store puts it back, and a tree that moved it is refused by the lock', async () => {
    const record = live()
    const { store } = await resumeLive(record)
    const held = store.get()?.files ?? {}
    const edited = { ...held, [CONFIGMAP]: held[CONFIGMAP].replace('"version": "1.0.27"', '"version": "v1alpha1"') }
    store.updateFile(CONFIGMAP, edited[CONFIGMAP])
    expect(versionOf(store.get()?.files ?? {})).toBe('1.0.27')
    expect(lintControllerDraft(edited, publishedLocks.get()?.locked)).toContain(`cannot update the controller in place: the version its Kinds are served under is locked once published ("1.0.27" → "v1alpha1"). oasgen-provider would serve a new version and prune the published one, breaking every manifest written against it — set ${CONFIGMAP}'s info.version back to 1.0.27.`)
  })
})

describe('2 — Resume never dirties a draft silently', () => {
  it('an UNPUBLISHED record saved before pinning is pinned on Resume, and the Resume says so', async () => {
    const { publish: _publish, ...open } = live()
    const { calls, results, store } = await resumeLive({ ...open, renderedHash: undefined, state: 'open' })
    expect(versionOf(store.get()?.files ?? {})).toBe('v1alpha1')
    expect(results).toHaveLength(1)
    const [result] = results
    expect(result.outcome === 'resumed' && result.updated).toBe('Updated to the current format: the OpenAPI document is now held as info.version v1alpha1 (it said 1.0.27, kept on Chart.yaml), so its Kinds are served as v1alpha1. The draft saves this change; preview it again before publishing.')
    // Said, then saved: the record now holds the pinned tree.
    expect(calls).toEqual(['PUT /call?apiVersion=v1&resource=configmaps&name=draft-controller-admin-petstore&namespace=krateo-preview'])
  })
})

describe('3 — re-picking an id verb of a published Kind', () => {
  it('the live (spec-sourced) Pet: re-picking get keeps {petId} → spec.id and changes no locked list', () => {
    const { files, publish } = live()
    const locked = completeLockedSnapshot(publish?.locked as LockedSnapshot, files, true)
    const plan = planSetVerb(files, PET, 'get', { method: 'GET', path: '/pet/{petId}' }, locked)
    expect(plan.ok).toBe(true)
    const { resource } = (load(plan.ok ? plan.edit?.[PET] ?? '' : '') as { spec: { resource: Record<string, unknown> } }).spec
    expect((resource.verbsDescription as { action: string; fieldMapping?: unknown }[]).find((verb) => verb.action === 'get')?.fieldMapping)
      .toEqual([{ inCustomResource: 'spec.id', inPath: 'petId' }])
    expect(resource.excludedSpecFields).toBeUndefined()
    expect(resource.additionalStatusFields).toBeUndefined()
  })

  it('a Kind published WITH a status binding: re-picking delete is not refused as an excludedSpecFields change', () => {
    const { files } = live()
    const pinned = { ...files }
    // Published with {petId} read from status.id but id still in spec — the settle an unpublished
    // draft gets would add id to the LOCKED excludedSpecFields, and the re-pick was refused for it.
    pinned[PET] = files[PET].split('inCustomResource: spec.id').join('inCustomResource: status.id')
    const locked = lockedSnapshot(pinned)
    const plan = planSetVerb(pinned, PET, 'delete', { method: 'DELETE', path: '/pet/{petId}' }, locked)
    expect(plan).toMatchObject({ ok: true })
    const { resource } = (load(plan.ok ? plan.edit?.[PET] ?? '' : '') as { spec: { resource: Record<string, unknown> } }).spec
    expect(resource.excludedSpecFields).toBeUndefined()
  })
})

describe('5 — a path parameter read from status, on a Kind published before it was excluded', () => {
  const SENTENCE = 'petId is asked for on create because this controller was published before it was excluded; excluding it needs the RestDefinition recreated.'

  it('the live (spec-sourced) Pet: Resume leaves the record as it is, and there is no note', async () => {
    const record = live()
    const { calls, store } = await resumeLive(record)
    expect(store.get()?.files).toEqual(record.files)
    expect(calls).toEqual([])
    expect(askedOnCreateNotes(readController(record.files).kinds[0], true, readController(record.files).spec?.oas.doc)).toEqual([])
    expect(summarizeController(store.get())?.kinds[0].notes).toBeUndefined()
  })

  it('published with {petId} read from status.id: Resume changes nothing, and the inspector and the agent are told why petId is asked for', async () => {
    const record = live()
    const files = { ...record.files, [PET]: record.files[PET].split('inCustomResource: spec.id').join('inCustomResource: status.id') }
    const { calls, store } = await resumeLive({ ...record, files, publish: { ...record.publish, locked: lockedSnapshot(files) } as DraftRecordBody['publish'] })
    expect(store.get()?.files[PET]).toBe(files[PET])
    expect(calls).toEqual([])
    const { resource } = (load(store.get()?.files[PET] ?? '') as { spec: { resource: Record<string, unknown> } }).spec
    expect(resource.excludedSpecFields).toBeUndefined()
    expect(askedOnCreateNotes(readController(files).kinds[0], true, readController(files).spec?.oas.doc)).toEqual([SENTENCE])
    expect(summarizeController(store.get())?.kinds[0]).toMatchObject({ notes: [SENTENCE], published: true })
  })
})

describe('4 — second review: the state decides, the rendered tree is trusted, the lock is held', () => {
  const bumped = (files: Record<string, string>, version: string): Record<string, string> =>
    ({ ...files, [CONFIGMAP]: files[CONFIGMAP].replace('"version": "1.0.27"', `"version": "${version}"`) })

  it('a PUBLISHED record saved before locks were kept (no publish.locked) is completed, not pinned', async () => {
    const record = live()
    const { calls, store } = await resumeLive({ ...record, publish: { repo: record.publish?.repo ?? '' } })
    expect(versionOf(store.get()?.files ?? {})).toBe('1.0.27')
    expect(publishedLocks.get()?.locked).toEqual({ [CONFIGMAP]: { servedVersion: '1.0.27' } })
    expect(calls).toEqual([])
  })

  it('a record whose ConfigMap changed since it rendered: no guess — unpinned, Preview allowed, Publish refused, a Preview completes it', async () => {
    const record = live()
    const { autosave, store } = await resumeLive({ ...record, files: bumped(record.files, '1.0.28') })
    // Held as it was saved, its version neither guessed (1.0.28) nor pinned (v1alpha1).
    expect(versionOf(store.get()?.files ?? {})).toBe('1.0.28')
    const locked = publishedLocks.get()?.locked ?? null
    expect(locked?.[CONFIGMAP]).toEqual({ servedVersionUnknown: true })
    // The lint passes, so Preview can run; Publish says why not.
    expect(lintControllerDraft(store.get()?.files ?? {}, locked)).toEqual([])
    expect(draftKindPlugin('controller').publishProblems?.(store.get()?.files ?? {}, locked)).toEqual([
      `${CONFIGMAP}: the served version is unknown — this controller was published before its version was pinned, and the document changed since it rendered. Set its info.version to the version the cluster serves (see the published CRD) and preview again.`,
    ])
    // The person sets the version the cluster serves; the store leaves it as typed; a Preview locks it.
    store.updateFile(CONFIGMAP, bumped(record.files, '1.0.27')[CONFIGMAP])
    expect(versionOf(store.get()?.files ?? {})).toBe('1.0.27')
    await act(async () => { await autosave.markRendered(store.get()) })
    expect(publishedLocks.get()?.locked[CONFIGMAP]).toEqual({ servedVersion: '1.0.27' })
    expect(draftKindPlugin('controller').publishProblems?.(store.get()?.files ?? {}, publishedLocks.get()?.locked ?? null)).toEqual([])
  })

  it('a published document is HELD to its locked version: a re-import or a hand edit is put back', async () => {
    const record = live()
    const { store } = await resumeLive(record)
    store.updateFile(CONFIGMAP, bumped(record.files, '1.0.28')[CONFIGMAP])
    expect(versionOf(store.get()?.files ?? {})).toBe('1.0.27')
    expect(store.set(bumped(record.files, 'v1alpha1'), 'controller').ok).toBe(true)
    expect(versionOf(store.get()?.files ?? {})).toBe('1.0.27')
    // Held to a pre-pinning version: no v1alpha1 comment, nothing recorded on Chart.yaml.
    expect(store.get()?.files[CONFIGMAP].startsWith('#')).toBe(false)
    expect(store.get()?.files['Chart.yaml']).toBe(record.files['Chart.yaml'])
  })
})
