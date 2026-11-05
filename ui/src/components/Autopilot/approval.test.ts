/**
 * kagent HITL approval protocol coverage (Phase 2).
 *
 * SCOPE: pure-logic only (like the repo's other tests — no RTL / jsdom). Fixtures
 * mirror the shapes the kagent source actually emits/accepts:
 *   - the `input-required` status-update with `adk_request_confirmation` DataParts
 *     (go/adk/pkg/a2a/executor.go + hitl.go `ExtractHitlInfoFromParts`; python
 *     kagent-core `_hitl_utils.py` `HitlPartInfo.from_data_part_data`), under BOTH
 *     accepted metadata prefixes (`adk_` / `kagent_`, per `ReadMetadataValue`);
 *   - the decision message the server's `ExtractDecisionFromMessage` reads — the
 *     `{decision_type}` DataPart on the paused taskId (the same shape kagent's own
 *     UI sends from ChatInterface.tsx `sendApprovalDecision`);
 *   - the DENY-BY-DEFAULT governor: 5-minute expiry, settle/expire mutual exclusion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  APPROVAL_TIMEOUT_MS,
  buildDecisionMessage,
  createApprovalGovernor,
  formatArgumentsPreview,
  parseApprovalPause,
  summarizeApprovalTools,
} from './approval'
import type { ApprovalPause } from './approval'

const DEMO_MANIFEST = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: demo-autopilot\n  namespace: krateo-system'

/** One `adk_request_confirmation` DataPart, as the Go executor serialises it. */
const confirmationPart = (over: {
  data?: Record<string, unknown>
  metadata?: Record<string, unknown>
} = {}): Record<string, unknown> => ({
  data: {
    args: {
      originalFunctionCall: {
        args: { manifest: DEMO_MANIFEST },
        id: 'call_orig_1',
        name: 'k8s_apply_manifest',
      },
      toolConfirmation: { confirmed: false, hint: 'Approve k8s_apply_manifest?', payload: { subagent_name: 'snowplow-agent' } },
    },
    id: 'confirm_fc_1',
    name: 'adk_request_confirmation',
    ...over.data,
  },
  kind: 'data',
  metadata: over.metadata ?? { adk_is_long_running: true, adk_type: 'function_call' },
})

