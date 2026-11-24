/**
 * frontend#496: a page preview belongs to its draft record, so a discard removes it too. The record's uid
 * is the apiserver's own answer to a save (or the record a resume read), and ownership is never a
 * preview's problem: it is written after the apply, once, and a refusal changes nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WriteOp, WriteOpResult } from '../../hooks/runRestSet'

import { draftRecordConfigMap, readDraftRecord, type DraftRecordBody } from './draftRecord'
import { resetKindCacheForTests } from './kindResolver'
import { onRecordStored, recordOf, recordStored, resetRecordOwners } from './previewOwner'
import { applyPreviewPageV2, discardPreviewSandbox, ownAppliedPreview, type PreviewPageV2Deps } from './previewPageV2'
import { createPreviewPageSession, primeDraftKinds, sandboxDraftName, WIDGETS_API_VERSION } from './previewSandbox'
import { createDraftAutosave } from './useDraftAutosave'

vi.mock('./previewBus', () => ({ openAgentikoPreview: vi.fn(), setPreviewProblems: vi.fn(), setPreviewRender: vi.fn() }))

const SANDBOX = 'krateo-preview'
const RECORD = { name: 'draft-page-alice-preview-draft', uid: 'uid-1' }
const PAGE = 'preview-draft'

const root = () => ({
  kind: 'Flex',
  metadata: { name: `page-${PAGE}`, namespace: 'krateo-system' },
  spec: {
    resourcesRefs: { items: [{ allowed: true, apiVersion: WIDGETS_API_VERSION, id: 'p1', name: `${PAGE}-title`, namespace: 'krateo-system', resource: 'paragraphs', verb: 'GET' }] },
    widgetData: { allowedResources: ['paragraphs'], items: [{ resourceRefId: 'p1' }] },
  },
})
const paragraph = (text = 'one') => ({ kind: 'Paragraph', metadata: { name: `${PAGE}-title` }, spec: { widgetData: { text } } })

type Answer = (ops: readonly WriteOp[]) => WriteOpResult[]
const allOk: Answer = (ops) => ops.map((_, index) => ({ index, message: 'OK', ok: true, status: 200 }))
const ownership = (op: WriteOp) => (op.payload as { metadata?: { ownerReferences?: { uid: string }[] } } | undefined)?.metadata?.ownerReferences

const setup = (answer: Answer = allOk) => {
  const handleActionSet = vi.fn((ops: readonly WriteOp[]) => Promise.resolve(answer(ops)))
  const deps: PreviewPageV2Deps = { handleActionSet, sandboxNamespace: SANDBOX, session: createPreviewPageSession(), sessionId: 's' }
  const owned = () => handleActionSet.mock.calls.flatMap(([ops]) => ops).filter((op) => ownership(op))
  const preview = (text?: string) => applyPreviewPageV2({ verb: 'previewPage', widgets: [root(), paragraph(text)] }, deps)
  return { deps, handleActionSet, owned, preview }
}

beforeEach(async () => {
  vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'K_user' ? JSON.stringify({ user: { username: 'alice' } }) : null) })
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const plural = new URL(url).searchParams.get('kind') === 'Flex' ? 'flexes' : 'paragraphs'
    return Promise.resolve({ json: () => Promise.resolve({ plural }), ok: true, status: 200 })
  }))
  resetKindCacheForTests()
  await primeDraftKinds([root(), paragraph()], 'http://snowplow.test')
})
afterEach(() => {
  resetRecordOwners()
  vi.unstubAllGlobals()
})

describe('an applied preview belongs to its page’s record', () => {
  it('every object names the record, only metadata, never controlling or blocking', async () => {
    recordStored(PAGE, RECORD)
    const { owned, preview } = setup()
    await preview()
    expect(owned().map((op) => new URL(op.path, 'http://x').searchParams.get('name')).sort()).toEqual([sandboxDraftName(`page-${PAGE}`, 'alice'), sandboxDraftName(`${PAGE}-title`, 'alice')].sort())
    for (const op of owned()) {
      expect(op.verb).toBe('PATCH')
      expect(op.payload).toEqual({ metadata: { ownerReferences: [{ apiVersion: 'v1', blockOwnerDeletion: false, controller: false, kind: 'ConfigMap', ...RECORD }] } })
    }
  })

  it('once: an edit of the same page does not write it again', async () => {
    recordStored(PAGE, RECORD)
    const { owned, preview } = setup()
    await preview()
    await preview('two')
    expect(owned()).toHaveLength(2)
  })

  it('no record yet: nothing; then, when the record is stored, the applied preview belongs to it', async () => {
    const { deps, owned, preview } = setup()
    await preview()
    expect(owned()).toHaveLength(0)
    const heard = vi.fn()
    const stop = onRecordStored(heard)
    recordStored(PAGE, RECORD)
    recordStored(PAGE, RECORD)
    stop()
    expect(heard).toHaveBeenCalledExactlyOnceWith(PAGE)
    await ownAppliedPreview(deps)
    expect(owned()).toHaveLength(2)
  })

  it('a record created again (discarded, then edited) takes the preview over', async () => {
    recordStored(PAGE, RECORD)
    const { deps, owned, preview } = setup()
    await preview()
    recordStored(PAGE, { ...RECORD, uid: 'uid-2' })
    await ownAppliedPreview(deps)
    expect(owned().map((op) => ownership(op)?.[0].uid)).toEqual(['uid-1', 'uid-1', 'uid-2', 'uid-2'])
  })

  it('an object created again has no owner, and gets one', async () => {
    recordStored(PAGE, RECORD)
    let gone = true
    const { owned, preview } = setup((ops) => ops.map((op, index) => {
      const missing = gone && op.verb === 'PATCH' && !ownership(op) && op.path.includes('paragraphs')
      if (missing) { gone = false }
      return missing ? { index, message: 'not found', ok: false, status: 404 } : { index, message: 'OK', ok: true, status: 200 }
    }))
    await preview()
    await preview('two')
    expect(owned().filter((op) => op.path.includes('paragraphs'))).toHaveLength(2)
    expect(owned().filter((op) => op.path.includes('flexes'))).toHaveLength(1)
  })

  it('another page’s record owns nothing here', async () => {
    recordStored('other', RECORD)
    const { owned, preview } = setup()
    await preview()
    expect(owned()).toHaveLength(0)
  })

  it('a refusal changes nothing for the preview, and is tried again at the next', async () => {
    recordStored(PAGE, RECORD)
    let refuse = true
    const { owned, preview } = setup((ops) => ops.map((op, index) => ({ index, message: '', ok: !(refuse && ownership(op)), status: refuse && ownership(op) ? 403 : 200 })))
    expect((await preview())?.readOnly).toBe(false)
    refuse = false
    await preview('two')
    expect(owned()).toHaveLength(4)
  })

  it('a discarded live preview is not written again', async () => {
    const { deps, owned, preview } = setup()
    await preview()
    await discardPreviewSandbox(deps)
    recordStored(PAGE, RECORD)
    await ownAppliedPreview(deps)
    expect(owned()).toHaveLength(0)
  })
})

describe('where the uid comes from', () => {
  const body: DraftRecordBody = { files: { 'templates/a.yaml': 'kind: Flex\n' }, kind: 'page', name: PAGE, state: 'open', updatedAt: '2026-11-24T08:00:00Z', version: 1 }

  it('a resume’s read carries it; it is never stored in the record', () => {
    const configMap = draftRecordConfigMap(SANDBOX, 'alice', { ...body, uid: 'uid-9' })
    expect(JSON.stringify(configMap)).not.toContain('uid-9')
    const read = readDraftRecord({ ...configMap, metadata: { ...(configMap.metadata as object), uid: 'uid-9' } })
    expect(read?.uid).toBe('uid-9')
    const autosave = createDraftAutosave({ username: () => 'alice' })
    autosave.seedFromRecord(read as DraftRecordBody)
    expect(recordOf(PAGE)).toEqual({ name: RECORD.name, uid: 'uid-9' })
  })

  it('a blueprint’s record owns no preview', () => {
    createDraftAutosave({ username: () => 'alice' }).seedFromRecord({ ...body, kind: 'blueprint', uid: 'uid-9' })
    expect(recordOf(PAGE)).toBeUndefined()
  })
})
