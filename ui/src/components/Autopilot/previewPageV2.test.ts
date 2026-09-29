/**
 * W4 previewPage v2 (FE-P4) — the sandbox live-preview orchestrator. Pure-logic
 * coverage with the drawer mocked at the previewBus seam (the previewHandlers.test
 * convention). Proves the A.2 contract:
 *   - a malformed proposal is denied (null) with ZERO dispatch — exactly like v1;
 *   - validation failure → the SOURCE drawer with verdicts + a blocked chip, and
 *     NOTHING is applied (garbage never reaches the sandbox);
 *   - the happy path: ONE silent, confirm-skipped (sandbox-confined) POST set →
 *     the drawer opens on the ROOT draft's REAL widgetEndpoint with the rewritten
 *     source alongside → a mutating chip;
 *   - drawer close → best-effort DELETE teardown of the applied drafts, ONCE, and
 *     a STALE close (payload superseded by a fresh preview) is a no-op;
 *   - a fresh preview UPDATES the drafts it keeps in place (never deletes one), creates the new
 *     ones, and deletes only the names that left the set — after the rest landed;
 *   - apply failure → applied drafts rolled back (best-effort), the failure shown
 *     AS drawer content, a graceful chip — never a crash;
 *   - OWNER-SCOPED names: every sandbox name carries the caller's owner tag, so two people
 *     previewing the same page never overwrite, adopt or tear down each other's objects — and the
 *     rename never reaches the drawer's files or the held draft a publish writes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WriteOp, WriteOpResult } from '../../hooks/runRestSet'

import type { PortalActionProposal } from './actionBridge'
import { createBlueprintDraftStore } from './blueprintDraftStore'
import { resetKindCacheForTests } from './kindResolver'
import { openAutopilotPreview } from './previewBus'
import type { AutopilotPreviewPayload } from './previewBus'
import { applyPreviewPageV2, mergePatchOf, type PreviewPageV2Deps } from './previewPageV2'
import { createPreviewPageSession, ownerTagOf, primeDraftKinds, sandboxDraftName, WIDGETS_API_VERSION } from './previewSandbox'
import { recordPagePreview } from './publishCompile'

vi.mock('./previewBus', () => ({ openAutopilotPreview: vi.fn(), setPreviewProblems: vi.fn() }))

const openPreviewMock = vi.mocked(openAutopilotPreview)

const SANDBOX = 'krateo-preview'

/**
 * Who is logged in. The owner is read from the login payload (getUserInfo → `K_user`), and these
 * tests run without a DOM, so localStorage is a stub whose user each test can switch.
 */
const storage = new Map<string, string>()
const loginAs = (username: string): void => {
  storage.set('K_user', JSON.stringify({ user: { username } }))
}
/** The sandbox name of a draft previewed by alice — the default login below. */
const scoped = (name: string, owner = 'alice'): string => sandboxDraftName(name, owner)
const nameParam = (op: WriteOp): string | null => new URL(op.path, 'https://x').searchParams.get('name')

const flexRoot = (): Record<string, unknown> => ({
  kind: 'Flex',
  metadata: { name: 'page-preview-draft', namespace: 'krateo-system' },
  spec: {
    resourcesRefs: {
      items: [{ allowed: true, apiVersion: WIDGETS_API_VERSION, id: 'p1', name: 'preview-draft-title', namespace: 'krateo-system', resource: 'paragraphs', verb: 'GET' }],
    },
    widgetData: { allowedResources: ['paragraphs'], items: [{ resourceRefId: 'p1' }] },
  },
})

const paragraph = (): Record<string, unknown> => ({
  kind: 'Paragraph',
  metadata: { name: 'preview-draft-title' },
  spec: { widgetData: { text: 'Draft paragraph' } },
})

const proposalOf = (widgets: unknown[], label?: string): PortalActionProposal =>
  ({ verb: 'previewPage', widgets, ...(label ? { label } : {}) })

