/**
 * W4 previewPage v2 (FE-P4) — the SANDBOX LIVE PREVIEW orchestrator (Addendum A.2).
 * Config-gated by api.PREVIEW_SANDBOX_NAMESPACE: the bridge routes `previewPage` here
 * ONLY when the sandbox is configured — absent config, the verb stays the v1
 * zero-network source preview (previewHandlers.ts) EXACTLY. The verb SHAPE is
 * unchanged ({"verb":"previewPage","widgets":[…]} — no prompt churn).
 *
 * The flow (each step falls back to a graceful chip + the source drawer, never a crash):
 *   1. VALIDATE (A.2.1): every draft against its co-located widget schema (ajv) —
 *      any failure → the v1 source drawer WITH the verdicts; garbage is never applied.
 *   2. REWRITE (A.2.2): namespace FORCED to the sandbox, names OWNER-SCOPED, preview + owner
 *      labels stamped, in-set refs re-pointed (previewSandbox.rewriteDraftsForSandbox).
 *   3. APPLY + SWEEP (A.2.3): ordered chunks (≤10 ops) through the SAME runRestSet fabric —
 *      a POST for each name this tab has not written, then an in-place merge PATCH for each
 *      name it has (an object that exists before and after an edit is never deleted, so the
 *      rendered page never shows it "Not found"); a POST that meets an orphan under its name
 *      (a crashed tab's) becomes a PATCH, a PATCH that finds its object gone becomes a POST.
 *      THEN a best-effort DELETE of only the names the previous preview wrote that this one
 *      no longer does. Per-user identity, ONE AuditRecord per
 *      chunk, stop-on-error. The aggregated confirm is SKIPPED because every op is
 *      confined to the quarantined sandbox (verified per-op by the fabric itself —
 *      see SetDispatchOptions.skipConfirmForSandbox); provenance is STILL emitted.
 *   4. RENDER (A.2.4): the drawer opens on the ROOT draft's REAL `widgetEndpoint` —
 *      the deployed snowplow compiles spec→status and resolves children exactly like
 *      a production page ("Rendered (live)" + the source view, previewSurface.tsx).
 *   5. TEARDOWN (A.2.5): drawer close → best-effort silent DELETE set of THIS
 *      preview's drafts (epoch-guarded: a stale close never deletes a newer preview);
 *      the sandbox TTL janitor (CHART-SBX) is the backstop.
 */

import type { SetDispatchOptions, WriteOp, WriteOpResult } from '../../hooks/runRestSet'
import { getAccessToken } from '../../utils/getAccessToken'
import { getUserInfo } from '../../utils/getUserInfo'

import type { PortalActionProposal } from './actionBridge'
import { type ApplyResourceSetOp, buildSetOpPath, isApplySetAllowed, MAX_APPLY_SET_OPS } from './applyResourceSet'
import { draftOwner } from './draftRecord'
import { buildPagePreviewPayload, parsePagePreviewArgs } from './previewBridge'
import { openAutopilotPreview, setPreviewProblems, setPreviewRender } from './previewBus'
import {
  buildSandboxTeardownOps,
  buildSandboxWidgetEndpoint,
  chunkSetOps,
  type DraftTarget,
  draftTargetsOf,
  type PreviewPageSession,
  rewriteDraftsForSandbox,
  rootChildRefIdsOf,
  rootDraftTargetOf,
  validatePageDrafts,
} from './previewSandbox'
import type { AutopilotActionChip } from './types'

/** What the v2 flow needs from the bridge: the sandbox, the thread id, the session,
 * and the hook's REAL set dispatcher (origin already bound by the bridge). */
