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
 *   2. REWRITE (A.2.2): namespace FORCED to the sandbox, preview labels stamped,
 *      in-set refs re-pointed (previewSandbox.rewriteDraftsForSandbox).
 *   3. SWEEP + APPLY (A.2.3): best-effort DELETE of every name this apply is about to write
 *      (latest wins, re-used names never 409 — including after a crash that left orphans under
 *      those names), plus this tab's previous preview, then ordered POST chunks (≤10 ops)
 *      through the SAME runRestSet fabric — per-user identity, ONE AuditRecord per
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

import type { PortalActionProposal } from './actionBridge'
import { type ApplyResourceSetOp, buildSetOpPath, isApplySetAllowed } from './applyResourceSet'
import { buildPagePreviewPayload, parsePagePreviewArgs } from './previewBridge'
import { openAutopilotPreview, setPreviewProblems } from './previewBus'
import {
  buildSandboxApplyOps,
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

/** The drawer caption of a LIVE sandbox preview (A.2.4). */
export const LIVE_PREVIEW_CAPTION
  = 'Live preview — the drafts are applied to the quarantined preview sandbox and rendered by the real server, with your identity and permissions. Closing this drawer removes them.'

const compileWriteOps = (ops: readonly ApplyResourceSetOp[]): WriteOp[] =>
  ops.map((op) => ({
    path: buildSetOpPath(op),
    verb: op.verb,
    ...(op.payload === undefined ? {} : { payload: op.payload }),
  }))

/** Fire a best-effort SILENT sandbox set (teardown/sweep): failures are swallowed —
 * the TTL janitor is the backstop — and the confirm is skipped (sandbox-confined). */
const dispatchBestEffort = async (ops: readonly ApplyResourceSetOp[], deps: PreviewPageV2Deps): Promise<void> => {
  if (!ops.length) {
    return
  }
  try {
    await deps.handleActionSet(compileWriteOps(ops), { silent: true, skipConfirmForSandbox: deps.sandboxNamespace })
  } catch {
    // Best-effort by contract (A.2.5) — a failed delete is the janitor's problem.
  }
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

  // 1. VALIDATE — any failure: source drawer with the verdicts, NOTHING applied.
  const problems = await validatePageDrafts(widgets)
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

  // 2. REWRITE — sandbox namespace forced, labels stamped, in-set refs re-pointed.
  const rewritten = rewriteDraftsForSandbox(widgets, deps.sandboxNamespace, deps.sessionId)
  const targets = draftTargetsOf(rewritten)
  const root = rootDraftTargetOf(targets)
  if (!root) {
    openAutopilotPreview({
      ...buildPagePreviewPayload(rewritten),
      caption: 'The draft set has no `page-<slug>` root Flex — the page ENTRY (its INIT) is undefined, so nothing was applied. Author the root Flex named page-<slug> listing the children and preview again.',
    })

    return blockedChip('preview blocked — no page-<slug> root Flex (the page entry) in the draft set')
  }

  // 3. SWEEP + APPLY. Defensive kernel pass FIRST (all-or-nothing, before any write):
  // every chunk must clear the applyResourceSet safety kernel under the sandbox
  // carve-out — by construction it does; a mismatch means a bug, so deny outright.
  const chunks = chunkSetOps(buildSandboxApplyOps(rewritten, deps.sandboxNamespace))
  if (!chunks.every((chunk) => isApplySetAllowed(chunk, deps.sandboxNamespace))) {
    return blockedChip('preview denied — drafts fall outside the sandbox write scope')
  }
  // THE SWEEP COVERS WHAT WE ARE ABOUT TO WRITE, not what this session happens to remember.
  //
  // The contract at the top of this file says "re-used names never 409" — and it was not true. The
  // sweep used to be session.take() alone: the teardown ops recorded when THIS tab last previewed.
  // A crashed or killed session never records them, so its drafts survive under deterministic names
  // (page-<slug>, <name>-card...), the next preview POSTs the same names, the apiserver answers 409,
  // and the drawer falls back to the source view — reported to the user as "Applying the drafts to
  // the preview sandbox failed", or worse, mislabelled upstream as a validation problem. A 144-minute-old
  // orphan from a killed recorder blocked every subsequent live preview during the V4 demo.
  //
  // Deriving the sweep from `targets` — the exact kinds and names this apply is about to create —
  // makes re-use idempotent no matter who wrote them or whether anyone is left to remember. A
  // crashed preview is therefore ADOPTED by the next one rather than blocking it: the drafts are
  // state to resume, not garbage that happens to be in the way. Orphans of OTHER pages are left
  // alone, because nothing about them is in the way.
  //
  // session.take() is still swept: it clears a previous preview of a DIFFERENT page in this tab,
  // whose names this apply will not otherwise touch.
  await dispatchBestEffort(
    [...deps.session.take(), ...buildSandboxTeardownOps(targets, deps.sandboxNamespace)],
    deps,
  )

  const applied: DraftTarget[] = []
  let failure: string | null = null
  let offset = 0
  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop -- ordered chunks: chunk N+1 must not fire until N succeeded (same contract as the fabric)
    const results = await deps.handleActionSet(compileWriteOps(chunk), { silent: true, skipConfirmForSandbox: deps.sandboxNamespace })
    if (results === null) {
      failure = 'the write set was not dispatched'
      break
    }
    for (const result of results) {
      const target = targets[offset + result.index]
      if (result.ok) {
        applied.push(target)
      } else {
        failure = `${target.kind}/${target.name}: ${result.message}`
      }
    }
    if (failure) {
      break
    }
    offset += chunk.length
  }

  if (failure) {
    // Roll back what landed (best-effort), then show the failure AS drawer content.
    await dispatchBestEffort(buildSandboxTeardownOps(applied, deps.sandboxNamespace), deps)

    openAutopilotPreview({
      ...buildPagePreviewPayload(rewritten),
      caption: 'Applying the drafts to the preview sandbox failed — the drafts that had landed were removed (best-effort).',
      error: failure,
    })

    return { label: `preview apply failed — ${failure}`, readOnly: false, verb: 'previewPage' }
  }

  // 3b. A.2.35 WARM-UP — hold the drawer until the ROOT serves with every child resolved
  // (see awaitSandboxWarmup: an instant open races the informer and CACHES a partial page).
  if (deps.snowplowBaseUrl) {
    const rootDraft = rewritten[targets.indexOf(root)]
    await awaitSandboxWarmup(deps.snowplowBaseUrl, root, rootChildRefIdsOf(rootDraft), deps.sandboxNamespace)
  }

  // A live preview supersedes any earlier rejection — clear the self-correction signal.
  setPreviewProblems(null)

  // 4-5. RENDER + arm the epoch-guarded drawer-close teardown.
  const epoch = deps.session.record(buildSandboxTeardownOps(applied, deps.sandboxNamespace))
  openAutopilotPreview({
    ...buildPagePreviewPayload(rewritten),
    caption: LIVE_PREVIEW_CAPTION,
    liveEndpoint: buildSandboxWidgetEndpoint(root, deps.sandboxNamespace),
    onClose: () => {
      void dispatchBestEffort(deps.session.takeIf(epoch), deps)
    },
    title: `Page preview (live) — ${applied.length} draft${applied.length === 1 ? '' : 's'} in ${deps.sandboxNamespace}`,
  })

  const label = proposal.label ?? `live preview — ${applied.length} draft${applied.length === 1 ? '' : 's'} → ${deps.sandboxNamespace}`

  return { label, readOnly: false, verb: 'previewPage' }
}