/** Deps with an all-OK dispatcher (per-op results mirror the ops passed). */
const makeDeps = (results?: (ops: readonly WriteOp[]) => WriteOpResult[] | null): { deps: PreviewPageV2Deps; handleActionSet: ReturnType<typeof vi.fn> } => {
  const handleActionSet = vi.fn((ops: readonly WriteOp[]): Promise<WriteOpResult[] | null> =>
    Promise.resolve(results ? results(ops) : ops.map((_, index) => ({ index, message: 'OK', ok: true, status: 201 }))))

  return {
    deps: { handleActionSet, sandboxNamespace: SANDBOX, session: createPreviewPageSession(), sessionId: 's_test' },
    handleActionSet,
  }
}

const openedPayload = (call = 0): AutopilotPreviewPayload => openPreviewMock.mock.calls[call][0]

const SNOWPLOW = 'http://snowplow.test'

/**
 * snowplow's discovery-backed plural resolver, stubbed.
 *
 * Every test here needs it because previewPage resolves kinds before it applies anything — which is
 * the point of the change that introduced this: the plural comes from the API server, so a test
 * that supplies no discovery source is a test of a preview that cannot resolve any widget kind.
 */
const PLURALS: Record<string, string> = {
  Card: 'cards', Flex: 'flexes', PageHeader: 'pageheaders', Paragraph: 'paragraphs', Table: 'tables',
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetKindCacheForTests()
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => { storage.delete(key) },
    setItem: (key: string, value: string) => { storage.set(key, value) },
  })
  loginAs('alice')
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const kind = new URL(url).searchParams.get('kind') ?? ''
    const plural = PLURALS[kind]
    return Promise.resolve(plural
      ? { json: () => Promise.resolve({ plural }), ok: true, status: 200 }
      : { json: () => Promise.resolve({}), ok: false, status: 404 })
  }))
  // Prime here rather than via deps.snowplowBaseUrl: the cache is module-scoped, so the kinds are
  // resolved for the call under test WITHOUT arming awaitSandboxWarmup, which these tests do not
  // exercise and which polls for ~21s once a base URL is present.
  await primeDraftKinds(Object.keys(PLURALS).map((kind) => ({ kind })), SNOWPLOW)
})

describe('previewPage v2 — deny + validation gates (nothing applied)', () => {
  it('a malformed proposal (no widgets / kind-less entry) is denied: null, no dispatch, no drawer', async () => {
    const { deps, handleActionSet } = makeDeps()
    expect(await applyPreviewPageV2(proposalOf([]), deps)).toBeNull()
    expect(await applyPreviewPageV2({ verb: 'previewPage' }, deps)).toBeNull()
    expect(await applyPreviewPageV2(proposalOf([{ metadata: { name: 'x' } }]), deps)).toBeNull()
    expect(handleActionSet).not.toHaveBeenCalled()
    expect(openPreviewMock).not.toHaveBeenCalled()
  })

  it('validation failure → SOURCE drawer with the verdicts + blocked chip; ZERO dispatch', async () => {
    const { deps, handleActionSet } = makeDeps()
    const invalid = { kind: 'Paragraph', metadata: { name: 'p' }, spec: { widgetData: {} } }

    const chip = await applyPreviewPageV2(proposalOf([invalid]), deps)

    expect(handleActionSet).not.toHaveBeenCalled()
    expect(chip).toEqual({ label: 'preview blocked — 1 validation error', readOnly: true, verb: 'previewPage' })
    const payload = openedPayload()
    expect(payload.problems?.length).toBeGreaterThan(0)
    expect(payload.liveEndpoint).toBeUndefined()
    expect(payload.objects).toHaveLength(1)
  })

  it('a set with NO widget root (only RESTActions) → blocked chip, ZERO dispatch', async () => {
    const { deps, handleActionSet } = makeDeps()
    const ra = { kind: 'RESTAction', metadata: { name: 'preview-projects' }, spec: { api: [] } }

    const chip = await applyPreviewPageV2(proposalOf([ra]), deps)

    expect(handleActionSet).not.toHaveBeenCalled()
    expect(chip?.label).toBe('preview blocked — no page-<slug> root Flex (the page entry) in the draft set')
    expect(openedPayload().liveEndpoint).toBeUndefined()
  })
})

