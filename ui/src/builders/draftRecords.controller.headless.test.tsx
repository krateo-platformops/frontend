// @vitest-environment jsdom
/**
 * GENERIC DRAFT RECORDS, HEADLESS: a CONTROLLER draft through the engine (T3, frontend#409).
 *
 * No composer is mounted — the Controller Builder's composer is T8's. The controller Builder is loaded
 * from its fixture like the other two, and a controller draft goes through the same engine code a
 * page or a blueprint does: the store, the autosave, the record, Resume. Every assertion is one of the
 * issue's acceptance lines:
 *   - `draft-controller-<owner>-<slug>` autosaves (within 63 characters, the tree hashed FNV-1a);
 *   - the write-ahead flush runs before render (the record lands before the render's first write);
 *   - Resume and Discard work (resume holds it as a controller and arms only on a matching hash; a
 *     record discarded from Your drafts reads as gone, and one discarded while held is stored again);
 *   - `draft-previewed` flips on Preview and clears on edit;
 *   - `state=published` after a publish lands;
 *   - the 512 KiB cap holds for a controller exactly as for the others;
 * and the publish verbs stay correct with a third Builder: publishRestDef is the Controller Builder's
 * because its Builder allows it — with no Builder allowing it, it publishes nothing.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHART_YAML_PATH, VALUES_SCHEMA_PATH } from '../components/Autopilot/blueprintDraft'
import { BLUEPRINT_DRAFT_MAX_BYTES, createBlueprintDraftStore, type BlueprintDraftStore } from '../components/Autopilot/blueprintDraftStore'
import { createBlueprintGate, type BlueprintGate } from '../components/Autopilot/blueprintGate'
import type { SandboxWriter } from '../components/Autopilot/blueprintRenderSandbox'
import {
  DRAFT_RECORD_KEY,
  draftRecordName,
  LABEL_KIND,
  LABEL_PREVIEWED,
  LABEL_STATE,
  readDraftRecord,
  treeHash,
  type DraftRecordBody,
} from '../components/Autopilot/draftRecord'
import { isDraftRecordName, readDraftRecordByName, restoredBannerCopy, wrongComposerMessage } from '../components/Autopilot/draftResume'
import { closeDraftCopy } from '../components/Autopilot/DraftSaveIndicator'
import { draftSaveStatus } from '../components/Autopilot/draftSaveStatus'
import { claimPreviewSurface, previewSurfaceClaimed } from '../components/Autopilot/previewDraftChanged'
import { emitDraftResume, onDraftReapply, onDraftResumeResult, type DraftResumeResultDetail } from '../components/Autopilot/previewDraftResume'
import { heldDraftIdentity } from '../components/Autopilot/publishCompile'
import { PUBLISH_VERBS, publisherOfVerb } from '../components/Autopilot/publishDraft'
import { createDraftAutosave, DRAFT_AUTOSAVE_DEBOUNCE_MS, draftRecordDisplayName } from '../components/Autopilot/useDraftAutosave'
import { heldDraftName, useDraftResumeBus } from '../components/Autopilot/useDraftResumeBus'
import type { WriteOp } from '../components/BlastRadius/buildBlastRadius'
import type { SetDispatchOptions, WriteOpResult } from '../hooks/runRestSet'

import { builderRegistry, swapBuildersForTest } from './builderRegistry'

const SANDBOX = 'krateo-preview'
const NOW = new Date('2026-09-30T09:15:00Z')

/** A controller chart as builder-scaffold seeds one: Chart.yaml, values, schema, one RestDefinition. */
const controller = (name = 'github-provider', extra = ''): Record<string, string> => ({
  [CHART_YAML_PATH]: `apiVersion: v2\nname: ${name}\nversion: 0.1.0\n`,
  [VALUES_SCHEMA_PATH]: JSON.stringify({ properties: { global: { type: 'object' } }, type: 'object' }),
  'templates/restdefinition-repo.yaml': 'apiVersion: ogen.krateo.io/v1alpha1\nkind: RestDefinition\nmetadata:\n  name: repo\n',
  'values.yaml': `{}\n${extra}`,
})

interface Seen { verb: WriteOp['verb']; name: string; payload: Record<string, unknown> | undefined }

const nameOf = (op: WriteOp): string =>
  ((op.payload as { metadata?: { name?: string } } | undefined)?.metadata?.name) ?? new URLSearchParams(op.path.split('?')[1]).get('name') ?? ''