export interface PreviewPageV2Deps {
  sandboxNamespace: string
  /** The provider's thread/session id — stamped as the per-session draft label. */
  sessionId: string
  /** The provider-scoped teardown session (epoch-guarded drawer-close deletes). */
  session: PreviewPageSession
  handleActionSet: (ops: readonly WriteOp[], options?: SetDispatchOptions) => Promise<WriteOpResult[] | null>
  /** snowplow base URL for the A.2.35 warm-up gate (absent → the gate is skipped). */
  snowplowBaseUrl?: string
  /**
   * WRITE-AHEAD: save the held draft's record before the sandbox is touched, so a tab killed
   * mid-apply has already stored what it was previewing (useDraftAutosave.flush). Never throws.
   */
  beforeApply?: () => Promise<unknown>
  /**
   * The preview SUCCEEDED: every draft applied and the root warmed up. Called once, with the widgets
   * as proposed, so the draft record can record the tree that rendered (useDraftAutosave
   * .markPageApplied). Never on a blocked or failed preview. Must not throw.
   */
  afterApply?: (widgets: Record<string, unknown>[]) => unknown
}

/**
 * A.2.35 — the sandbox INFORMER WARM-UP GATE. snowplow serves widgets from its informer
 * cache: opening the drawer the instant the sandbox POSTs land RACES the ingest, and a
 * PARTIAL root serve (some children not yet resolved into status.resourcesRefs) gets
 * react-query-cached — the page then renders partially FOREVER (the silent "only the
 * first widget shows" page). Poll the root's REAL serve until every declared child id is
 * resolved, or the bounded timeout passes (then open anyway — the renderer's own
 * error/Retry surface is the fallback). Returns whether the serve warmed up in time.
 */
export const awaitSandboxWarmup = async (
  snowplowBaseUrl: string,
  root: DraftTarget,
  expectedChildIds: readonly string[],
  sandboxNamespace: string,
  timeoutMs = 20000,
): Promise<boolean> => {
  const url = `${snowplowBaseUrl.replace(/\/+$/, '')}${buildSandboxWidgetEndpoint(root, sandboxNamespace)}`
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop -- a poll loop is sequential by nature
      const response = await fetch(url, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
      if (response.ok) {
        // eslint-disable-next-line no-await-in-loop -- poll loop
        const body = await response.json() as { status?: { resourcesRefs?: { items?: { id?: unknown }[] } } }
        const served = new Set((body.status?.resourcesRefs?.items ?? [])
          .map((item) => (typeof item.id === 'string' ? item.id : ''))
          .filter(Boolean))
        if (expectedChildIds.every((id) => served.has(id))) {
          return true
        }
      }
    } catch {
      // transient — the poll loop IS the retry
    }
    if (Date.now() >= deadline) {
      return false
    }
    // eslint-disable-next-line no-await-in-loop -- poll loop
    await new Promise((resolve) => { setTimeout(resolve, 1500) })
  }
}

/** The DRAWER caption of a LIVE sandbox preview (A.2.4). Named for its surface — see below. */
export const LIVE_PREVIEW_CAPTION
  = 'Live preview — the drafts are applied to the quarantined preview sandbox and rendered by the real server, with your identity and permissions. Closing this drawer removes them.'

/**
 * The same explanation for the COMPOSER, which embeds the preview inline and has no drawer.
 *
 * The sentence above ends "Closing this drawer removes them", and the composer was showing it
 * verbatim in the lower half of its split — describing a control that is not on the reader's
 * screen. Theirs is "Close draft", and saying so is the difference between an explanation and a
 * puzzle.
 */
export const LIVE_PREVIEW_CAPTION_INLINE
  = 'Live preview — this draft is applied to the quarantined preview sandbox and rendered by the real server, with your identity and permissions. Closing the draft removes it.'

const compileWriteOps = (ops: readonly ApplyResourceSetOp[]): WriteOp[] =>
  ops.map((op) => ({
    path: buildSetOpPath(op),
    verb: op.verb,
    ...(op.payload === undefined ? {} : { payload: op.payload }),
  }))

