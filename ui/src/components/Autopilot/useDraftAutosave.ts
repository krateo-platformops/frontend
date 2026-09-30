/**
 * AUTOSAVE — the held draft, written to its draft record while the person works.
 *
 * WHY. The held draft lived only in the tab: a closed or crashed tab lost a chart outright, and a
 * page kept only its render, which Resume cannot turn back into an editable draft. The record
 * (draftRecord.ts) is the draft, stored; this is what keeps it current. A dead tab loses at most the
 * last debounce window of edits.
 *
 * THE SEAM. `createBlueprintDraftStore(onChange)` fires after every mutation that changed the held
 * tree, for EVERY draft kind — the one place every write path (a Files-tab edit, a composer batch, Undo,
 * an agent proposal, a start, a close) already passes through. `onHeldChange` is handed to it by the
 * provider, so no path can change the draft without the autosave hearing about it.
 *
 * HOW IT WRITES. Through the `sandboxWriter` — the same audited set fabric a blueprint Preview's
 * render ConfigMap takes: human origin, a provenance record per write, the confirm skipped only
 * because runRestSet VERIFIES the op is confined to the sandbox namespace. The first save of a
 * record POSTs it; later saves PUT the whole object (a ConfigMap takes an unconditional update, and
 * snowplow /call forwards PUT under the caller's own token). A POST answering 409 means the record
 * already exists — this person's other tab, or a resumed draft — so it is replaced; a PUT answering
 * 404 means it was removed under us (Discard in the drafts list) while this tab still holds it, so it
 * is created again: the draft on screen is the draft, and it is stored.
 *
 * DEBOUNCED, because one gesture is several store changes and a burst of typing is dozens. One
 * write per settled burst (DRAFT_AUTOSAVE_DEBOUNCE_MS). WRITE-AHEAD: `flush` saves NOW, and every
 * preview calls it before it applies anything, so a tab killed mid-preview has already stored the
 * tree the preview was of.
 *
 * WHAT THIS TAB KNOWS, KEPT. `renderedHash` (set by a successful Preview), `threadId` (the Autopilot
 * thread that first changed the draft — set only after `noteAgentChange`, so a draft composed by hand
 * never claims a thread just because the rail has one open), `state` and `publish` (set by a publish that landed) are held here per
 * record and written with every save; `updatedAt` is the save's own time.
 *
 * NOTHING HERE DELETES. Closing the held draft is not discarding it: the record stays, listed in
 * "Your drafts". A close with a save still pending writes that save first. Discard lives in the
 * drafts list, where a person chooses it.
 *
 * NO SANDBOX, NO AUTOSAVE. Without api.PREVIEW_SANDBOX_NAMESPACE there is no writer and nowhere to
 * store a record: every call is a no-op and the status is `off` — never an error.
 */
import { useEffect } from 'react'

import { builderRegistry } from '../../builders/builderRegistry'
import { draftKindOf, isDraftKind } from '../../builders/draftKinds'
import { getUserInfo } from '../../utils/getUserInfo'

import { buildSetOpPath } from './applyResourceSet'
import type { BlueprintDraftHeld, DraftChangeListener, DraftKind } from './blueprintDraftStore'
import type { SandboxWriter } from './blueprintRenderSandbox'
import {
  DRAFT_RECORD_VERSION,
  type DraftRecordBody,
  draftOwner,
  draftRecordConfigMap,
  draftRecordName,
  type DraftState,
  treeHash,
} from './draftRecord'
import { draftSaveStatus } from './draftSaveStatus'
import { pageDraftFiles, pageDraftWidgets } from './pageDraft'

/** How long edits settle before the record is written. The plan's "~2 s". */
export const DRAFT_AUTOSAVE_DEBOUNCE_MS = 2000

const CONFIGMAPS = { group: '', resource: 'configmaps', version: 'v1' }

/**
 * The name a record is filed under — the same name the builder shows (a chart's Chart.yaml name, a
 * page's slug), from the draft-kind plugin its Builder names. A rename is a different record; the
 * old one stays, as a draft of the old name.
 */
export const draftRecordDisplayName = (held: Pick<BlueprintDraftHeld, 'files' | 'kind'>): string =>
  draftKindOf(held.kind).displayName(held.files)