/** One writer that sees every sandbox write in order — the record's and a render's alike. */
const writerFake = (answers: number[] = []) => {
  const seen: Seen[] = []
  const writer: SandboxWriter = {
    handleActionSet: (ops: readonly WriteOp[], _options?: SetDispatchOptions): Promise<WriteOpResult[] | null> => {
      ops.forEach((op) => seen.push({ name: nameOf(op), payload: op.payload as Record<string, unknown> | undefined, verb: op.verb }))
      return Promise.resolve(ops.map((op, index) => {
        const status = answers.shift() ?? (op.verb === 'POST' ? 201 : 200)
        return { index, message: status < 300 ? 'OK' : `refused ${status}`, ok: status < 300, status }
      }))
    },
    sandboxNamespace: SANDBOX,
  }
  return { seen, writer }
}

const setup = (answers?: number[]) => {
  const autosave = createDraftAutosave({ now: () => NOW, username: () => 'Diego.Braga' })
  const store = createBlueprintDraftStore(autosave.onHeldChange)
  const { seen, writer } = writerFake(answers)
  autosave.setWriter(writer)
  return { autosave, seen, store, writer }
}

const records = (seen: Seen[]) => seen.filter((write) => write.name.startsWith('draft-'))
const labelsOf = (write: Seen) => (write.payload?.metadata as { labels: Record<string, string> }).labels
const bodyOf = (write: Seen) => readDraftRecord(write.payload)

const elapse = async (ms = DRAFT_AUTOSAVE_DEBOUNCE_MS) => { await vi.advanceTimersByTimeAsync(ms) }

beforeEach(() => {
  vi.useFakeTimers()
  draftSaveStatus.reset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  cleanup()
})