/** The `input-required` status-update JSON-RPC `result`, as streamed over SSE. */
const inputRequiredResult = (parts: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> => ({
  contextId: 'ctx-1',
  final: true,
  kind: 'status-update',
  status: {
    message: { kind: 'message', messageId: 'msg-1', parts, role: 'agent' },
    state: 'input-required',
  },
  taskId: 'task-1',
  ...over,
})

describe('parseApprovalPause — the input-required pause (kagent wire shapes)', () => {
  it('extracts the paused k8s_apply_manifest call: tool, agent, ids, manifest preview', () => {
    const pause = parseApprovalPause(inputRequiredResult([confirmationPart()]))
    expect(pause).not.toBeNull()
    expect(pause?.taskId).toBe('task-1')
    expect(pause?.contextId).toBe('ctx-1')
    expect(pause?.requests).toHaveLength(1)
    const [request] = pause?.requests ?? []
    expect(request.toolName).toBe('k8s_apply_manifest')
    expect(request.agentName).toBe('snowplow-agent')
    // The RESPONSE correlates on the confirmation FC id; batch decisions on the original id.
    expect(request.requestId).toBe('confirm_fc_1')
    expect(request.toolCallId).toBe('call_orig_1')
    // The manifest string — the thing being approved — is in the preview verbatim.
    expect(request.argumentsPreview).toContain('kind: ConfigMap')
    expect(request.argumentsPreview).toContain('name: demo-autopilot')
  })

  it('accepts the kagent_ metadata prefix (ReadMetadataValue checks adk_ THEN kagent_)', () => {
    const part = confirmationPart({ metadata: { kagent_is_long_running: true, kagent_type: 'function_call' } })
    const pause = parseApprovalPause(inputRequiredResult([part]))
    expect(pause?.requests[0]?.toolName).toBe('k8s_apply_manifest')
  })

  it('ignores parts that are not long-running confirmation calls', () => {
    const notLongRunning = confirmationPart({ metadata: { adk_type: 'function_call' } })
    const wrongName = confirmationPart({ data: { name: 'some_other_call' } })
    const textPart = { kind: 'text', text: 'thinking…' }
    expect(parseApprovalPause(inputRequiredResult([notLongRunning, wrongName, textPart]))).toBeNull()
  })

  it('returns null for non-pause states (working / completed / no status message)', () => {
    expect(parseApprovalPause({ status: { state: 'working' } })).toBeNull()
    expect(parseApprovalPause({ status: { state: 'completed' } })).toBeNull()
    expect(parseApprovalPause({ status: { state: 'input-required' } })).toBeNull()
  })

  it('falls back to the stream-tracked task id when the event omits taskId — and refuses without one', () => {
    const noTask = inputRequiredResult([confirmationPart()], { taskId: undefined })
    expect(parseApprovalPause(noTask, 'task-from-stream')?.taskId).toBe('task-from-stream')
    expect(parseApprovalPause(noTask)).toBeNull()
  })
})

describe('buildDecisionMessage — the documented approval response', () => {
  const pause: ApprovalPause = {
    contextId: 'ctx-1',
    requests: [{ argumentsPreview: '(no arguments)', requestId: 'confirm_fc_1', toolName: 'k8s_apply_manifest' }],
    taskId: 'task-1',
  }

  it('approve → user message on the paused task whose first part is the decision DataPart', () => {
    const message = buildDecisionMessage({ type: 'approve' }, pause, 'mid-1')
    expect(message.kind).toBe('message')
    expect(message.role).toBe('user')
    expect(message.messageId).toBe('mid-1')
    // The server resumes the STORED task — both ids must be threaded through.
    expect(message.taskId).toBe('task-1')
    expect(message.contextId).toBe('ctx-1')
    // ExtractDecisionFromMessage reads ONLY structured DataParts — no text keywords.
    const parts = message.parts as Record<string, unknown>[]
    expect(parts[0]).toEqual({ data: { decision_type: 'approve' }, kind: 'data', metadata: {} })
    expect(parts[1]).toEqual({ kind: 'text', text: 'Approved' })
  })

  it('reject carries the rejection_reason when given, omits it when not', () => {
    const withReason = buildDecisionMessage({ reason: 'Denied by the user in the Agentiko rail.', type: 'reject' }, pause, 'mid-2')
    const [decisionPart] = withReason.parts as Record<string, unknown>[]
    expect(decisionPart.data).toEqual({ decision_type: 'reject', rejection_reason: 'Denied by the user in the Agentiko rail.' })

    const bare = buildDecisionMessage({ type: 'reject' }, pause, 'mid-3')
    const [barePart] = bare.parts as Record<string, unknown>[]
    expect(barePart.data).toEqual({ decision_type: 'reject' })
  })

  it('omits contextId when the pause has none (a first-turn pause)', () => {
    const message = buildDecisionMessage({ type: 'approve' }, { requests: pause.requests, taskId: 'task-1' }, 'mid-4')
    expect('contextId' in message).toBe(false)
  })
})

describe('formatArgumentsPreview', () => {
  it('surfaces a manifest string VERBATIM (the thing being approved)', () => {
    expect(formatArgumentsPreview({ manifest: DEMO_MANIFEST })).toBe(DEMO_MANIFEST)
  })

  it('pretty-prints non-manifest args as JSON and labels empty args', () => {
    expect(formatArgumentsPreview({ name: 'demo', namespace: 'krateo-system' })).toContain('"namespace": "krateo-system"')
    expect(formatArgumentsPreview({})).toBe('(no arguments)')
    expect(formatArgumentsPreview(undefined)).toBe('(no arguments)')
  })

  it('caps very long previews (a huge manifest must not wedge the rail)', () => {
    const huge = formatArgumentsPreview({ manifest: 'x'.repeat(10_000) })
    expect(huge.length).toBeLessThan(2_100)
    expect(huge).toContain('… (truncated)')
  })
})

describe('deny-by-default governor — state transitions', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('expires into deny after 5 minutes exactly once', () => {
    const onExpire = vi.fn()
    createApprovalGovernor(onExpire)
    vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS - 1)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('a user decision settles the pause and disarms the timer', () => {
    const onExpire = vi.fn()
    const governor = createApprovalGovernor(onExpire)
    expect(governor.settle()).toBe(true)
    vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS * 2)
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('settle is single-shot: a second settle (double-click) and a settle after expiry are refused', () => {
    const governor = createApprovalGovernor(() => undefined)
    expect(governor.settle()).toBe(true)
    expect(governor.settle()).toBe(false)

    const expired = createApprovalGovernor(() => undefined)
    vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS)
    expect(expired.settle()).toBe(false)
  })

  it('dispose disarms without deciding (unmount teardown — no reject is sent)', () => {
    const onExpire = vi.fn()
    const governor = createApprovalGovernor(onExpire)
    governor.dispose()
    vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS * 2)
    expect(onExpire).not.toHaveBeenCalled()
  })
})

describe('summarizeApprovalTools', () => {
  const request = { argumentsPreview: '(no arguments)', requestId: 'r1', toolName: 'k8s_apply_manifest' }

  it('names the single tool, and counts the extras for a multi-call pause', () => {
    expect(summarizeApprovalTools({ requests: [request], taskId: 't' })).toBe('k8s_apply_manifest')
    expect(summarizeApprovalTools({
      requests: [request, { ...request, requestId: 'r2', toolName: 'k8s_delete_resource' }],
      taskId: 't',
    })).toBe('k8s_apply_manifest +1 more')
  })
})
