/**
 * The provider's answer to a person resuming a stored draft — see previewDraftResume for the bus,
 * draftResume for the read, and the plan ("Draft records") for why a record is the draft.
 *
 * The rules, each a defect it closes:
 *   - A resume is REFUSED as `held` while a draft is open, and says which one — seeding over it
 *     would drop the open draft from the tab without the person choosing to. Only `replace: true`,
 *     the replace prompt's "Close and resume", goes on.
 *   - Replacing is NOT discarding: the open draft stays saved in Your drafts, so this never emits
 *     the discard bus (which deletes the record). What it does drop is what belonged only to the
 *     open draft in this tab — its arming, its undo steps, its refusals and, for a page, its live
 *     render (which the next preview of that page rebuilds from its record).
 *   - UNDO STARTS AT THE RESTORED TREE. A step recorded against the draft that was open, restored
 *     into this one, would be exactly the data loss the history exists to prevent.
 *   - PUBLISH IS ARMED ONLY WHEN THE RECORD SAYS THE LAST PREVIEW RENDERED THIS EXACT TREE —
 *     `renderedHash === treeHash(held files)`. A record saved after an edit that was never previewed
 *     comes back as "Preview needed", as it would have been in the tab that saved it.
 *   - THE THREAD IS RE-LINKED ONLY IF IT STILL EXISTS; the result says whether, so the banner never
 *     claims a conversation that is gone. Re-linking switches threads, which resets the gates — so it
 *     happens FIRST, and the arming decided here is not wiped by it.
 *   - A PAGE RE-APPLIES ITS LIVE PREVIEW, through the file buses' own apply loop (one apply at a
 *     time, see useDraftFileBuses) — never a second apply beside it.
 *   - AN ADOPTION RETIRES THE LEGACY OBJECTS only after the tree is held, and before the re-apply,
 *     whose sweep would otherwise race the DELETEs over the same names.
 */
import { useEffect, useRef } from 'react'

import { findBuilderOf } from '../../builders/builderRegistry'
import { draftKindOf } from '../../builders/draftKinds'
import type { SetDispatchOptions } from '../../hooks/runRestSet'
import { pinnedOnResumeSentence } from '../../pages/ControllerComposer/servedVersion'

import { legacyDeleteOps, type SandboxTarget } from './adoptLegacyPage'
import { MAX_APPLY_SET_OPS } from './applyResourceSet'
import type { BlueprintDraftStore } from './blueprintDraftStore'
import type { BlueprintGate } from './blueprintGate'
import type { SandboxWriter } from './blueprintRenderSandbox'
import { clearComposeRefusals } from './composeRequest'
import { autopilotConversationStore } from './conversationStore'
import { draftHistory } from './draftHistory'
import { treeHash } from './draftRecord'
import { emitDraftReapply, emitDraftResumeResult, emitLegacyDiscardResult, onDraftResume, onLegacyDiscard } from './previewDraftResume'
import { heldDraftIdentity } from './publishCompile'
import type { DraftAutosave } from './useDraftAutosave'

/**
 * The name a person knows the held draft by — a chart's or a controller's Chart.yaml name, a page's
 * slug — from the draft-kind plugin its Builder names; "the open <kind>" when the files carry none.
 */
export const heldDraftName = (held: NonNullable<ReturnType<BlueprintDraftStore['get']>>): string => {
  const plugin = draftKindOf(held.kind)
  return plugin.publishSlug(held.files) ?? `the open ${plugin.nouns.short}`
}

/**
 * Whether a draft of this kind is previewed LIVE in the sandbox (its Builder's `preview.mode:
 * sandbox-apply`, the page): its render is rebuilt from the record on resume, and torn down when it
 * is replaced. A rendered kind (blueprint, controller) has nothing live to re-apply.
 */
const appliesLive = (kind: string | undefined): boolean => findBuilderOf(kind)?.preview.mode === 'sandbox-apply'

/**
 * DELETE sandbox objects through the audited writer, in sets of MAX_APPLY_SET_OPS (the dispatcher's
 * cap), in order. `declined`: the confirm was answered No, so that set and every later one did not
 * run. `failed`: the objects of any set that did not complete (stop-on-first-error means a failed set
 * may have deleted some of its objects; they are listed all the same, as "not known to be gone").
 */
export const deleteSandboxObjects = async (
  writer: SandboxWriter,
  targets: readonly SandboxTarget[],
  options: SetDispatchOptions,
): Promise<{ declined: boolean; deleted: number; failed: string[] }> => {
  const ops = legacyDeleteOps(targets, writer.sandboxNamespace)
  const failed: string[] = []
  let deleted = 0
  for (let start = 0; start < ops.length; start += MAX_APPLY_SET_OPS) {
    const chunk = ops.slice(start, start + MAX_APPLY_SET_OPS)
    const names = targets.slice(start, start + MAX_APPLY_SET_OPS).map(({ gvr, name }) => `${gvr.resource}/${name}`)
    // One set at a time: the next confirm must not open over this one.
    // eslint-disable-next-line no-await-in-loop
    const results = await writer.handleActionSet(chunk, options).catch(() => undefined)
    if (results === null) {
      return { declined: true, deleted, failed: [...failed, ...targets.slice(start).map(({ gvr, name }) => `${gvr.resource}/${name}`)] }
    }
    if (!results || results.length !== chunk.length || !results.every((result) => result.ok)) {
      failed.push(...names)
    } else {
      deleted += chunk.length
    }
  }
  return { declined: false, deleted, failed }
}

/**
 * Re-link the thread a record came from: true when it is the current thread, or an archived one that
 * was switched to; false when the history no longer has it — a thread that is gone is said to be
 * gone by saying nothing.
 */