/**
 * The draft kind whose Builder previews by APPLYING the draft's CRs to the sandbox (`preview.mode:
 * sandbox-apply`) — the kind a live apply (`markPageApplied`) records as rendered. Undefined when no
 * Builder previews that way — or whose draftKind this build cannot hold (isDraftKind), never a cast.
 */
const sandboxAppliedKind = (): DraftKind | undefined => {
  const kind = builderRegistry.all().find((builder) => builder.spec.preview.mode === 'sandbox-apply')?.spec.draftKind
  return isDraftKind(kind) ? kind : undefined
}

/** What this tab knows about one record beyond its files. */
interface RecordMeta {
  /** A write of this record has landed from this tab — the next one is a PUT. */
  created: boolean
  renderedHash?: string
  threadId?: string
  state: DraftState
  publish?: { repo: string; prUrl?: string }
  /** What the last landed write carried — an identical save is skipped. */
  saved?: string
}

export interface DraftAutosave {
  /** The store's change listener — hand it to createBlueprintDraftStore / createBroadcastingDraftStore. */
  onHeldChange: DraftChangeListener
  /** The sandbox writer, or undefined when no sandbox is configured (autosave off). */
  setWriter: (writer: SandboxWriter | undefined) => void
  /** The current Autopilot thread; latched onto a record the first time it is saved. */
  setThreadId: (threadId: string | null | undefined) => void
  /** An Autopilot proposal just changed (or is about to change) the held draft: the next save may name the thread. */
  noteAgentChange: () => void
  /** Save the held draft NOW (write-ahead). Resolves when every queued save has landed or failed. Never throws. */
  flush: () => Promise<void>
  /** A Preview rendered exactly this tree: record its hash, and save. Null (nothing held): a no-op. */
  markRendered: (held: BlueprintDraftHeld | null) => Promise<void>
  /**
   * A page's live preview APPLIED these widgets (previewPageV2's afterApply). The tree they are is
   * the held page when the held page is what was applied (a person's draft, re-applied on edit); or
   * the tree an agent's proposal is about to be held as (recordPagePreview runs after the apply).
   * Either way its hash is recorded, so a page draft is not "Preview needed" forever.
   */
  markPageApplied: (widgets: readonly Record<string, unknown>[]) => Promise<void>
  /**
   * RESUME: prime this tab's memory of a record from what it stored — renderedHash, state, publish,
   * threadId, and that it EXISTS (the first save is a PUT, no POST/409 round trip). Call it just
   * before the record's files go into the store, so the save that change schedules keeps them.
   */
  seedFromRecord: (body: DraftRecordBody) => void
  /**
   * A publish of this draft LANDED: mark its record published — `<owner>/<repo>` from the claim it
   * wrote, and the change-request link when there is one — and save.
   */
  markPublished: (held: BlueprintDraftHeld, claim: PublishedClaim, deepLink?: string | null) => Promise<void>
  /** Unmount: a pending save is written now rather than dropped. */
  dispose: () => void
}

export interface DraftAutosaveOptions {
  debounceMs?: number
  now?: () => Date
  /** Who is saving — read at every save (the login payload can arrive after the provider mounts). */
  username?: () => string | undefined
}

/** The slice of a landed publish's claim (PublishStatusClaim) the record keeps. */
export interface PublishedClaim { target: { owner: string; repo: string } }

/** Where a landed publish went, as the record keeps it. */
export const publishedTo = (claim: PublishedClaim, deepLink: string | null | undefined): { repo: string; prUrl?: string } => ({
  repo: `${claim.target.owner}/${claim.target.repo}`,
  ...(deepLink ? { prUrl: deepLink } : {}),
})

const keyOf = (held: Pick<BlueprintDraftHeld, 'files' | 'kind'>): string => `${held.kind}:${draftRecordDisplayName(held)}`

/** What a save carries besides updatedAt — an identical one is skipped. */
const fingerprintOf = (files: Record<string, string>, meta: RecordMeta): string =>
  JSON.stringify([treeHash(files), meta.renderedHash, meta.threadId, meta.state, meta.publish])