const verbsOf = (handleActionSet: ReturnType<typeof vi.fn>): string[] =>
  handleActionSet.mock.calls.flatMap(([ops]) => (ops as WriteOp[]).map((op) => op.verb))
const opsOf = (handleActionSet: ReturnType<typeof vi.fn>): WriteOp[] =>
  handleActionSet.mock.calls.flatMap(([ops]) => ops as WriteOp[])

/** The root with a second child listed — what a drop into the page looks like. */
const flexRootWith = (...names: string[]): Record<string, unknown> => ({
  kind: 'Flex',
  metadata: { name: 'page-preview-draft', namespace: 'krateo-system' },
  spec: {
    resourcesRefs: {
      items: names.map((name, index) => ({ allowed: true, apiVersion: WIDGETS_API_VERSION, id: `p${index}`, name, namespace: 'krateo-system', resource: 'paragraphs', verb: 'GET' })),
    },
    widgetData: { allowedResources: ['paragraphs'], items: names.map((_, index) => ({ resourceRefId: `p${index}` })) },
  },
})
const paragraphNamed = (name: string, text = 'Draft paragraph'): Record<string, unknown> => ({
  kind: 'Paragraph',
  metadata: { name },
  spec: { widgetData: { text } },
})

describe('previewPage v2 — the happy path (apply → live drawer → teardown on close)', () => {
  it('a FIRST preview creates every draft — one silent, sandbox-confined POST set, nothing deleted', async () => {
    const { deps, handleActionSet } = makeDeps()

    const chip = await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    expect(handleActionSet).toHaveBeenCalledTimes(1)
    const [ops, options] = handleActionSet.mock.calls[0] as [WriteOp[], unknown]
    expect(options).toEqual({ silent: true, skipConfirmForSandbox: SANDBOX })
    expect(ops.map((op) => op.verb)).toEqual(['POST', 'POST'])
    expect(ops[0].path).toContain('resource=flexes')
    expect(ops[0].path).toContain(`namespace=${SANDBOX}`)
    // The POSTed payloads are the REWRITTEN drafts (sandbox namespace + preview labels).
    const posted = ops[0].payload as { metadata: { namespace: string; labels: Record<string, string> } }
    expect(posted.metadata.namespace).toBe(SANDBOX)
    expect(posted.metadata.labels['krateo.io/purpose']).toBe('preview-draft')
    expect(posted.metadata.labels['krateo.io/preview-session']).toBe('s_test')
    expect(posted.metadata.labels['krateo.io/draft-owner']).toBe('alice')

    // The drawer renders the ROOT draft's REAL served endpoint + the rewritten source.
    const payload = openedPayload()
    expect(payload.liveEndpoint).toBe(
      `/call?resource=flexes&apiVersion=widgets.templates.krateo.io/v1beta1&name=${scoped('page-preview-draft')}&namespace=${SANDBOX}`,
    )
    expect(payload.title).toContain('Page preview (live)')
    expect(payload.objects).toHaveLength(2)
    expect(typeof payload.onClose).toBe('function')

    // The chip is honest about the mutation (sandbox writes happened).
    expect(chip).toEqual({ label: `live preview — 2 drafts → ${SANDBOX}`, readOnly: false, verb: 'previewPage' })
  })

  it('drawer close → best-effort DELETE teardown ONCE (a second close is a no-op)', async () => {
    const { deps, handleActionSet } = makeDeps()
    await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)
    const payload = openedPayload()

    payload.onClose?.()

    // apply + teardown
    expect(handleActionSet).toHaveBeenCalledTimes(2)
    const [teardown, options] = handleActionSet.mock.calls[1] as [WriteOp[], unknown]
    expect(teardown.map((op) => op.verb)).toEqual(['DELETE', 'DELETE'])
    expect(teardown.map(nameParam)).toEqual([scoped('page-preview-draft'), scoped('preview-draft-title')])
    expect(options).toEqual({ silent: true, skipConfirmForSandbox: SANDBOX })

    payload.onClose?.()
    expect(handleActionSet).toHaveBeenCalledTimes(2)
  })

  it('a FRESH preview updates the previous drafts in place; the STALE drawer-close is a no-op', async () => {
    const { deps, handleActionSet } = makeDeps()
    await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)
    const stalePayload = openedPayload()

    await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    expect(handleActionSet).toHaveBeenCalledTimes(2)
    const [second] = handleActionSet.mock.calls[1] as [WriteOp[]]
    expect(second.map((op) => op.verb)).toEqual(['PATCH', 'PATCH'])

    // The stale drawer's close must NOT delete the fresh preview's drafts.
    stalePayload.onClose?.()
    expect(handleActionSet).toHaveBeenCalledTimes(2)

    // The fresh drawer's close does — and the preview after it creates again.
    openedPayload(1).onClose?.()
    expect(handleActionSet).toHaveBeenCalledTimes(3)
    await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)
    const [afterClose] = handleActionSet.mock.calls[3] as [WriteOp[]]
    expect(afterClose.map((op) => op.verb)).toEqual(['POST', 'POST'])
  })

  it('ADOPTS a crashed session\'s orphans — a re-used name is updated in place, never deleted', async () => {
    // A killed tab or a crashed rail never tears down: its drafts survive under deterministic,
    // owner-scoped names, and a FRESH deps (nothing recorded) is exactly that situation. The POST
    // meets the orphan (409) and the orphan is patched where it stands. A 144-minute-old orphan once
    // blocked every live preview of the V4 demo, so the 409 must never be the end of the preview.
    const { deps, handleActionSet } = makeDeps((ops) => ops.map((op, index) => (
      op.verb === 'POST'
        ? { index, message: `"${(op.payload as { metadata: { name: string } }).metadata.name}" already exists`, ok: false, status: 409 }
        : { index, message: 'OK', ok: true, status: 200 })))
    expect(deps.session.take()).toHaveLength(0)

    const chip = await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    expect(chip?.label).not.toContain('failed')
    expect(openedPayload().liveEndpoint).toBeDefined()
    expect(verbsOf(handleActionSet)).not.toContain('DELETE')
    const patched = opsOf(handleActionSet).filter((op) => op.verb === 'PATCH').map(nameParam)
    expect(patched).toEqual([scoped('page-preview-draft'), scoped('preview-draft-title')])
  })

  it('honors the proposal label on the chip', async () => {
    const { deps } = makeDeps()
    const chip = await applyPreviewPageV2(proposalOf([flexRoot()], 'preview the postgres page'), deps)
    expect(chip?.label).toBe('preview the postgres page')
  })
})