/**
 * Fire a SILENT sandbox set (teardown/sweep) and REPORT what happened.
 *
 * It used to return void, and that single fact is what broke preview re-entry. `handleActionSet`
 * does not throw when the server refuses an op — it resolves with a per-op
 * `{ok, status, message}`. So a DELETE the apiserver rejected was indistinguishable from one that
 * worked, the `catch` here caught nothing, and the very next line POSTed the same name. The file's
 * own contract promises "re-used names never 409"; it could not keep that promise while the only
 * evidence of the sweep was discarded.
 *
 * Still best-effort in the sense that a failed delete does not abort the preview — the TTL janitor
 * remains the backstop. What changes is that the caller can now SEE it and act, which is what
 * `applyWithReclaim` below does.
 */
const dispatchSilent = async (
  ops: readonly ApplyResourceSetOp[],
  deps: PreviewPageV2Deps,
): Promise<WriteOpResult[] | null> => {
  if (!ops.length) {
    return []
  }
  try {
    return await deps.handleActionSet(
      compileWriteOps(ops),
      { silent: true, skipConfirmForSandbox: deps.sandboxNamespace },
    )
  } catch {
    // A thrown dispatch (network/abort) is still not the preview's problem to escalate.
    return null
  }
}

/** Kept for the teardown call sites, whose only contract is "try, never escalate". */
const dispatchBestEffort = async (ops: readonly ApplyResourceSetOp[], deps: PreviewPageV2Deps): Promise<void> => {
  await dispatchSilent(ops, deps)
}

/**
 * WHAT THIS TAB LAST APPLIED, per sandbox object: the base an in-place update diffs against.
 *
 * WHY, from the recordings. Every composer edit (a drop, a bind) re-applies the whole page. The
 * apply used to DELETE every name it was about to write and then POST it again, and the rendered
 * page, still mounted on the same root endpoint and invalidated by the sweep's own write, refetched
 * in between: for seconds the Rendered tab showed `pageheaders … "page-…-header-…" not found` for a
 * PageHeader the edit never touched. An object that exists before and after an edit is now PATCHed
 * where it stands, so there is no moment in which it does not exist.
 *
 * A merge patch cannot remove a field by leaving it out, so the patch nulls every key the previous
 * apply wrote and this one does not. That needs the previous payload, kept here per session so two
 * providers never read each other's. An object this tab did not write (a crashed tab's orphan being
 * adopted) has no base, and is patched with the new payload as it is.
 */
const appliedBySession = new WeakMap<PreviewPageSession, Map<string, Record<string, unknown>>>()

const targetKey = ({ gvr, name }: Pick<DraftTarget, 'gvr' | 'name'>): string => `${gvr.group}/${gvr.resource}/${name}`

const appliedOf = (session: PreviewPageSession): Map<string, Record<string, unknown>> => {
  let applied = appliedBySession.get(session)
  if (!applied) {
    applied = new Map()
    appliedBySession.set(session, applied)
  }

  return applied
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * The RFC 7396 merge patch that turns `previous` into `next`: every key of `next` (objects
 * recursed, arrays and scalars replaced whole), plus a `null` for every key only `previous` had.
 */
export const mergePatchOf = (next: unknown, previous: unknown): unknown => {
  if (!isPlainObject(next) || !isPlainObject(previous)) {
    return next
  }
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(previous)) {
    if (!(key in next)) {
      patch[key] = null
    }
  }
  for (const [key, value] of Object.entries(next)) {
    patch[key] = mergePatchOf(value, previous[key])
  }

  return patch
}

/** One write of the apply, with the draft it writes (a retry rebuilds the op from it). */
interface ApplyEntry {
  op: ApplyResourceSetOp
  target: DraftTarget
  cr: Record<string, unknown>
}

const ALREADY_EXISTS = /already exists/i
const NOT_FOUND = /not found/i

type Draft = Pick<ApplyEntry, 'cr' | 'target'>

const postOf = ({ cr, target }: Draft, sandboxNamespace: string): ApplyResourceSetOp =>
  ({ gvr: target.gvr, name: target.name, namespace: sandboxNamespace, payload: cr, verb: 'POST' })

const patchOf = ({ cr, target }: Draft, sandboxNamespace: string, previous?: Record<string, unknown>): ApplyResourceSetOp =>
  ({ gvr: target.gvr, name: target.name, namespace: sandboxNamespace, payload: mergePatchOf(cr, previous), verb: 'PATCH' })