export const relinkThreadWith = (switchToThread: (threadId: string) => void) => (threadId: string): boolean => {
  if (threadId === autopilotConversationStore.getSnapshot().sessionId) {
    return true
  }
  if (!autopilotConversationStore.sessions().some((thread) => thread.sessionId === threadId)) {
    return false
  }
  switchToThread(threadId)
  return true
}

export interface DraftResumeDeps {
  /**
   * The draft-record autosave: told what the resumed record already says — its renderedHash, state,
   * publish link and thread, and that it EXISTS — immediately before the tree is held, so the first
   * save after a resume updates the record instead of resetting it to an open, never-previewed draft.
   */
  autosave?: Pick<DraftAutosave, 'seedFromRecord'>
  /**
   * The provider's thread switcher. Optional: absent (tests, a provider with no rail), nothing is
   * re-linked and the banner does not say so. `relinkThread` overrides the lookup (tests).
   */
  switchToThread?: (threadId: string) => void
  relinkThread?: (threadId: string) => boolean
  /** The audited sandbox writer — what an adoption removes the legacy objects with. */
  sandboxWriter?: SandboxWriter
}

export const useDraftResumeBus = (
  store: BlueprintDraftStore,
  gate: Pick<BlueprintGate, 'forget' | 'isArmed' | 'recordPreview'>,
  deps: DraftResumeDeps = {},
): void => {
  // Read through a ref so the subscription is made once and still sees the current writer and
  // thread switcher: the provider rebuilds both as its config and thread change.
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => onDraftResume(({ id, record, replace, retire }) => {
    const open = store.get()
    if (open && !replace) {
      emitDraftResumeResult({ held: { kind: open.kind, name: heldDraftName(open), previewed: gate.isArmed(heldDraftIdentity(open)) }, id, outcome: 'held' })
      return
    }
    const { autosave, sandboxWriter, switchToThread } = depsRef.current
    const relinkThread = depsRef.current.relinkThread ?? (switchToThread ? relinkThreadWith(switchToThread) : undefined)
    // First: a thread switch resets every arming (teardownThread), and must not reset this one's.
    const relinked = record.threadId && relinkThread ? relinkThread(record.threadId) : false
    const replacedPage = appliesLive(open?.kind)
    if (open) {
      gate.forget(heldDraftIdentity(open))
    }
    autosave?.seedFromRecord(record)
    const set = store.set(record.files, record.kind)
    if (!set.ok) {
      // store.set leaves what was held untouched on a refusal, so the open draft is still open.
      emitDraftResumeResult({ id, message: `${record.name} could not be restored: ${set.error}`, outcome: 'refused' })
      return
    }
    clearComposeRefusals()
    draftHistory.clear()
    const identity = heldDraftIdentity(set.held)
    // The HELD files, not the record's: the store settles a chart (its graph block regenerated), and
    // what publishes is what is held — so that is the tree the rendered hash must name.
    const previewed = record.renderedHash !== undefined && record.renderedHash === treeHash(set.held.files)
    if (previewed) {
      gate.recordPreview(identity)
    } else {
      gate.forget(identity)
    }
    // An UNPUBLISHED controller saved before its document was pinned is held pinned (the store's
    // settle): the tree changed, and the autosave will write it — so the person is told, not surprised.
    // A published one is never pinned, so holding it changes nothing.
    const updated = record.kind === 'controller' && treeHash(set.held.files) !== treeHash(record.files)
      ? pinnedOnResumeSentence(set.held.files)
      : null
    const finish = (retireError?: string): void => {
      if (appliesLive(record.kind) || replacedPage) {
        emitDraftReapply({ discardPrevious: replacedPage })
      }
      emitDraftResumeResult({ id, outcome: 'resumed', previewed, relinked, ...(retireError ? { retireError } : {}), ...(updated ? { updated } : {}) })
    }
    if (!retire?.length) {
      finish()
      return
    }
    if (!sandboxWriter) {
      finish('The old draft could not be removed from the sandbox — this portal has no sandbox writer.')
      return
    }
    void (async () => {
      // Silent and confirm-free: only the sandbox is touched, and the person already chose to adopt.
      const { failed } = await deleteSandboxObjects(sandboxWriter, retire, { silent: true, skipConfirmForSandbox: sandboxWriter.sandboxNamespace })
      finish(failed.length
        ? `The page is yours now, but its old objects could not all be removed from the sandbox: ${failed.join(', ')}.`
        : undefined)
    })()
  }), [gate, store])

  // "Unowned drafts" Discard of a legacy page set. WITH the blast-radius confirm — no
  // skipConfirmForSandbox: this is a person deleting work, not a preview writing scratch — so the
  // confirm lists every object before any is deleted. Nothing held is touched.
  useEffect(() => onLegacyDiscard(({ id, root, targets }) => {
    const { sandboxWriter } = depsRef.current
    if (!sandboxWriter) {
      emitLegacyDiscardResult({ id, message: `${root} was not deleted — this portal has no sandbox writer.`, outcome: 'failed' })
      return
    }
    void (async () => {
      const { declined, deleted, failed } = await deleteSandboxObjects(sandboxWriter, targets, {})
      if (declined && deleted === 0) {
        emitLegacyDiscardResult({ id, message: `Nothing was deleted — ${root} is still in Unowned drafts.`, outcome: 'cancelled' })
      } else if (failed.length) {
        emitLegacyDiscardResult({ id, message: `${root} was not deleted completely; still in the sandbox: ${failed.join(', ')}.`, outcome: 'failed' })
      } else {
        emitLegacyDiscardResult({ id, message: `Deleted ${root} and everything it held (${targets.length} ${targets.length === 1 ? 'object' : 'objects'}).`, outcome: 'deleted' })
      }
    })()
  }), [])
}
