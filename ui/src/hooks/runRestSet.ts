/**
 * runRestSet — the P1 "applySet" fabric: the ORDERED multi-object write capability that
 * replaces the vetoed snowplow /callset CLIENT-SIDE. HARD RULE honoured here: ZERO
 * snowplow changes — a set is N sequential calls to the EXISTING endpoint, each shaped
 * exactly like the single-write path `runRest` fires (same base URL, same Bearer auth).
 *
 * Semantics (the W0-4 contract):
 *   1. ONE aggregated set-level blast radius (buildBlastRadiusSet: total count + per-op
 *      verb/GVR/namespace/name + payload previews + per-op `irreversible` for DELETE)
 *      → ONE ctx.confirm for the WHOLE set. Decline = NOTHING dispatched (returns null).
 *   2. On confirm: ops dispatch SEQUENTIALLY in index order. STOP ON FIRST ERROR — an op
 *      after a failure is never attempted (no result entry for it).
 *   3. Returns per-item results [{index, ok, status, message}] for the ops that ran.
 *   4. Honest partial-state reporting: full success → one toast with the count; a failure
 *      → one toast naming EXACTLY which op failed, how many were already applied (they
 *      are NOT rolled back), and that the remaining ops were NOT executed.
 *
 * Sibling of `runRest` (useHandleActions.ts hosts every scalar run* handler; this set
 * fabric lives in its own module only for the max-lines budget). The two modules
 * reference each other at CALL TIME only, so the import cycle is inert under ESM.
 */

import { buildBlastRadiusSet, parseTargetFromPath, type WriteOp } from '../components/BlastRadius/buildBlastRadius'
import { redactSecretValues } from '../utils/secretFields'

import { recordProvenance, type WriteOrigin } from './provenance'
import type { ActionContext } from './useHandleActions'
import { fetchWithTimeout, parseJsonResponse, POST_WRITE_REVALIDATE_DELAYS_MS } from './useHandleActions'

export type { WriteOp }

/**
 * Dispatch options for the previewPage v2 SANDBOX flow (Addendum A.2.3) — the ONLY
 * caller that may relax the fabric's defaults. Every other set keeps the full gate.
 */
export interface SetDispatchOptions {
  /**
   * Skip the aggregated blast-radius confirm IFF every op targets EXACTLY this
   * namespace (parsed from the op's own /call path — never trusted from the caller's
   * op list). The sandbox is quarantined, quota-bounded, TTL-swept and OUTSIDE every
   * Helm release, and the set is still agent-audited (provenance is UNAFFECTED), so
   * preview stays friction-light. ANY op outside the namespace ⇒ the full gate runs.
   */
  skipConfirmForSandbox?: string
  /**
   * Suppress the outcome toasts (the caller owns the surface — e.g. the preview
   * drawer renders success/failure as content). The confirm gate, provenance record,
   * per-item results and post-write query invalidation are UNAFFECTED.
   */
  silent?: boolean
  /**
   * Skip the post-write query invalidation. For a write NOTHING ON SCREEN READS — a draft record's
   * autosave, every ~2 s while someone edits. Invalidating every query on each of those would
   * refetch every widget on the page for a ConfigMap none of them shows. The confirm gate,
   * provenance record and per-item results are UNAFFECTED.
   */
  skipRevalidate?: boolean
}

/**
 * True iff EVERY op's own write path targets exactly `namespace` — the A.2.3
 * confirm-skip predicate, computed from the paths (the same source the human
 * confirm would show), so a caller cannot smuggle an out-of-sandbox op past the
 * gate by mislabeling its op list.
 */
export const isSetConfinedToNamespace = (ops: readonly WriteOp[], namespace: string): boolean =>
  ops.length > 0 && ops.every((op) => parseTargetFromPath(op.path)?.namespace === namespace)

/** Per-item outcome of a set dispatch. `index` is the op's position in the ordered set. */
export interface WriteOpResult {
  index: number
  ok: boolean
  /** HTTP status of the response; 0 when the request itself failed (network error / timeout abort). */
  status: number
  message: string
}

/**
 * The slice of ActionContext the fabric needs (type-only — the hook passes its real ctx).
 * Keeping it a Pick documents the surface: the gate (confirm), the write path (base URL +
 * token), and the aftermath (notify + invalidate + unmount-safe revalidation timers).
 */
export type RunRestSetContext = Pick<
  ActionContext,
  'apiBaseUrl' | 'confirm' | 'getAccessToken' | 'invalidateQueries' | 'message' | 'notification' | 'provenanceEnabled' | 'registerCleanup' | 'setLoading'
>

/** The op's request Content-Type: merge-patch for PATCH (apiserver semantics), JSON otherwise. */
const contentTypeOf = (verb: WriteOp['verb']): string =>
  (verb === 'PATCH' ? 'application/merge-patch+json' : 'application/json')

/** Human identity of one op for the failure toast (e.g. "DELETE fireworksapps/my-app"). */
const opLabel = (op: { verb: string; gvr: { resource: string }; name?: string }): string =>
  `${op.verb} ${op.gvr.resource || 'object'}${op.name ? `/${op.name}` : ''}`