/**
 * The one retry a refused write gets, or null when a retry is no answer to the refusal.
 *
 * A create that finds its name taken becomes an in-place update. That is safe because the name IS
 * the provenance: sandbox names are owner-scoped (sandboxDraftName), so whatever holds one is this
 * person's own earlier preview, typically one a killed tab never tore down. An update that finds
 * its object gone (the TTL janitor, another tab's discard) becomes a create. Neither deletes the
 * object to make room: that delete is the window the rendered page used to fall into.
 *
 * One retry, never a loop: a refusal that survives it is a different fault and must surface.
 */
const retryOf = (entry: ApplyEntry, result: WriteOpResult, sandboxNamespace: string): ApplyResourceSetOp | null => {
  if (entry.op.verb === 'POST' && (result.status === 409 || ALREADY_EXISTS.test(result.message))) {
    return patchOf(entry, sandboxNamespace)
  }
  if (entry.op.verb === 'PATCH' && (result.status === 404 || NOT_FOUND.test(result.message))) {
    return postOf(entry, sandboxNamespace)
  }

  return null
}

/**
 * Dispatch the ordered entries in ≤10-op chunks. The fabric stops a chunk at its first refusal; a
 * refusal `retryOf` answers is retried once on its own, and the chunk resumes after it. Returns what
 * landed and, when something did not, why.
 */
const dispatchEntries = async (
  entries: readonly ApplyEntry[],
  deps: PreviewPageV2Deps,
): Promise<{ applied: DraftTarget[]; failure: string | null }> => {
  const applied: DraftTarget[] = []
  for (let start = 0; start < entries.length; start += MAX_APPLY_SET_OPS) {
    let pending = entries.slice(start, start + MAX_APPLY_SET_OPS)
    while (pending.length) {
      const chunk = pending
      // eslint-disable-next-line no-await-in-loop -- ordered chunks: chunk N+1 must not fire until N succeeded (same contract as the fabric)
      const results = await deps.handleActionSet(
        compileWriteOps(chunk.map(({ op }) => op)),
        { silent: true, skipConfirmForSandbox: deps.sandboxNamespace },
      )
      if (results === null) {
        return { applied, failure: 'the write set was not dispatched' }
      }
      applied.push(...results.filter(({ ok }) => ok).map(({ index }) => chunk[index].target))
      const refused = results.find(({ ok }) => !ok)
      if (!refused) {
        break
      }
      const entry = chunk[refused.index]
      const label = `${entry.target.kind}/${entry.target.name}`
      const retry = retryOf(entry, refused, deps.sandboxNamespace)
      if (!retry) {
        return { applied, failure: `${label}: ${refused.message}` }
      }
      // eslint-disable-next-line no-await-in-loop -- one name at a time: the retry must land before the chunk resumes
      const [retried] = (await dispatchSilent([retry], deps)) ?? []
      if (!retried?.ok) {
        // The ORIGINAL refusal says what is in the way; the retry's says why it could not be updated.
        return { applied, failure: `${label}: ${refused.message}${retried ? ` (retry: ${retried.message})` : ''}` }
      }
      applied.push(entry.target)
      pending = chunk.slice(refused.index + 1)
    }
  }

  return { applied, failure: null }
}

/**
 * A DISCARD, not a drawer close: delete whatever live preview is applied, whichever surface's
 * payload rendered it. The payload's own close is epoch-guarded and reaches only the render that
 * payload came with — a composer that mounted after the render was applied never had it.
 */
export const discardPreviewSandbox = async (deps: PreviewPageV2Deps): Promise<void> => {
  appliedOf(deps.session).clear()
  await dispatchBestEffort(deps.session.take(), deps)
}

/** The graceful-failure chip + source drawer (never a crash, nothing left behind claims). */
const blockedChip = (label: string): AutopilotActionChip => ({ label, readOnly: true, verb: 'previewPage' })

