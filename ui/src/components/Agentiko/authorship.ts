/**
 * W4 BLUEPRINT-BUILDER (FE-BP3) — host-stamped authorship/ownership.
 *
 * THE PROBLEM (adversarial blocker): applyResourceSet dispatches op payloads VERBATIM,
 * so the only ownership an agent-authored CR gets is whatever labels the MODEL chose to
 * emit — and the AuditRecord (provenance.ts) is a separate, best-effort CR that is
 * default-OFF. An agent publish can therefore land with no owner label AND no audit =
 * an un-owned orphan.
 *
 * THE FIX: at the publish-payload compile step (BEFORE the blast-radius confirm), the
 * HOST stamps ownership metadata onto every authored object — not trusted from the
 * model. Matches the `krateo.io/managed-by: kog-builder` precedent the KOG prompt
 * teaches, but injected host-side so it cannot be omitted or spoofed (the ownership
 * keys OVERWRITE any model-supplied same-key; other model labels/annotations survive).
 *
 * Pure module: one stamping function + constants. No React, no network, never mutates
 * the input ops.
 */

import type { ApplyResourceSetOp } from './applyResourceSet'

/** Standard k8s managed-by (the platform owns agent-authored objects). */
export const MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by'
export const MANAGED_BY_VALUE = 'krateo'
/** Krateo-specific: authored by the Agentiko agent (vs a human via a form). */
export const AUTHORED_BY_LABEL = 'krateo.io/authored-by'
export const AUTHORED_BY_VALUE = 'autopilot'
/** The agent session that authored it (correlates with the AuditRecord). */
export const AGENT_SESSION_LABEL = 'krateo.io/agent-session'
/** The authoring prompt, as an annotation (labels can't hold free text / are length-capped). */
export const AUTHORING_PROMPT_ANNOTATION = 'krateo.io/authoring-prompt'
/** Keep the prompt annotation well under k8s' 256 KiB total-annotations budget. */
export const AUTHORING_PROMPT_MAX = 1024

export interface AuthorshipOrigin {
  /** The agent session id (stamped as a label; sanitized to a valid label value). */
  sessionId?: string | null
  /** The user prompt that produced this write (stamped as an annotation, truncated). */
  prompt?: string | null
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null)

/**
 * Coerce a string into a valid k8s label VALUE: `[A-Za-z0-9]` at both ends, only
 * `[-A-Za-z0-9_.]` inside, ≤ 63 chars. A UUID session id passes unchanged; anything
 * odd is made safe (empty result → the label is omitted by the caller).
 */
export const sanitizeLabelValue = (value: string): string =>
  value
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 63)
    .replace(/[^A-Za-z0-9]+$/, '')

/**
 * PUBLISH-PAYLOAD COMPILE STEP: stamp ownership metadata onto every authored object's
 * `metadata.labels`/`.annotations`. Pure — returns NEW ops, never mutates the input.
 * Ops with no object payload (e.g. a bare DELETE with no body) ride through unchanged.
 * The ownership keys are applied LAST, so a model-supplied `managed-by`/`authored-by`
 * cannot override the host's; unrelated model labels/annotations are preserved.
 */
export const stampAuthorship = (
  ops: readonly ApplyResourceSetOp[],
  origin: AuthorshipOrigin,
): ApplyResourceSetOp[] => {
  const session = typeof origin.sessionId === 'string' ? sanitizeLabelValue(origin.sessionId) : ''
  const prompt = typeof origin.prompt === 'string' ? origin.prompt.trim() : ''
  return ops.map((op) => {
    const payload = asRecord(op.payload)
    if (!payload) {
      return { ...op }
    }
    const metadata = asRecord(payload.metadata) ?? {}
    const labels: Record<string, unknown> = {
      ...(asRecord(metadata.labels) ?? {}),
      [AUTHORED_BY_LABEL]: AUTHORED_BY_VALUE,
      [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
      ...(session ? { [AGENT_SESSION_LABEL]: session } : {}),
    }
    const annotations: Record<string, unknown> = {
      ...(asRecord(metadata.annotations) ?? {}),
      ...(prompt ? { [AUTHORING_PROMPT_ANNOTATION]: prompt.slice(0, AUTHORING_PROMPT_MAX) } : {}),
    }
    return { ...op, payload: { ...payload, metadata: { ...metadata, annotations, labels } } }
  })
}
