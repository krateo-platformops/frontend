/**
 * provenance — the W0-3 audit trail (frontend side): ONE immutable AuditRecord CR emitted
 * for EVERY portal write, human- or agent-originated, AFTER the write resolves (success OR
 * failure). The record carries the SAME blast radius the human confirmed at the W0-2/W0-4
 * gate (reused verbatim, never rebuilt), the origin tag (actor + the agent session/prompt
 * context when Autopilot dispatched it), the outcome, and requestedAt/resolvedAt.
 *
 * SINK: the `audit.krateo.io/v1alpha1` namespaced AuditRecord CRD (ships separately in the
 * portal chart). The record is POSTed through the SAME fetch shape `runRest` uses (snowplow
 * base URL + Bearer auth) to snowplow's `/call` endpoint — the ONLY route snowplow serves
 * writes on (it has NO raw /apis route; a raw apiserver path 404s). The target rides in
 * the query, built by buildCallWritePath:
 * /call?apiVersion=audit.krateo.io%2Fv1alpha1&resource=auditrecords&name=-&namespace=<ns>,
 * where <ns> is the WRITE's target namespace and `name` is the required-but-ignored
 * collection-POST placeholder (the record uses metadata.generateName).
 *
 * CONTRACT — STRICTLY BEST-EFFORT: emission is fire-and-forget (`void`, never awaited in
 * the user path) and ANY failure (CRD absent → 404, RBAC 403, network error) is swallowed
 * with a single console.debug. It must NEVER block, meaningfully delay, or fail the
 * primary write. A declined confirm dispatches nothing, so it records nothing. The whole
 * path is behind the PROVENANCE_ENABLED config flag (default ON; only an explicit "false"
 * opts out). On clusters without the CRD each best-effort POST 404s and is swallowed, so
 * nothing persists and nothing blocks.
 *
 * Like `runRestSet`, this module and `useHandleActions` reference each other at CALL TIME
 * only (fetchWithTimeout here; recordProvenance there), so the import cycle is inert under
 * ESM.
 */

import type { BlastRadius, BlastRadiusSet, Gvr, MutatingVerb } from './blastRadius.types'
import { buildCallWritePath } from './callPath'
import { fetchWithTimeout } from './useHandleActions'

export const AUDIT_API_GROUP = 'audit.krateo.io'
export const AUDIT_API_VERSION = 'v1alpha1'

/** The one agent that dispatches writes through the bridge today (Autopilot). */
export const AUTOPILOT_AGENT_ID = 'autopilot'

/**
 * A17 — the label that makes an agent-created object identifiable WITHOUT a join.
 *
 * The AuditRecord below already answers "who made this write", but only by querying
 * audit.krateo.io and matching on (verb, gvr, name, namespace). That is the right record for an
 * audit trail and the wrong one for the question a person actually asks, which is asked while
 * looking at the object: "did a human decide this, or did the agent?" A label answers it on the
 * object, is selectable (`-l krateo.io/created-by=autopilot`), and survives the round trips an
 * annotation-free join does not.
 *
 * A LABEL, not an annotation, precisely because it is meant to be queryable — the whole point is
 * being able to list what the agent made.
 */
export const AGENT_CREATED_LABEL = 'krateo.io/created-by'

/**
 * Stamp `krateo.io/created-by` onto an agent-originated CREATE.
 *
 * CREATE ONLY. A POST brings an object into existence and the label describes that act; a
 * PUT/PATCH edits something that already exists, and stamping there would claim the agent
 * created an object a human may well have. An object edited by the agent is a different fact, and
 * the AuditRecord is where it belongs.
 *
 * Called BEFORE the HITL gate, deliberately: the blast-radius diff the human confirms therefore
 * SHOWS this label. An agent that quietly adds a field to the body after the human approved it
 * would be doing exactly what the gate exists to prevent, even for a field as harmless as this.
 *
 * Returns a new object; never mutates the caller's payload. Leaves a non-object payload, or one
 * whose `metadata` is not an object, exactly as it found it rather than corrupting a shape it
 * does not understand.
 */