describe('a controller draft is a draft record like any other', () => {
  it('the Controller Builder is loaded, and its drafts are named by their Chart.yaml', () => {
    expect(builderRegistry.get({ draftKind: 'controller' })?.metadata.name).toBe('controller-builder')
    expect(draftRecordDisplayName({ files: controller(), kind: 'controller' })).toBe('github-provider')
  })

  it('AUTOSAVES as draft-controller-<owner>-<slug>: one POST after the debounce, kind-labelled, open, not previewed', async () => {
    const { seen, store } = setup()
    expect(store.set(controller(), 'controller').ok).toBe(true)
    await elapse()
    const saved = records(seen)
    expect(saved).toHaveLength(1)
    expect(saved[0].verb).toBe('POST')
    expect(saved[0].name).toBe('draft-controller-diego-braga-github-provider')
    expect(labelsOf(saved[0])).toMatchObject({ [LABEL_KIND]: 'controller', [LABEL_PREVIEWED]: 'false', [LABEL_STATE]: 'open' })
    const body = bodyOf(saved[0])
    expect(body).toMatchObject({ kind: 'controller', name: 'github-provider', state: 'open' })
    expect(body?.files).toEqual(store.get()?.files)
    expect(draftSaveStatus.get()).toMatchObject({ kind: 'controller', phase: 'saved' })
  })

  it('the name fits 63 characters, never ends in "-", and the tree hash is the FNV-1a one', () => {
    const name = draftRecordName('controller', 'a-very-long-owner-name-from-the-identity-provider', 'an-extremely-long-controller-chart-name')
    expect(name.length).toBeLessThanOrEqual(63)
    expect(name.startsWith('draft-controller-')).toBe(true)
    expect(name.endsWith('-')).toBe(false)
    expect(isDraftRecordName(name)).toBe(true)
    // Keys sorted: the same tree built in another order hashes the same; 16 hex characters.
    const files = controller()
    const reversed = Object.fromEntries(Object.entries(files).reverse())
    expect(treeHash(reversed)).toBe(treeHash(files))
    expect(treeHash(files)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('WRITE-AHEAD: flush stores the record NOW, before the render\'s first write, and the timer is spent', async () => {
    const { autosave, seen, store, writer } = setup()
    store.set(controller(), 'controller')
    store.updateFile('values.yaml', '{}\n# edited\n')
    // A Preview: flush first, then the render writes into the sandbox (T9 wires the controller render).
    await autosave.flush()
    await writer.handleActionSet([{ path: `/api/v1/namespaces/${SANDBOX}/configmaps`, payload: { metadata: { name: 'cb-preview-github-provider-x' } }, verb: 'POST' }])
    expect(seen.map((write) => write.name)).toEqual(['draft-controller-diego-braga-github-provider', 'cb-preview-github-provider-x'])
    expect(bodyOf(seen[0])?.files['values.yaml']).toBe('{}\n# edited\n')
    await elapse()
    expect(records(seen)).toHaveLength(1)
  })

  it('draft-previewed FLIPS on Preview and CLEARS on edit', async () => {
    const { autosave, seen, store } = setup()
    store.set(controller(), 'controller')
    await elapse()
    expect(labelsOf(records(seen)[0])[LABEL_PREVIEWED]).toBe('false')

    await autosave.markRendered(store.get())
    const previewed = records(seen).at(-1)!
    expect(previewed.verb).toBe('PUT')
    expect(labelsOf(previewed)[LABEL_PREVIEWED]).toBe('true')
    expect(bodyOf(previewed)?.renderedHash).toBe(treeHash(store.get()!.files))

    store.updateFile('values.yaml', '{}\nreplicas: 2\n')
    await elapse()
    const edited = records(seen).at(-1)!
    expect(labelsOf(edited)[LABEL_PREVIEWED]).toBe('false')
    // The hash of the tree Preview rendered is kept — it just no longer names the held tree.
    expect(bodyOf(edited)?.renderedHash).toBe(bodyOf(previewed)?.renderedHash)
  })

  it('state=published after a publish LANDS, with where it went', async () => {
    const { autosave, seen, store } = setup()
    store.set(controller(), 'controller')
    await autosave.flush()
    await autosave.markPublished(store.get()!, { target: { owner: 'krateo-controllers', repo: 'github-provider' } }, 'https://git.example.com/krateo-controllers/github-provider/pull/1')
    const published = records(seen).at(-1)!
    expect(labelsOf(published)[LABEL_STATE]).toBe('published')
    expect(bodyOf(published)).toMatchObject({
      publish: { prUrl: 'https://git.example.com/krateo-controllers/github-provider/pull/1', repo: 'krateo-controllers/github-provider' },
      state: 'published',
    })
  })

  it('the 512 KiB tree cap refuses a controller as it does every draft, and leaves the held tree alone', () => {
    const store = createBlueprintDraftStore()
    const big = 'x'.repeat(BLUEPRINT_DRAFT_MAX_BYTES)
    const refused = store.set(controller('github-provider', big), 'controller')
    expect(refused.ok).toBe(false)
    expect(store.get()).toBeNull()
    store.set(controller(), 'controller')
    const before = store.get()
    expect(store.updateFile('values.yaml', big).ok).toBe(false)
    expect(store.get()).toBe(before)
  })
})

describe('Resume and Discard, for a controller', () => {
  const record = (over: Partial<DraftRecordBody> = {}): DraftRecordBody => ({
    files: controller(),
    kind: 'controller',
    name: 'github-provider',
    state: 'open',
    updatedAt: '2026-09-30T09:00:00Z',
    version: 1,
    ...over,
  })
  const configMap = (body: unknown) => ({ apiVersion: 'v1', data: { [DRAFT_RECORD_KEY]: JSON.stringify(body) }, kind: 'ConfigMap', metadata: { name: 'draft-controller-diego-braga-github-provider' } })
  const answer = (status: number, json: unknown = {}) => vi.fn(() => Promise.resolve({ json: () => Promise.resolve(json), ok: status >= 200 && status < 300, status }))

  it('a controller record reads back; a kind no Builder declares does not', async () => {
    expect(readDraftRecord(configMap(record()))).toMatchObject({ kind: 'controller' })
    expect(readDraftRecord(configMap(record({ kind: 'workflow' as never })))).toBeNull()
    vi.stubGlobal('fetch', answer(200, configMap(record())))
    const read = await readDraftRecordByName('https://snowplow.test', SANDBOX, 'draft-controller-diego-braga-github-provider')
    expect(read).toMatchObject({ ok: true, record: { kind: 'controller', name: 'github-provider' } })
  })

  it('opened in another composer, it says where it resumes — by the Controller Builder\'s label', () => {
    expect(wrongComposerMessage(record())).toBe('github-provider is a controller draft — resume it from the Controller Builder, at /controller-builder/compose.')
    expect(restoredBannerCopy({ everPreviewed: false, kind: 'controller', previewed: false, relinked: false, updatedAt: NOW.toISOString() }, NOW).body)
      .toBe('The controller is exactly as you left it, and Undo starts here. It has not been previewed yet, so preview it before publishing.')
  })

  describe('the provider holding it (useDraftResumeBus)', () => {
    const Host = ({ gate, store }: { gate: BlueprintGate; store: BlueprintDraftStore }) => {
      useDraftResumeBus(store, gate, {})
      return null
    }
    let results: DraftResumeResultDetail[]
    let reapplies: number
    const stops: (() => void)[] = []
    beforeEach(() => {
      results = []
      reapplies = 0
      stops.push(onDraftResumeResult((detail) => { results.push(detail) }))
      stops.push(onDraftReapply(() => { reapplies += 1 }))
    })
    afterEach(() => { stops.splice(0).forEach((stop) => stop()) })

    const mount = () => {
      const store = createBlueprintDraftStore()
      const gate = createBlueprintGate()
      render(<Host gate={gate} store={store} />)
      return { gate, store }
    }

    it('RESUME holds it as a controller, arms Publish only on a matching hash, and re-applies nothing live', () => {
      const { gate, store } = mount()
      const files = controller()
      act(() => { emitDraftResume({ id: 'r1', record: record({ renderedHash: treeHash(files) }) }) })
      expect(store.get()).toMatchObject({ files, kind: 'controller' })
      expect(results).toEqual([{ id: 'r1', outcome: 'resumed', previewed: true, relinked: false }])
      expect(gate.isArmed(heldDraftIdentity(store.get()))).toBe(true)
      // A controller previews by a render: there is no sandbox preview to rebuild.
      expect(reapplies).toBe(0)
    })

    it('with a controller open, a resume answers `held`, naming it', () => {
      const { store } = mount()
      store.set(controller('gitlab-provider'), 'controller')
      expect(heldDraftName(store.get()!)).toBe('gitlab-provider')
      act(() => { emitDraftResume({ id: 'r2', record: record() }) })
      expect(results).toEqual([{ held: { kind: 'controller', name: 'gitlab-provider', previewed: false }, id: 'r2', outcome: 'held' }])
    })
  })

  it('DISCARDED from Your drafts: resuming it says it is gone; discarded while held, the autosave stores it again', async () => {
    vi.stubGlobal('fetch', answer(404))
    const read = await readDraftRecordByName('https://snowplow.test', SANDBOX, 'draft-controller-diego-braga-github-provider')
    expect(read).toEqual({ message: 'The draft draft-controller-diego-braga-github-provider is not in your drafts any more — it was discarded, or it was never saved.', ok: false })

    // Held in this tab while the list's Discard deleted it: the next PUT answers 404, and it is created again.
    const { seen, store } = setup([201, 404, 201])
    store.set(controller(), 'controller')
    await elapse()
    store.updateFile('values.yaml', '{}\n# after discard\n')
    await elapse()
    expect(records(seen).map((write) => write.verb)).toEqual(['POST', 'PUT', 'POST'])
    expect(draftSaveStatus.get()).toMatchObject({ kind: 'controller', phase: 'saved' })
  })

  it('the Close confirm names a controller, and says only its preview goes', () => {
    expect(closeDraftCopy('controller')).toEqual({
      kept: 'Close this controller draft? It stays saved in your drafts; only its preview is removed.',
      lost: 'Discard this controller draft? Its unpublished files are deleted.',
    })
    // Unchanged for the other two.
    expect(closeDraftCopy('blueprint').kept).toBe('Close this chart draft? It stays saved in your drafts; only its preview is removed.')
    expect(closeDraftCopy('page').kept).toBe('Close this draft? It stays saved in your drafts; only its sandbox preview is removed.')
  })

  it('a composer claims the preview surface for controllers, by kind, like the others', () => {
    expect(previewSurfaceClaimed('controller')).toBe(false)
    const release = claimPreviewSurface('controller')
    expect(previewSurfaceClaimed('controller')).toBe(true)
    expect(previewSurfaceClaimed('blueprint')).toBe(false)
    release()
    expect(previewSurfaceClaimed('controller')).toBe(false)
  })
})

describe('publish verbs with a third Builder', () => {
  it('publishRestDef is the Controller Builder\'s; page and blueprint verbs are unchanged', () => {
    expect(publisherOfVerb('publishRestDef')).toBe('controller')
    expect(publisherOfVerb('publishPage')).toBe('page')
    expect(publisherOfVerb('publishBlueprint')).toBe('blueprint')
    expect(publisherOfVerb('previewRestDef')).toBeNull()
    expect(PUBLISH_VERBS.has('previewRestDef')).toBe(false)
  })

  it('with no Builder allowing it, publishRestDef publishes NOTHING — there is no undeclared fallback any more', () => {
    const portal = builderRegistry.get({ name: 'portal-builder' })!
    const blueprint = builderRegistry.get({ name: 'blueprint-builder' })!
    const restore = swapBuildersForTest([portal, blueprint])
    try {
      expect(publisherOfVerb('publishRestDef')).toBeNull()
      expect(publisherOfVerb('publishPage')).toBe('page')
    } finally {
      restore()
    }
  })

  it('a second Builder allowing publishRestDef makes it nobody\'s — load order never decides', () => {
    const controllerBuilder = builderRegistry.get({ name: 'controller-builder' })!
    const twin = { ...controllerBuilder, metadata: { name: 'twin-controller-builder' }, spec: { ...controllerBuilder.spec, draftKind: 'twin', route: '/twin/compose' } }
    const restore = swapBuildersForTest([controllerBuilder, twin])
    try {
      expect(publisherOfVerb('publishRestDef')).toBeNull()
    } finally {
      restore()
    }
  })
})
