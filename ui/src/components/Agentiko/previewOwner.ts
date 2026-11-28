/**
 * A PREVIEW BELONGS TO ITS DRAFT RECORD (frontend#496, Diego 2026-11-24): discarding a page draft also
 * removes that person's preview of it, whichever tab or day the discard happens in.
 *
 * "Discard" deletes the record ConfigMap through the portal, with no code of ours in the way. So each
 * applied preview object names the record as its Kubernetes owner, and the cluster removes the preview
 * when the record goes. Only metadata.ownerReferences is written, once per object and record, and never as
 * a controlling or blocking owner.
 *
 * The record's uid comes from the apiserver's own answer to a save, or from the record a resume read,
 * never from a cache: an owner that does not exist would take the preview with it at once.
 */
import type { WriteOp } from '../../hooks/runRestSet'

import { buildSetOpPath, MAX_APPLY_SET_OPS } from './applyResourceSet'
import type { SandboxWriter } from './blueprintRenderSandbox'
import type { DraftTarget } from './previewSandbox'

export interface RecordOwner {
  /** The record ConfigMap's name. */
  name: string
  uid: string
}

const owners = new Map<string, RecordOwner>()
const listeners = new Set<(page: string) => void>()

/** The page's record, as the apiserver last answered. */
export const recordOf = (page: string): RecordOwner | undefined => owners.get(page)

/** A page's record was stored, or read to be resumed. */
export const recordStored = (page: string, owner: RecordOwner): void => {
  const known = owners.get(page)
  if (known?.uid === owner.uid && known.name === owner.name) { return }
  owners.set(page, owner)
  listeners.forEach((listener) => { listener(page) })
}

export const onRecordStored = (listener: (page: string) => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Test-only: a fresh document. */
export const resetRecordOwners = (): void => { owners.clear() }

const ownerPatch = ({ name, uid }: RecordOwner) =>
  ({ metadata: { ownerReferences: [{ apiVersion: 'v1', blockOwnerDeletion: false, controller: false, kind: 'ConfigMap', name, uid }] } })

/**
 * Make the record the owner of these objects. Best effort, and never a preview's problem: an object that
 * was not patched is simply not removed with the draft. Returns the targets that landed.
 */
export const ownPreviewObjects = async (targets: readonly DraftTarget[], owner: RecordOwner, writer: SandboxWriter): Promise<DraftTarget[]> => {
  const landed: DraftTarget[] = []
  for (let at = 0; at < targets.length; at += MAX_APPLY_SET_OPS) {
    const set = targets.slice(at, at + MAX_APPLY_SET_OPS)
    const ops = set.map(({ gvr, name }): WriteOp =>
      ({ path: buildSetOpPath({ gvr, name, namespace: writer.sandboxNamespace, verb: 'PATCH' }), payload: ownerPatch(owner), verb: 'PATCH' }))
    try {
      // eslint-disable-next-line no-await-in-loop -- the fabric's sets are sequential
      const results = await writer.handleActionSet(ops, { silent: true, skipConfirmForSandbox: writer.sandboxNamespace, skipRevalidate: true })
      landed.push(...(results ?? []).filter(({ ok }) => ok).map(({ index }) => set[index]))
    } catch {
      return landed
    }
  }
  return landed
}