/** Dispatch ONE op through the same fetch path runRest uses; never throws (errors → result). */
const dispatchOp = async (op: WriteOp, index: number, ctx: RunRestSetContext): Promise<WriteOpResult> => {
  try {
    const res = await fetchWithTimeout(ctx.apiBaseUrl + op.path, {
      // Same body rule as runRest: only POST/PUT/PATCH carry one (DELETE never does).
      body: op.verb === 'DELETE' ? undefined : JSON.stringify(op.payload ?? {}),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${ctx.getAccessToken()}`,
        'Content-Type': contentTypeOf(op.verb),
      },
      method: op.verb,
    })
    const body = parseJsonResponse(await res.text())
    const message = body.message ?? (res.ok ? 'OK' : `HTTP ${res.status}`)
    // A form with secret fields: an apiserver message can quote the value ("Invalid value: …").
    return { index, message: op.secretValues ? redactSecretValues(message, op.secretValues) : message, ok: res.ok, status: res.status }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { index, message: op.secretValues ? redactSecretValues(message, op.secretValues) : message, ok: false, status: 0 }
  }
}

/**
 * Run an ORDERED write-set behind ONE aggregated W0-2 confirm. Returns null when the set
 * is empty or the human declines (nothing was dispatched); otherwise the per-item results
 * of the ops that ran (stop-on-first-error: a failed op is the last entry). `origin` is
 * the W0-3 provenance tag (absent = {actor:'human'}).
 */
export const runRestSet = async (ops: readonly WriteOp[], ctx: RunRestSetContext, origin?: WriteOrigin, options?: SetDispatchOptions): Promise<WriteOpResult[] | null> => {
  if (ops.length === 0) {
    return null
  }

  // The W0-4 gate: ONE confirm for the WHOLE set. Decline → nothing is dispatched.
  // A.2.3 carve-out: the confirm is skipped ONLY when the caller named the preview
  // sandbox AND every op's own path is confined to it (verified here, not trusted) —
  // any op outside the sandbox falls back to the full gate. Provenance still records.
  const radius = buildBlastRadiusSet(ops)
  const sandboxConfined = options?.skipConfirmForSandbox !== undefined
    && isSetConfinedToNamespace(ops, options.skipConfirmForSandbox)
  if (!sandboxConfined && !(await ctx.confirm(radius))) {
    ctx.setLoading(false)

    return null
  }

  // W0-3 provenance: requestedAt covers the whole ordered dispatch (pre-dispatch timestamp).
  const requestedAt = new Date().toISOString()

  ctx.setLoading(true)
  const results: WriteOpResult[] = []
  try {
    for (const [index, op] of ops.entries()) {
      // eslint-disable-next-line no-await-in-loop -- ORDERED dispatch is the contract: op N+1 must not fire until op N succeeded
      const result = await dispatchOp(op, index, ctx)
      results.push(result)
      if (!result.ok) {
        break
      }
    }
  } finally {
    ctx.setLoading(false)
  }

  const failed = results.find((result) => !result.ok)
  // With secret fields in play the AUDIT RECORD (a cluster object) keeps only the HTTP status of a
  // failure — never the apiserver's message, even scrubbed. The toast keeps the scrubbed message.
  const auditDetail = (result: WriteOpResult): string => (ops.some((op) => op.secretValues) ? `HTTP ${result.status}` : result.message)

  // W0-3 provenance: ONE AuditRecord per SET (count = ops.length; the summary lists every
  // op) — never per op — emitted after the set resolves (full success OR stop-on-first-
  // error). The gated set radius is reused verbatim. Fire-and-forget inside
  // recordProvenance; a declined confirm returned above, so it records NOTHING.
  recordProvenance(ctx, origin, radius, failed
    ? { message: `op ${failed.index + 1} of ${ops.length} (${opLabel(radius.ops[failed.index])}) failed: ${auditDetail(failed)}`, ok: false, status: failed.status }
    : { message: `all ${ops.length} writes applied in order`, ok: true, status: results[results.length - 1]?.status ?? 0 },
  requestedAt)

  // `silent` (previewPage v2): the caller renders the outcome itself (drawer content /
  // chip) — suppress ONLY the toasts; results, provenance and invalidation are intact.
  if (!options?.silent) {
    ctx.message.destroy()
    if (!failed) {
      ctx.notification.success({
        description: `All ${ops.length} write${ops.length === 1 ? '' : 's'} applied in order.`,
        message: 'Write set applied',
        placement: 'bottomLeft',
      })
    } else {
      // Honest partial-state reporting: name the failed op, count what was already applied
      // (NOT rolled back), and state that the remaining ops were NOT executed.
      const applied = failed.index
      const remaining = ops.length - failed.index - 1
      const appliedText = applied > 0
        ? `The first ${applied} op${applied === 1 ? ' was' : 's were'} already applied (not rolled back).`
        : 'No ops were applied.'
      const remainingText = remaining > 0
        ? ` The remaining ${remaining} op${remaining === 1 ? ' was' : 's were'} NOT executed.`
        : ''
      ctx.notification.error({
        description: `Op ${failed.index + 1} of ${ops.length} (${opLabel(radius.ops[failed.index])}) failed: ${failed.message}. ${appliedText}${remainingText}`,
        message: applied > 0 ? 'Write set partially applied' : 'Write set not applied',
        placement: 'bottomLeft',
      })
    }
  }

  // Converge the UI after any applied write — same immediate + staggered background
  // re-invalidation runRest uses (snowplow's informer read can lag the write).
  if (!options?.skipRevalidate && results.some((result) => result.ok)) {
    await ctx.invalidateQueries()
    for (const ms of POST_WRITE_REVALIDATE_DELAYS_MS) {
      const timer = setTimeout(() => { void ctx.invalidateQueries() }, ms)
      ctx.registerCleanup(() => clearTimeout(timer))
    }
  }

  return results
}