/**
 * THE "NOT FOUND" FLASH, from the Portal Builder recordings. Each drop or bind in the composer
 * re-applies the whole page, and the apply used to DELETE every name before POSTing it again. The
 * Rendered tab, mounted on the same root and refetched by the sweep's own write, showed "Not found"
 * cards for seconds — for the PageHeader too, which no edit had touched.
 */
describe('previewPage v2 — an edit never deletes a widget it keeps', () => {
  it('adding a widget POSTs only the new one (first) and PATCHes the rest; nothing is deleted', async () => {
    const { deps, handleActionSet } = makeDeps()
    await applyPreviewPageV2(proposalOf([flexRootWith('preview-draft-title'), paragraphNamed('preview-draft-title')]), deps)
    handleActionSet.mockClear()

    await applyPreviewPageV2(proposalOf([
      flexRootWith('preview-draft-title', 'preview-draft-more'),
      paragraphNamed('preview-draft-title'),
      paragraphNamed('preview-draft-more'),
    ]), deps)

    expect(verbsOf(handleActionSet)).not.toContain('DELETE')
    const ops = opsOf(handleActionSet)
    // The new child exists before the container that lists it is updated.
    expect(ops.map((op) => op.verb)).toEqual(['POST', 'PATCH', 'PATCH'])
    expect((ops[0].payload as { metadata: { name: string } }).metadata.name).toBe(scoped('preview-draft-more'))
    expect(ops.slice(1).map(nameParam)).toEqual([scoped('page-preview-draft'), scoped('preview-draft-title')])
  })

  it('removing a widget deletes ONLY it, and only after the container stopped listing it', async () => {
    const { deps, handleActionSet } = makeDeps()
    await applyPreviewPageV2(proposalOf([
      flexRootWith('preview-draft-title', 'preview-draft-more'),
      paragraphNamed('preview-draft-title'),
      paragraphNamed('preview-draft-more'),
    ]), deps)
    handleActionSet.mockClear()

    await applyPreviewPageV2(proposalOf([flexRootWith('preview-draft-title'), paragraphNamed('preview-draft-title')]), deps)

    const ops = opsOf(handleActionSet)
    expect(ops.map((op) => op.verb)).toEqual(['PATCH', 'PATCH', 'DELETE'])
    expect(nameParam(ops[2])).toBe(scoped('preview-draft-more'))
  })

  it('the in-place update removes a field the edit removed (merge patch nulls it)', async () => {
    const { deps, handleActionSet } = makeDeps()
    const titled = { ...paragraph(), spec: { widgetData: { strong: true, text: 'Draft paragraph' } } }
    await applyPreviewPageV2(proposalOf([flexRoot(), titled]), deps)
    handleActionSet.mockClear()

    await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    const patch = opsOf(handleActionSet).find((op) => nameParam(op) === scoped('preview-draft-title'))
    expect(patch?.verb).toBe('PATCH')
    expect((patch?.payload as { spec: { widgetData: Record<string, unknown> } }).spec.widgetData)
      .toEqual({ strong: null, text: 'Draft paragraph' })
  })

  it('an update whose object is gone (the TTL janitor) creates it instead', async () => {
    let calls = 0
    const { deps, handleActionSet } = makeDeps((ops) => {
      calls += 1
      // 2nd dispatch = the re-apply's PATCH set: the root is gone.
      return calls === 2 && ops[0].verb === 'PATCH'
        ? [{ index: 0, message: 'flexes "x" not found', ok: false, status: 404 }]
        : ops.map((_, index) => ({ index, message: 'OK', ok: true, status: 200 }))
    })
    await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    const chip = await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    expect(chip?.label).not.toContain('failed')
    expect(verbsOf(handleActionSet).slice(2)).toEqual(['PATCH', 'PATCH', 'POST', 'PATCH'])
    expect(verbsOf(handleActionSet)).not.toContain('DELETE')
  })
})