export const createDraftAutosave = (options: DraftAutosaveOptions = {}): DraftAutosave => {
  const debounceMs = options.debounceMs ?? DRAFT_AUTOSAVE_DEBOUNCE_MS
  const now = options.now ?? (() => new Date())
  const username = options.username ?? (() => getUserInfo().username)

  let writer: SandboxWriter | undefined
  let threadId: string | undefined
  /** Set by noteAgentChange, spent by the next save: only an agent's change attributes a draft to the thread. */
  let agentChanged = false
  /** The held draft as the store last announced it. */
  let latest: BlueprintDraftHeld | null = null
  /** The draft a debounce timer is waiting to save. */
  let pending: BlueprintDraftHeld | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const metas = new Map<string, RecordMeta>()
  /**
   * ONE SAVE AT A TIME. A POST still on the wire when the next save starts would make that one a
   * POST too (the record is not `created` yet) — two creates, one 409 — and two PUTs in flight can
   * land out of order, leaving the older tree stored. Chaining makes the last save the last write.
   */
  let chain: Promise<void> = Promise.resolve()

  const metaOf = (key: string): RecordMeta => {
    let meta = metas.get(key)
    if (!meta) {
      meta = { created: false, state: 'open' }
      metas.set(key, meta)
    }
    return meta
  }

  /** Status belongs to the draft on screen: a flushed save of the draft just replaced says nothing. */
  const report = (held: BlueprintDraftHeld, status: Parameters<typeof draftSaveStatus.set>[0]): void => {
    if (latest && keyOf(latest) === keyOf(held)) {
      draftSaveStatus.set(status)
    }
  }

  const send = async (verb: 'POST' | 'PUT', name: string, namespace: string, payload: Record<string, unknown>, target: SandboxWriter): Promise<{ ok: boolean; status: number; message: string }> => {
    try {
      const results = await target.handleActionSet(
        [{ path: buildSetOpPath({ gvr: CONFIGMAPS, name, namespace, verb }), payload, verb }],
        { silent: true, skipConfirmForSandbox: namespace, skipRevalidate: true },
      )
      const [result] = results ?? []
      return result ?? { message: 'the write was not dispatched', ok: false, status: 0 }
    } catch (error) {
      return { message: error instanceof Error ? error.message : String(error), ok: false, status: 0 }
    }
  }

  const write = async (held: BlueprintDraftHeld): Promise<void> => {
    const target = writer
    if (!target) {
      return
    }
    const key = keyOf(held)
    const meta = metaOf(key)
    if (meta.threadId === undefined && threadId && agentChanged) {
      meta.threadId = threadId
    }
    agentChanged = false
    const displayName = draftRecordDisplayName(held)
    const { kind }: { kind: DraftKind } = held
    const fingerprint = fingerprintOf(held.files, meta)
    if (meta.created && meta.saved === fingerprint) {
      return
    }
    const owner = draftOwner(username())
    const namespace = target.sandboxNamespace
    const body: DraftRecordBody = {
      files: held.files,
      kind,
      name: displayName,
      state: meta.state,
      updatedAt: now().toISOString(),
      version: DRAFT_RECORD_VERSION,
      ...(meta.renderedHash ? { renderedHash: meta.renderedHash } : {}),
      ...(meta.threadId ? { threadId: meta.threadId } : {}),
      ...(meta.publish ? { publish: meta.publish } : {}),
    }
    const configMap = draftRecordConfigMap(namespace, owner, body)
    const name = draftRecordName(kind, owner, displayName)
    report(held, { kind, phase: 'saving' })
    let result = await send(meta.created ? 'PUT' : 'POST', name, namespace, configMap, target)
    if (!meta.created && result.status === 409) {
      result = await send('PUT', name, namespace, configMap, target)
    } else if (meta.created && result.status === 404) {
      result = await send('POST', name, namespace, configMap, target)
    }
    if (result.ok) {
      meta.created = true
      meta.saved = fingerprint
      report(held, { kind, phase: 'saved', savedAt: body.updatedAt })
      return
    }
    report(held, { kind, phase: 'error', reason: result.message || `HTTP ${result.status}` })
  }

  const enqueue = (held: BlueprintDraftHeld): Promise<void> => {
    chain = chain.then(() => write(held)).catch(() => undefined)
    return chain
  }

  const cancelTimer = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** The save a timer was waiting for, written now. */
  const drainPending = (): void => {
    cancelTimer()
    if (pending) {
      const draft = pending
      pending = null
      void enqueue(draft)
    }
  }

  const schedule = (held: BlueprintDraftHeld): void => {
    cancelTimer()
    pending = held
    timer = setTimeout(() => {
      timer = null
      drainPending()
    }, debounceMs)
  }

  /**
   * Record a rendered tree's hash on its record. Saved NOW when it is the held draft; otherwise the
   * hash waits in this tab's memory for the store change that holds it (an agent's page proposal is
   * held only after its apply), whose save carries it.
   */
  const markRenderedTree = (tree: Pick<BlueprintDraftHeld, 'files' | 'kind'>): Promise<void> => {
    const key = keyOf(tree)
    metaOf(key).renderedHash = treeHash(tree.files)
    if (!writer || !latest || keyOf(latest) !== key) {
      return chain
    }
    if (pending && keyOf(pending) === key) {
      cancelTimer()
      pending = null
    }
    return enqueue(latest)
  }

  const onHeldChange: DraftChangeListener = (held) => {
    const previous = latest
    latest = held
    if (!writer) {
      return
    }
    if (!held) {
      // CLOSE IS NOT DISCARD: the last edits are written, and the record stays.
      drainPending()
      return
    }
    // A DIFFERENT draft replaced this one: the replaced draft's pending save is its own, written now
    // under its own name, before the new one's timer starts.
    if (pending && keyOf(pending) !== keyOf(held)) {
      drainPending()
    }
    if (!previous || keyOf(previous) !== keyOf(held)) {
      draftSaveStatus.set({ kind: held.kind, phase: 'idle' })
    }
    schedule(held)
  }

  return {
    dispose: drainPending,
    flush: () => {
      cancelTimer()
      pending = null
      if (latest && writer) {
        return enqueue(latest)
      }
      return chain
    },
    markPageApplied: (widgets) => {
      const kind = sandboxAppliedKind()
      if (!kind) { return chain }
      const sameWidgets = latest?.kind === kind && JSON.stringify(pageDraftWidgets(latest.files)) === JSON.stringify(widgets)
      const files = sameWidgets && latest ? latest.files : pageDraftFiles(widgets)
      return files ? markRenderedTree({ files, kind }) : chain
    },
    markPublished: (held, claim, deepLink) => {
      const meta = metaOf(keyOf(held))
      meta.state = 'published'
      meta.publish = publishedTo(claim, deepLink)
      if (pending && keyOf(pending) === keyOf(held)) {
        cancelTimer()
        pending = null
      }
      return writer ? enqueue(latest && keyOf(latest) === keyOf(held) ? latest : held) : chain
    },
    markRendered: (held) => (held ? markRenderedTree(held) : chain),
    noteAgentChange: () => { agentChanged = true },
    onHeldChange,
    seedFromRecord: (body) => {
      const meta = metaOf(keyOf(body))
      meta.created = true
      meta.state = body.state
      meta.renderedHash = body.renderedHash
      meta.threadId = body.threadId
      meta.publish = body.publish
      // What the record already holds: holding it again is not a change worth a write.
      meta.saved = fingerprintOf(body.files, meta)
    },
    setThreadId: (id) => { threadId = id ?? undefined },
    setWriter: (next) => {
      const was = writer
      writer = next
      if (!next) {
        cancelTimer()
        pending = null
        draftSaveStatus.set({ phase: 'off' })
        return
      }
      // The config arrived after a draft was already held: it has never been saved — save it.
      if (!was) {
        draftSaveStatus.set(latest ? { kind: latest.kind, phase: 'idle' } : { phase: 'idle' })
        if (latest) {
          schedule(latest)
        }
      }
    },
  }
}

/**
 * The provider's half: keep the writer and the thread current, and write a pending save on unmount.
 * The autosave itself is built in a useState initializer BEFORE the store, so the store can be handed
 * its listener at construction.
 */
export const useDraftAutosave = (
  autosave: DraftAutosave,
  sandboxWriter: SandboxWriter | undefined,
  threadId?: string | null,
): void => {
  useEffect(() => { autosave.setWriter(sandboxWriter) }, [autosave, sandboxWriter])
  useEffect(() => { autosave.setThreadId(threadId) }, [autosave, threadId])
  useEffect(() => () => autosave.dispose(), [autosave])
}