export const stampAgentCreated = (
  payload: unknown,
  verb: string,
  origin?: WriteOrigin,
): unknown => {
  if (origin?.actor !== 'agent' || verb !== 'POST') { return payload }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) { return payload }

  const body = payload as Record<string, unknown>
  const metadata = body.metadata
  if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
    return payload
  }
  const meta = (metadata ?? {}) as Record<string, unknown>
  const labels = meta.labels
  if (labels !== undefined && (typeof labels !== 'object' || labels === null || Array.isArray(labels))) {
    return payload
  }

  return {
    ...body,
    metadata: {
      ...meta,
      labels: { ...(labels as Record<string, unknown> | undefined), [AGENT_CREATED_LABEL]: AUTOPILOT_AGENT_ID },
    },
  }
}

/**
 * Who initiated a write. Threaded OPTIONALLY into runRest/runRestSet dispatch — absent
 * means a hand-clicked control, i.e. `{actor: 'human'}`. The Autopilot action bridge tags
 * its mutating dispatches (runAction / patchField / applyResourceSet) with `actor: 'agent'`
 * plus the identity context the provider actually holds at dispatch time: the
 * frontend-owned session id and the user's latest chat message (the prompt that produced
 * the proposal).
 */
export interface WriteOrigin {
  actor: 'human' | 'agent'
  /** AutopilotProvider's frontend-owned session/thread id (agent-origin only). */
  agentSessionId?: string
  /** The user's latest chat message — the prompt that produced the agent's proposal. */
  prompt?: string
}

/** The apiserver target of the write, in the CRD's `spec.action` shape. */
export interface AuditActionTarget {
  verb: MutatingVerb
  group: string
  version: string
  resource: string
  namespace: string
  name?: string
}

/** How the write resolved. `status` is 0 when the request itself failed (network/timeout). */
export interface AuditOutcome {
  ok: boolean
  status: number
  message: string
}

/** The pre-dispatch / post-resolution timestamps (ISO-8601). */
export interface AuditTimes {
  requestedAt: string
  resolvedAt: string
}

/** The CRD's `spec.blastRadius` — a compact summary of the gated radius. */
export interface AuditBlastRadiusSummary {
  count: number
  irreversible: boolean
  summary: string
}

/** The full AuditRecord CR body (metadata.generateName — the apiserver names each record). */
export interface AuditRecordBody {
  apiVersion: string
  kind: 'AuditRecord'
  metadata: {
    generateName: string
    namespace: string
  }
  spec: {
    actor: WriteOrigin['actor']
    agent?: { id: string; sessionId?: string }
    prompt?: string
    action: AuditActionTarget
    blastRadius: AuditBlastRadiusSummary
    outcome: AuditOutcome
    requestedAt: string
    resolvedAt: string
  }
}

/** The slice of ActionContext the emitter needs (the same base URL + Bearer auth runRest uses). */
export interface ProvenanceEmitContext {
  apiBaseUrl: string
  getAccessToken: () => string
}

/** The emit context plus the PROVENANCE_ENABLED flag `recordProvenance` gates on. */
export interface ProvenanceContext extends ProvenanceEmitContext {
  provenanceEnabled: boolean
}

/** Human label of a GVR ("compositions.composition.krateo.io", or the bare resource for core). */
const gvrLabel = (gvr: Gvr): string => (gvr.group ? `${gvr.resource}.${gvr.group}` : gvr.resource || 'object')

/**
 * Derive the CRD's `spec.action` target from the gated radius. A scalar radius maps 1:1;
 * a W0-4 SET is represented by its FIRST op (dispatch order) — the per-op detail lives in
 * the blastRadius summary (one record per SET, not per op).
 */
export const actionTargetOf = (radius: BlastRadius | BlastRadiusSet): AuditActionTarget => {
  if ('ops' in radius) {
    const [first] = radius.ops
    return {
      group: first?.gvr.group ?? '',
      namespace: first?.namespace ?? '',
      resource: first?.gvr.resource ?? '',
      verb: first?.verb ?? 'POST',
      version: first?.gvr.version ?? '',
      ...(first?.name ? { name: first.name } : {}),
    }
  }
  return {
    group: radius.gvr.group,
    namespace: radius.namespace,
    resource: radius.gvr.resource,
    verb: radius.verb,
    version: radius.gvr.version,
    ...(radius.name ? { name: radius.name } : {}),
  }
}

