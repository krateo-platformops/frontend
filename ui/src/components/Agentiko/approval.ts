/**
 * kagent HITL tool-approval protocol (Phase 2) — the pure, testable half of the
 * approval pause/resume handshake. Grounded in the kagent source (checkout at
 * v0.10.0-beta3; the 0.9.9 `requireApproval` semantics are the same wire shapes):
 *
 *   PAUSE — an Agent CR tool with `requireApproval` interrupts the run: the A2A task
 *   status flips to `input-required` with `final: true`
 *   (go/adk/pkg/a2a/executor.go — `NewStatusUpdateEvent(reqCtx, TaskStateInputRequired,
 *   hitlMsg)`), and the status message carries one `adk_request_confirmation` DataPart
 *   per paused tool call:
 *     data:     { name: "adk_request_confirmation", id: "<confirmation-fc-id>",
 *                 args: { originalFunctionCall: {name, args, id},
 *                         toolConfirmation: {confirmed, hint, payload?} } }
 *     metadata: { <adk_|kagent_>type: "function_call",
 *                 <adk_|kagent_>is_long_running: true }
 *   (go/adk/pkg/a2a/hitl.go `ExtractHitlInfoFromParts` / python kagent-core
 *   `_hitl_utils.py` `HitlPartInfo`; both prefixes accepted per `ReadMetadataValue` /
 *   `read_metadata_value` in consts). A subagent's paused tool carries its origin in
 *   `toolConfirmation.payload.subagent_name`.
 *
 *   RESUME — the A2A client answers with a NEW `message/stream` user message on the
 *   SAME taskId + contextId whose first part is a DataPart `{decision_type: "approve"}`
 *   or `{decision_type: "reject", rejection_reason?}` (go/adk/pkg/a2a/hitl.go
 *   `ExtractDecisionFromMessage` — only structured DataParts are honored, no text
 *   keywords; reference client: kagent ui/src/components/chat/ChatInterface.tsx
 *   `sendApprovalDecision`). The server converts it into the ToolConfirmation
 *   FunctionResponse(s) via `BuildResumeHITLMessage` and the run continues (approve)
 *   or the tool is refused (reject).
 *
 * DENY-BY-DEFAULT: the rail treats silence as refusal — dismissing the card, starting
 * a new thread, or letting the 5-minute governor expire all send the reject. The
 * governor here is the pure timer state machine the provider arms per pause.
 */

/** One paused tool call awaiting a human decision. */
export interface ApprovalRequest {
  /** The subagent that owns the paused tool (from `toolConfirmation.payload.subagent_name`);
   * absent when the orchestrator's own tool paused. */
  agentName?: string
  /** Human-readable arguments preview — the raw `manifest` string for k8s_apply_manifest,
   * pretty-printed JSON otherwise. Capped; presentation-only. */
  argumentsPreview: string
  /** The `adk_request_confirmation` function-call id — the key the server correlates
   * the ToolConfirmation response to. */
  requestId: string
  /** The ORIGINAL tool-call id (batch decisions key their per-tool map on this). */
  toolCallId?: string
  /** The paused tool's name (e.g. `k8s_apply_manifest`). */
  toolName: string
}

/** An `input-required` approval pause: the task to resume + its paused tool calls. */
export interface ApprovalPause {
  contextId?: string
  requests: ApprovalRequest[]
  taskId: string
}

/** The rail's uniform decision (per-tool batch decisions are out of Phase-2 scope). */
export type ApprovalDecision =
  | { type: 'approve' }
  | { reason?: string; type: 'reject' }

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

/**
 * Read a DataPart metadata value under BOTH accepted prefixes — `adk_<key>` first,
 * then `kagent_<key>` — mirroring kagent's `ReadMetadataValue`
 * (go/adk/pkg/a2a/consts.go) / `read_metadata_value` (kagent-core `_consts.py`).
 */
export const readPartMetadata = (metadata: Record<string, unknown> | undefined, key: string): unknown => {
  if (!metadata) {
    return undefined
  }
  const adkKey = `adk_${key}`
  if (adkKey in metadata) {
    return metadata[adkKey]
  }
  return metadata[`kagent_${key}`]
}

/** Display cap for the arguments preview — enough for a full small manifest, never a tab-wedging dump. */
const PREVIEW_MAX_CHARS = 2000

const truncate = (text: string): string =>
  (text.length > PREVIEW_MAX_CHARS ? `${text.slice(0, PREVIEW_MAX_CHARS)}\n… (truncated)` : text)

/** Non-throwing pretty-print (mirrors the BlastRadiusConfirm stringify contract). */
const stringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return '[unserialisable value]'
  }
}

/**
 * Human-readable preview of the paused tool's arguments. The k8s write tools carry the
 * payload as a `manifest` string — surface it VERBATIM (that is the thing being
 * approved); any sibling args are pretty-printed above it. Everything else renders as
 * pretty JSON. Always capped for display.
 */
export const formatArgumentsPreview = (args: unknown): string => {
  const record = asRecord(args)
  if (!record || Object.keys(record).length === 0) {
    return '(no arguments)'
  }
  const { manifest, ...rest } = record
  if (typeof manifest === 'string') {
    const restText = Object.keys(rest).length ? `${stringify(rest)}\n` : ''
    return truncate(`${restText}${manifest.trim()}`)
  }
  return truncate(stringify(record))
}