/**
 * The previewPage v2 handler. Returns the chip to render, or null ONLY for a
 * malformed proposal (denied exactly like v1's argSchema). Every later failure is
 * a graceful chip + drawer content — the model can read it and fix the drafts.
 */
export const applyPreviewPageV2 = async (
  proposal: PortalActionProposal,
  deps: PreviewPageV2Deps,
): Promise<AutopilotActionChip | null> => {
  const widgets = parsePagePreviewArgs(proposal)
  if (!widgets) {
    return null
  }
  // Whatever the last preview rendered is no longer what will be on screen.
  setPreviewRender(null)

  // 1. VALIDATE — any failure: source drawer with the verdicts, NOTHING applied.
  const problems = await validatePageDrafts(widgets, deps.snowplowBaseUrl)
  if (problems.length) {
    // Surface the verdicts to the CONTEXT COLLECTOR — the model self-corrects from these.
    setPreviewProblems(problems)
    openAutopilotPreview({
      ...buildPagePreviewPayload(widgets),
      caption: 'Validation failed — nothing was applied to the sandbox. Fix the drafts and preview again.',
      problems,
    })

    return blockedChip(`preview blocked — ${problems.length} validation error${problems.length === 1 ? '' : 's'}`)
  }

  // 2. REWRITE — sandbox namespace forced, names owner-scoped, labels stamped, in-set refs
  // re-pointed. The owner is the caller's, so every name below — the sweep's, the POSTs', a 409
  // reclaim's, the root the drawer mounts — is one only THIS person could have written: the
  // sandbox is shared, and a sweep derived from `targets` would otherwise delete a colleague's
  // live preview of the same page.
  const rewritten = rewriteDraftsForSandbox(widgets, deps.sandboxNamespace, deps.sessionId, draftOwner(getUserInfo().username))
  const targets = draftTargetsOf(rewritten)
  const root = rootDraftTargetOf(targets)
  if (!root) {
    openAutopilotPreview({
      ...buildPagePreviewPayload(widgets),
      caption: 'The draft set has no `page-<slug>` root Flex — the page ENTRY (its INIT) is undefined, so nothing was applied. Author the root Flex named page-<slug> listing the children and preview again.',
    })

    return blockedChip('preview blocked — no page-<slug> root Flex (the page entry) in the draft set')
  }

  // 3. APPLY + SWEEP.
  //
  // An EDIT NEVER DELETES WHAT IT KEEPS. The apply used to sweep (DELETE) every name it was about
  // to write and then POST them all again; the rendered page refetched in the gap and showed "Not
  // found" cards for widgets the edit never touched (the composer re-applies on every drop and
  // bind). Now each name this tab wrote last time is PATCHed in place, and each new name is POSTed,
  // before any PATCH, so a container never points at a child that is not there yet.
  //
  // Re-used names still never 409, including after a crash. A crashed or killed tab leaves its
  // drafts under the same deterministic, owner-scoped names, and this tab has no record of them: the
  // POST meets the orphan, and the orphan is ADOPTED by patching it (retryOf), not deleted to make
  // room. A 144-minute-old orphan from a killed recorder once blocked every live preview of the V4
  // demo; that stays fixed. Orphans of OTHER pages, and OTHER PEOPLE'S previews of this page, are
  // left alone: the names are owner-scoped (sandboxDraftName) and nothing here can spell theirs.
  //
  // Defensive kernel pass FIRST (all-or-nothing, before any write): every chunk must clear the
  // applyResourceSet safety kernel under the sandbox carve-out. By construction it does; a mismatch
  // means a bug, so deny outright.
  const previous = appliedOf(deps.session)
  const planned = rewritten.flatMap((cr) => draftTargetsOf([cr]).map((target): ApplyEntry => {
    const base = previous.get(targetKey(target))

    return { cr, op: base ? patchOf({ cr, target }, deps.sandboxNamespace, base) : postOf({ cr, target }, deps.sandboxNamespace), target }
  }))
  const entries = [...planned.filter(({ op }) => op.verb === 'POST'), ...planned.filter(({ op }) => op.verb !== 'POST')]
  if (!chunkSetOps(entries.map(({ op }) => op)).every((chunk) => isApplySetAllowed(chunk, deps.sandboxNamespace))) {
    return blockedChip('preview denied — drafts fall outside the sandbox write scope')
  }

  // WRITE-AHEAD: the draft record is stored before the sandbox is touched.
  await deps.beforeApply?.().catch(() => undefined)
  // What the previous preview in this tab wrote. Names this apply keeps are updated above; the rest
  // (a widget the edit removed, or a different page previewed before) are swept once it has landed.
  const held = deps.session.take()
  const { applied, failure } = await dispatchEntries(entries, deps)

  if (failure) {
    // Roll back what landed and what the previous preview left (best-effort), then show the failure
    // AS drawer content.
    previous.clear()
    const landed = new Set(applied.map(targetKey))
    await dispatchBestEffort([
      ...buildSandboxTeardownOps(applied, deps.sandboxNamespace),
      ...held.filter(({ gvr, name }) => !landed.has(targetKey({ gvr, name: name ?? '' }))),
    ], deps)

    openAutopilotPreview({
      ...buildPagePreviewPayload(widgets),
      caption: 'Applying the drafts to the preview sandbox failed — the drafts that had landed were removed (best-effort).',
      error: failure,
    })

    return { label: `preview apply failed — ${failure}`, readOnly: false, verb: 'previewPage' }
  }

  previous.clear()
  for (const { cr, target } of entries) {
    previous.set(targetKey(target), cr)
  }
  // The SWEEP: only names that left the set, and only after the container that listed them was
  // updated, so nothing still on the page ever points at a deleted object.
  await dispatchBestEffort(held.filter(({ gvr, name }) => !previous.has(targetKey({ gvr, name: name ?? '' }))), deps)

  // 3b. A.2.35 WARM-UP — hold the drawer until the ROOT serves with every child resolved
  // (see awaitSandboxWarmup: an instant open races the informer and CACHES a partial page).
  if (deps.snowplowBaseUrl) {
    const rootDraft = rewritten[targets.indexOf(root)]
    await awaitSandboxWarmup(deps.snowplowBaseUrl, root, rootChildRefIdsOf(rootDraft), deps.sandboxNamespace)
  }

  // A live preview supersedes any earlier rejection — clear the self-correction signal.
  setPreviewProblems(null)
  deps.afterApply?.(widgets)

  // 4-5. RENDER + arm the epoch-guarded drawer-close teardown.
  const epoch = deps.session.record(buildSandboxTeardownOps(applied, deps.sandboxNamespace))
  // The payload's files are built from the drafts AS AUTHORED, not from `rewritten`. They are
  // shown as the publish write set, at the paths a publish writes, and the Files tab edits the held
  // draft by those paths: built from the sandbox copy, every path would carry the owner tag, name a
  // file the held draft does not have, and promise a publish of names that exist only in the
  // sandbox. The live render is the sandbox copy; the source beside it is the page.
  openAutopilotPreview({
    ...buildPagePreviewPayload(widgets),
    caption: LIVE_PREVIEW_CAPTION,
    liveEndpoint: buildSandboxWidgetEndpoint(root, deps.sandboxNamespace),
    onClose: () => {
      const teardown = deps.session.takeIf(epoch)
      if (teardown.length) {
        // Torn down: the next preview creates, it has nothing left to update in place.
        previous.clear()
      }
      void dispatchBestEffort(teardown, deps)
    },
    title: `Page preview (live) — ${applied.length} draft${applied.length === 1 ? '' : 's'} in ${deps.sandboxNamespace}`,
  })

  const label = proposal.label ?? `live preview — ${applied.length} draft${applied.length === 1 ? '' : 's'} → ${deps.sandboxNamespace}`

  // `rendered`: the drafts are live in the sandbox and the drawer renders them — what the provider's
  // render check (previewRender.ts) keys on, structurally rather than on the label.
  return { label, readOnly: false, rendered: true, verb: 'previewPage' }
}
