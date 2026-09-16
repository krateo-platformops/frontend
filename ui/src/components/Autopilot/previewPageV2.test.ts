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
 *   - a fresh preview SWEEPS the previous drafts first (latest wins, no 409);
 *   - apply failure → applied drafts rolled back (best-effort), the failure shown
 *     AS drawer content, a graceful chip — never a crash.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WriteOp, WriteOpResult } from '../../hooks/runRestSet'

import type { PortalActionProposal } from './actionBridge'
import { openAutopilotPreview } from './previewBus'
import type { AutopilotPreviewPayload } from './previewBus'
import { applyPreviewPageV2, type PreviewPageV2Deps } from './previewPageV2'
import { createPreviewPageSession, WIDGETS_API_VERSION } from './previewSandbox'

vi.mock('./previewBus', () => ({ openAutopilotPreview: vi.fn(), setPreviewProblems: vi.fn() }))

const openPreviewMock = vi.mocked(openAutopilotPreview)

const SANDBOX = 'krateo-preview'

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

beforeEach(() => {
  vi.clearAllMocks()
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

describe('previewPage v2 — the happy path (apply → live drawer → teardown on close)', () => {
  it('SWEEPS the names it is about to write, then applies them — silent, sandbox-confined', async () => {
    const { deps, handleActionSet } = makeDeps()

    const chip = await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    // TWO dispatches now: the pre-sweep always fires, because it is derived from the targets this
    // apply is about to create rather than from what this session remembers. That is what makes a
    // re-used name idempotent after a crash — see the DELETE assertions below.
    expect(handleActionSet).toHaveBeenCalledTimes(2)
    const [sweepOps] = handleActionSet.mock.calls[0] as [WriteOp[], unknown]
    expect(sweepOps.every((op) => op.verb === 'DELETE')).toBe(true)
    expect(sweepOps).toHaveLength(2)
    const [ops, options] = handleActionSet.mock.calls[1] as [WriteOp[], unknown]
    expect(options).toEqual({ silent: true, skipConfirmForSandbox: SANDBOX })
    expect(ops.map((op) => op.verb)).toEqual(['POST', 'POST'])
    expect(ops[0].path).toContain('resource=flexes')
    expect(ops[0].path).toContain(`namespace=${SANDBOX}`)
    // The POSTed payloads are the REWRITTEN drafts (sandbox namespace + preview labels).
    const posted = ops[0].payload as { metadata: { namespace: string; labels: Record<string, string> } }
    expect(posted.metadata.namespace).toBe(SANDBOX)
    expect(posted.metadata.labels['krateo.io/purpose']).toBe('preview-draft')
    expect(posted.metadata.labels['krateo.io/preview-session']).toBe('s_test')

    // The drawer renders the ROOT draft's REAL served endpoint + the rewritten source.
    const payload = openedPayload()
    expect(payload.liveEndpoint).toBe(
      `/call?resource=flexes&apiVersion=widgets.templates.krateo.io/v1beta1&name=page-preview-draft&namespace=${SANDBOX}`,
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

    // sweep + apply + teardown
    expect(handleActionSet).toHaveBeenCalledTimes(3)
    const [teardown, options] = handleActionSet.mock.calls[2] as [WriteOp[], unknown]
    expect(teardown.map((op) => op.verb)).toEqual(['DELETE', 'DELETE'])
    expect(teardown[0].path).toContain('name=page-preview-draft')
    expect(teardown[1].path).toContain('name=preview-draft-title')
    expect(options).toEqual({ silent: true, skipConfirmForSandbox: SANDBOX })

    payload.onClose?.()
    expect(handleActionSet).toHaveBeenCalledTimes(3)
  })

  it('a FRESH preview sweeps the previous drafts first; the STALE drawer-close is a no-op', async () => {
    const { deps, handleActionSet } = makeDeps()
    await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)
    const stalePayload = openedPayload()

    await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    // sweep+apply #1, then sweep+apply #2.
    expect(handleActionSet).toHaveBeenCalledTimes(4)
    const [sweep] = handleActionSet.mock.calls[2] as [WriteOp[]]
    expect(sweep.every((op) => op.verb === 'DELETE')).toBe(true)

    // The stale drawer's close must NOT delete the fresh preview's drafts.
    stalePayload.onClose?.()
    expect(handleActionSet).toHaveBeenCalledTimes(4)

    // The fresh drawer's close does.
    openedPayload(1).onClose?.()
    expect(handleActionSet).toHaveBeenCalledTimes(5)
  })

  it('ADOPTS a crashed session\'s orphans — re-used names are swept even with nothing recorded', async () => {
    // THE BUG THIS EXISTS FOR. Teardown fires only on drawer-close, so a killed tab or a crashed
    // rail never records it. Its drafts survive under deterministic names (page-<slug>,
    // <name>-card...), the next preview POSTs the same names, the apiserver answers 409, and the
    // drawer silently falls back to the source view — reported as "Applying the drafts to the
    // preview sandbox failed" or mislabelled upstream as a validation error. A 144-minute-old orphan
    // from a killed recorder blocked every live preview during the V4 demo.
    //
    // A FRESH deps is exactly that situation: session state empty, orphans on the cluster. The sweep
    // must still cover the names about to be written, because it is derived from the apply targets
    // rather than from what anyone remembers.
    const { deps, handleActionSet } = makeDeps()
    // nothing recorded — the post-crash state
    expect(deps.session.take()).toHaveLength(0)

    await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    const [sweep] = handleActionSet.mock.calls[0] as [WriteOp[]]
    expect(sweep.every((op) => op.verb === 'DELETE')).toBe(true)
    // The very names the apply is about to create — so the POST cannot collide with an orphan.
    expect(sweep[0].path).toContain('name=page-preview-draft')
    expect(sweep[1].path).toContain('name=preview-draft-title')

    const [applyOps] = handleActionSet.mock.calls[1] as [WriteOp[]]
    expect(applyOps.every((op) => op.verb === 'POST')).toBe(true)
    // Every name POSTed was swept first. That equality IS the no-409 guarantee.
    const swept = sweep.map((op) => new URL(op.path, 'https://x').searchParams.get('name')).sort()
    const posted = applyOps.map((op) => (op.payload as { metadata: { name: string } }).metadata.name).sort()
    expect(swept).toEqual(posted)
  })

  it('honors the proposal label on the chip', async () => {
    const { deps } = makeDeps()
    const chip = await applyPreviewPageV2(proposalOf([flexRoot()], 'preview the postgres page'), deps)
    expect(chip?.label).toBe('preview the postgres page')
  })
})

describe('previewPage v2 — apply failure (graceful, rolled back, never a crash)', () => {
  it('a first-op failure: no teardown needed, the failure IS drawer content, graceful chip', async () => {
    const { deps, handleActionSet } = makeDeps(() => [{ index: 0, message: 'admission webhook denied', ok: false, status: 400 }])

    const chip = await applyPreviewPageV2(proposalOf([flexRoot(), paragraph()]), deps)

    // Only the apply dispatch — nothing landed, so nothing to tear down.
    expect(handleActionSet).toHaveBeenCalledTimes(2)
    expect(chip?.label).toBe('preview apply failed — Flex/page-preview-draft: admission webhook denied')
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

    expect(chip?.label).toBe('preview apply failed — Paragraph/preview-draft-title: quota exceeded')
    // apply, then the rollback of the ONE landed draft.
    expect(handleActionSet).toHaveBeenCalledTimes(3)
    const [rollback] = handleActionSet.mock.calls[2] as [WriteOp[]]
    expect(rollback).toHaveLength(1)
    expect(rollback[0].verb).toBe('DELETE')
    expect(rollback[0].path).toContain('name=page-preview-draft')
    expect(openedPayload().error).toContain('quota exceeded')
  })

  it('a null dispatch result (not dispatched) is a graceful failure chip, never a throw', async () => {
    const { deps } = makeDeps(() => null)
    const chip = await applyPreviewPageV2(proposalOf([flexRoot()]), deps)
    expect(chip?.label).toBe('preview apply failed — the write set was not dispatched')
    expect(openedPayload().error).toBe('the write set was not dispatched')
  })
})