/** Compact the gated radius into the CRD's {count, irreversible, summary} shape. */
const summarizeRadius = (radius: BlastRadius | BlastRadiusSet): AuditBlastRadiusSummary => {
  if ('ops' in radius) {
    return {
      count: radius.count,
      irreversible: radius.ops.some((op) => op.irreversible),
      summary: radius.ops
        .map((op, index) => `${index + 1}. ${op.verb} ${gvrLabel(op.gvr)}${op.name ? `/${op.name}` : ''} in ${op.namespace || '(cluster)'}`)
        .join('; '),
    }
  }
  const target = `${radius.verb} ${gvrLabel(radius.gvr)}${radius.name ? `/${radius.name}` : ''} in ${radius.namespace || '(cluster)'}`
  return {
    count: radius.count,
    irreversible: radius.verb === 'DELETE',
    summary: radius.cluster === 'local' ? target : `${target} on ${radius.cluster}`,
  }
}

/**
 * Build the AuditRecord CR body. Pure (same inputs → same output): the caller supplies the
 * resolved times. `metadata.namespace` is the WRITE's target namespace — the record lives
 * next to the object it audits. Agent identity/prompt keys appear only for agent origin.
 */
export const buildAuditRecord = (
  origin: WriteOrigin,
  action: AuditActionTarget,
  radius: BlastRadius | BlastRadiusSet,
  outcome: AuditOutcome,
  times: AuditTimes,
): AuditRecordBody => {
  const spec: AuditRecordBody['spec'] = {
    action,
    actor: origin.actor,
    blastRadius: summarizeRadius(radius),
    outcome,
    requestedAt: times.requestedAt,
    resolvedAt: times.resolvedAt,
  }
  if (origin.actor === 'agent') {
    spec.agent = { id: AUTOPILOT_AGENT_ID, ...(origin.agentSessionId ? { sessionId: origin.agentSessionId } : {}) }
  }
  if (origin.prompt) {
    spec.prompt = origin.prompt
  }
  return {
    apiVersion: `${AUDIT_API_GROUP}/${AUDIT_API_VERSION}`,
    kind: 'AuditRecord',
    metadata: { generateName: 'ar-', namespace: action.namespace },
    spec,
  }
}

/**
 * POST the record to the audit sink — the SAME fetch shape runRest uses (snowplow base URL
 * + Bearer auth). STRICTLY BEST-EFFORT: never throws; any failure (404 CRD absent, 403
 * RBAC, network error, even a throwing token getter) is swallowed with one console.debug.
 */
export const emitAuditRecord = async (record: AuditRecordBody, ctx: ProvenanceEmitContext): Promise<void> => {
  try {
    const { namespace } = record.metadata
    if (!namespace) {
      // A namespaced CR needs a namespace; a write whose target namespace could not be
      // resolved is skipped rather than guessed (best-effort contract).
      // eslint-disable-next-line no-console -- best-effort contract: swallowed with a single console.debug
      console.debug('provenance: AuditRecord skipped (no resolvable target namespace)')
      return
    }
    // Collection POST through snowplow's /call query shape (see the module header). No
    // `name` is passed: the record is created via metadata.generateName, so the builder
    // sends the required-but-ignored placeholder.
    const res = await fetchWithTimeout(
      ctx.apiBaseUrl + buildCallWritePath({
        group: AUDIT_API_GROUP,
        namespace,
        resource: 'auditrecords',
        version: AUDIT_API_VERSION,
      }),
      {
        body: JSON.stringify(record),
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${ctx.getAccessToken()}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    )
    if (!res.ok) {
      // eslint-disable-next-line no-console -- best-effort contract: swallowed with a single console.debug
      console.debug(`provenance: AuditRecord not persisted (HTTP ${res.status})`)
    }
  } catch (error) {
    // eslint-disable-next-line no-console -- best-effort contract: swallowed with a single console.debug
    console.debug('provenance: AuditRecord emit failed', error)
  }
}

/**
 * The one-line entry point the write paths call AFTER a gated write resolves. No-ops when
 * the flag is off. Builds the record (origin defaults to the human actor) and FIRE-AND-
 * FORGETS the emit (`void`, never awaited) so the primary write path is never blocked,
 * delayed, or failed by the audit trail.
 */
export const recordProvenance = (
  ctx: ProvenanceContext,
  origin: WriteOrigin | undefined,
  radius: BlastRadius | BlastRadiusSet,
  outcome: AuditOutcome,
  requestedAt: string,
): void => {
  if (!ctx.provenanceEnabled) {
    return
  }
  const record = buildAuditRecord(
    origin ?? { actor: 'human' },
    actionTargetOf(radius),
    radius,
    outcome,
    { requestedAt, resolvedAt: new Date().toISOString() },
  )
  void emitAuditRecord(record, ctx)
}