/**
 * Parse one A2A JSON-RPC `result` into an ApprovalPause, or null when it is not an
 * approval pause. Detection mirrors kagent's own client (ui/src/lib/messageHandlers.ts
 * `findConfirmationParts` + `extractApprovalMessagesFromTasks`): task state
 * `input-required`, and status-message DataParts with metadata type `function_call`,
 * `is_long_running: true`, and `data.name === "adk_request_confirmation"`.
 * `fallbackTaskId` covers events that omit `taskId` (the transport tracks the task id
 * seen earlier on the stream).
 */
export const parseApprovalPause = (result: Record<string, unknown>, fallbackTaskId?: string): ApprovalPause | null => {
  const status = asRecord(result.status)
  if (status?.state !== 'input-required') {
    return null
  }
  const message = asRecord(status.message)
  if (!message || !Array.isArray(message.parts)) {
    return null
  }

  const requests: ApprovalRequest[] = []
  for (const part of message.parts) {
    const partRecord = asRecord(part)
    if (!partRecord || partRecord.kind !== 'data') {
      continue
    }
    const metadata = asRecord(partRecord.metadata)
    if (readPartMetadata(metadata, 'type') !== 'function_call' || readPartMetadata(metadata, 'is_long_running') !== true) {
      continue
    }
    const data = asRecord(partRecord.data)
    if (!data || data.name !== 'adk_request_confirmation' || typeof data.id !== 'string') {
      continue
    }
    const args = asRecord(data.args)
    const originalCall = asRecord(args?.originalFunctionCall)
    const confirmationPayload = asRecord(asRecord(args?.toolConfirmation)?.payload)
    requests.push({
      ...(typeof confirmationPayload?.subagent_name === 'string' ? { agentName: confirmationPayload.subagent_name } : {}),
      argumentsPreview: formatArgumentsPreview(originalCall?.args),
      requestId: data.id,
      ...(typeof originalCall?.id === 'string' ? { toolCallId: originalCall.id } : {}),
      toolName: typeof originalCall?.name === 'string' ? originalCall.name : '(unknown tool)',
    })
  }
  if (!requests.length) {
    return null
  }

  const taskId = typeof result.taskId === 'string' ? result.taskId : fallbackTaskId
  if (!taskId) {
    return null
  }
  return {
    ...(typeof result.contextId === 'string' ? { contextId: result.contextId } : {}),
    requests,
    taskId,
  }
}

/**
 * Build the resume message the server expects for a decision — the DOCUMENTED response
 * shape (hitl.go `ExtractDecisionFromMessage` reads only the structured DataPart;
 * kagent's own UI sends exactly this from `sendApprovalDecision`): a `user` message on
 * the paused task's `taskId` (+ `contextId`), first part a DataPart with
 * `decision_type` (and `rejection_reason` for an explained reject), plus a small text
 * part for human-readable task history.
 */
export const buildDecisionMessage = (
  decision: ApprovalDecision,
  pause: ApprovalPause,
  messageId: string,
): Record<string, unknown> => {
  const data: Record<string, unknown> = decision.type === 'approve'
    ? { decision_type: 'approve' }
    : { decision_type: 'reject', ...(decision.reason ? { rejection_reason: decision.reason } : {}) }
  const message: Record<string, unknown> = {
    kind: 'message',
    messageId,
    parts: [
      { data, kind: 'data', metadata: {} },
      { kind: 'text', text: decision.type === 'approve' ? 'Approved' : 'Denied' },
    ],
    role: 'user',
    taskId: pause.taskId,
  }
  if (pause.contextId) {
    message.contextId = pause.contextId
  }
  return message
}

/** One-line tool summary for the decision chip ("k8s_apply_manifest", "+1 more" when batched). */
export const summarizeApprovalTools = (pause: ApprovalPause): string => {
  const [first] = pause.requests
  if (!first) {
    return 'tool call'
  }
  const extra = pause.requests.length - 1
  return extra > 0 ? `${first.toolName} +${extra} more` : first.toolName
}

// ────────────────────────────────────────────────────────────────────────────
// Deny-by-default governor — the per-pause timer state machine.
// ────────────────────────────────────────────────────────────────────────────

/** How long an unattended approval stays open before it self-denies. */
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

export interface ApprovalGovernor {
  /** Disarm the timer WITHOUT settling (unmount teardown only — no decision is sent). */
  dispose: () => void
  /** Claim the pending decision. True exactly once across settle/expire — a false
   * return means the pause was already decided (or timed out) and the caller must
   * NOT send another decision. */
  settle: () => boolean
}

/**
 * Arm the deny-by-default window for one pause: if nobody settles it within
 * `timeoutMs`, `onExpire` fires (exactly once) so the provider sends the reject.
 * Settling first cancels the timer; both paths are mutually exclusive.
 */
export const createApprovalGovernor = (onExpire: () => void, timeoutMs: number = APPROVAL_TIMEOUT_MS): ApprovalGovernor => {
  let settled = false
  const timer = setTimeout(() => {
    if (!settled) {
      settled = true
      onExpire()
    }
  }, timeoutMs)
  return {
    dispose: () => clearTimeout(timer),
    settle: () => {
      if (settled) {
        return false
      }
      settled = true
      clearTimeout(timer)
      return true
    },
  }
}