describe('mergePatchOf', () => {
  it('nulls keys only the previous object had, recurses objects, replaces arrays whole', () => {
    expect(mergePatchOf(
      { a: 1, list: [2], nested: { keep: true } },
      { a: 0, gone: 'x', list: [1, 2, 3], nested: { dropped: 1, keep: false } },
    )).toEqual({ a: 1, gone: null, list: [2], nested: { dropped: null, keep: true } })
  })

  it('with no previous object, is the object itself', () => {
    expect(mergePatchOf({ a: 1 }, undefined)).toEqual({ a: 1 })
  })
})

describe('previewPage v2 — apply failure (graceful, rolled back, never a crash)', () => {
  it('a first-op failure: no teardown needed, the failure IS drawer content, graceful chip', async () => {
    const { deps, handleActionSet } = makeDeps(() => [{ index: 0, message: 'admission webhook denied', ok: false, status: 400 }])

    const chip = await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    // Only the apply dispatch — nothing landed, so nothing to tear down.
    expect(handleActionSet).toHaveBeenCalledTimes(1)
    expect(chip?.label).toBe(`preview apply failed — Flex/${scoped('page-preview-draft')}: admission webhook denied`)
    expect(chip?.readOnly).toBe(false)
    const payload = openedPayload()
    expect(payload.error).toContain('admission webhook denied')
    expect(payload.liveEndpoint).toBeUndefined()
  })

  it('a MID-SET failure rolls back the drafts that landed (best-effort DELETEs)', async () => {
    const { deps, handleActionSet } = makeDeps((ops) => (
      ops[0].verb === 'POST'
        ? [{ index: 0, message: 'OK', ok: true, status: 201 }, { index: 1, message: 'quota exceeded', ok: false, status: 403 }]
        : ops.map((_, index) => ({ index, message: 'OK', ok: true, status: 200 }))
    ))

    const chip = await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    expect(chip?.label).toBe(`preview apply failed — Paragraph/${scoped('preview-draft-title')}: quota exceeded`)
    // apply, then the rollback of the ONE landed draft.
    expect(handleActionSet).toHaveBeenCalledTimes(2)
    const [rollback] = handleActionSet.mock.calls[1] as [WriteOp[]]
    expect(rollback).toHaveLength(1)
    expect(rollback[0].verb).toBe('DELETE')
    expect(nameParam(rollback[0])).toBe(scoped('page-preview-draft'))
    expect(openedPayload().error).toContain('quota exceeded')
  })

  it('a 409 whose in-place update is REFUSED still fails, reporting what is in the way', async () => {
    const { deps } = makeDeps((ops) => (
      ops[0].verb === 'POST'
        ? ops.map((_, index) => ({ index, message: 'tables "pods-table" already exists', ok: false, status: 409 }))
        : ops.map((_, index) => ({ index, message: 'forbidden', ok: false, status: 403 }))
    ))

    const chip = await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    expect(chip?.label).toContain('already exists')
    expect(openedPayload().error).toContain('already exists')
    expect(openedPayload().error).toContain('forbidden')
    expect(openedPayload().liveEndpoint).toBeUndefined()
  })

  it('does NOT retry a failure that is not a 409 — one POST attempt, then rollback', async () => {
    let posts = 0
    const { deps } = makeDeps((ops) => {
      if (ops[0].verb !== 'POST') {
        return ops.map((_, index) => ({ index, message: 'OK', ok: true, status: 200 }))
      }
      posts += 1

      return ops.map((_, index) => ({ index, message: 'admission webhook denied', ok: false, status: 400 }))
    })

    const chip = await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    expect(chip?.label).toContain('admission webhook denied')
    expect(posts).toBe(1)
  })

  it('a null dispatch result (not dispatched) is a graceful failure chip, never a throw', async () => {
    const { deps } = makeDeps(() => null)
    const chip = await applyPreviewPageV2(proposalOf([flexRoot()]), deps)
    expect(chip?.label).toBe('preview apply failed — the write set was not dispatched')
    expect(openedPayload().error).toBe('the write set was not dispatched')
  })
})

describe('previewPage v2 — owner-scoped names (two people, one page)', () => {
  /**
   * Every name a run dispatched, by verb — the POSTs, the in-place PATCHes, the teardown. A POST
   * goes to the collection, so its name is the payload's; a DELETE names its object in the path.
   */
  const nameOf = (op: WriteOp): string | null =>
    (op.verb === 'POST' ? (op.payload as { metadata?: { name?: string } } | undefined)?.metadata?.name ?? null : nameParam(op))
  const namesBy = (handleActionSet: ReturnType<typeof vi.fn>, verb: string): Set<string> =>
    new Set(handleActionSet.mock.calls.flatMap(([ops]) => (ops as WriteOp[]).filter((op) => op.verb === verb).map(nameOf))
      .filter((name): name is string => name !== null))

  it('alice\'s apply, 409 adoption and teardown never name one of bob\'s objects for the same page', async () => {
    // THE COLLISION. Both preview `page-preview-draft`. A 409 is adopted by patching whatever holds
    // the name, and the close deletes by name — so with unscoped names alice's preview would have
    // overwritten, then deleted, bob's live one. The POSTs answer 409 first, to drive the adoption.
    const run = async (owner: string) => {
      loginAs(owner)
      let posts = 0
      const { deps, handleActionSet } = makeDeps((ops) => {
        if (ops[0].verb !== 'POST') {
          return ops.map((_, index) => ({ index, message: 'OK', ok: true, status: 200 }))
        }
        posts += 1
        // Two refusals: the chunk's first POST, then the resumed chunk's — each adopted by a PATCH.
        return posts <= 2
          ? ops.map((_, index) => ({ index, message: 'already exists', ok: false, status: 409 }))
          : ops.map((_, index) => ({ index, message: 'OK', ok: true, status: 201 }))
      })
      await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)
      openPreviewMock.mock.calls.at(-1)?.[0].onClose?.()
      return handleActionSet
    }
    const alice = await run('alice')
    const bob = await run('bob')

    const bobWrites = new Set([...namesBy(bob, 'POST'), ...namesBy(bob, 'PATCH')])
    const aliceDeletes = namesBy(alice, 'DELETE')
    expect(bobWrites.size).toBe(2)
    // alice deleted things — the close fired…
    expect(aliceDeletes.size).toBeGreaterThan(0)
    // …and not one of them is a name bob wrote.
    for (const name of bobWrites) {
      expect(aliceDeletes.has(name)).toBe(false)
    }
    // Every name alice touched carries alice's tag, and no other.
    for (const name of [...namesBy(alice, 'POST'), ...namesBy(alice, 'PATCH'), ...aliceDeletes]) {
      expect(name.endsWith(`-${ownerTagOf('alice')}`)).toBe(true)
    }
  })

  it('each person\'s drawer mounts their OWN root', async () => {
    loginAs('alice')
    await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), makeDeps().deps)
    loginAs('bob')
    await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), makeDeps().deps)

    expect(openedPayload(0).liveEndpoint).toContain(`name=${scoped('page-preview-draft', 'alice')}&`)
    expect(openedPayload(1).liveEndpoint).toContain(`name=${scoped('page-preview-draft', 'bob')}&`)
  })

  it('the rename never leaks: the drawer\'s files and the held draft a publish writes carry the AUTHORED names', async () => {
    // A publish commits the HELD draft's files (publishDraft → heldPublishFiles(held.files)), and
    // the held draft is recorded from the proposal's widgets (recordPagePreview), never from the
    // sandbox copy. The drawer's Files tab is shown as that write set and edits it by path — so its
    // paths must be the held keys, not sandbox names.
    const widgets = [flexRoot(), paragraph()]
    const { deps, handleActionSet } = makeDeps()
    await applyPreviewPageV2(proposalOf(widgets), deps)
    const tag = ownerTagOf('alice')
    // The sandbox DID get the scoped names…
    expect([...namesBy(handleActionSet, 'POST')].every((name) => name.endsWith(`-${tag}`))).toBe(true)

    // …the drawer did not.
    const payload = openedPayload()
    for (const file of payload.files ?? []) {
      expect(file.path).not.toContain(tag)
      expect(file.content).not.toContain(tag)
    }

    // …and neither does the held draft, recorded exactly as the provider records it.
    const store = createBlueprintDraftStore()
    recordPagePreview(widgets, store, { recordPreview: vi.fn() })
    const held = store.get()
    expect(held).not.toBeNull()
    expect(JSON.stringify(held?.files)).not.toContain(tag)
    expect(Object.keys(held?.files ?? {})).toEqual(expect.arrayContaining((payload.files ?? []).map((file) => file.path)))
  })
})
