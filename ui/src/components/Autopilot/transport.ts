/**
 * Transport (components 4 & 5). Two implementations behind the `AutopilotTransport`
 * seam:
 *
 *   - `createKagentTransport(baseUrl)` — POSTs a turn to the deployed kagent
 *     orchestrator's A2A endpoint, carrying the user's portal Bearer (NEVER an LLM
 *     key in the browser), and streams the reply. The exact wire shape is the
 *     Phase-0 LIVE spike (ingress/CORS/Bearer + frame types must be confirmed
 *     against the running kagent with an authenticated session); the SSE parser
 *     here is deliberately defensive across the plausible ADK/A2A shapes so the
 *     spike is a small tweak, not a rewrite. Marked TODO where it must be verified.
 *
 *   - `createEchoTransport()` — a local stub that streams a canned reply so the
 *     rail is exercisable before the live handshake is wired. Clearly labelled in
 *     its output so it is never mistaken for a real answer.
 *
 * GOVERNING INVARIANT: the transport is read-only plumbing. It carries text and
 * (later) `propose_portal_action` tool_call frames the bridge intercepts — it never
 * itself mutates the cluster.
 */

import { getAccessToken } from '../../utils/getAccessToken'
import { randomId } from '../../utils/utils'

import type { ApprovalDecision, ApprovalPause } from './approval'
import { buildDecisionMessage, parseApprovalPause } from './approval'
import { readToolPart } from './evidence'
import type { AutopilotSendRequest, AutopilotStreamHandlers, AutopilotTransport } from './types'

// ────────────────────────────────────────────────────────────────────────────
// kagent A2A transport
// ────────────────────────────────────────────────────────────────────────────

/**
 * The kagent A2A endpoint. `baseUrl` is the FULL agent A2A URL, same-origin via the
 * nginx `/autopilot/` proxy, e.g.
 *   /autopilot  ->  /api/a2a/<namespace>/<agent-name>
 * We POST a JSON-RPC `message/stream` to it (trailing slash), and it streams SSE of
 * `status-update` results (A2A protocol 0.3).
 */
const buildA2aUrl = (baseUrl: string): string => `${baseUrl.replace(/\/$/, '')}/`

/** The portal Bearer, as a header pair (empty when no session is stored — dev/echo).
 * Mandatory in practice: the gateway validates it and applies per-user RBAC, and the
 * kagent controller (`trusted-proxy`) 401s a request that carries no token. */
export const a2aAuthHeader = (): Record<string, string> => {
  try {
    return { Authorization: `Bearer ${getAccessToken()}` }
  } catch {
    return {}
  }
}

/**
 * JSON-RPC `message/stream` body. The redacted page-context fence rides ahead of
 * the user text inside the message. `contextId` continues an existing A2A thread
 * (omitted on the first turn → the server assigns one, surfaced back as a `session`
 * frame). A fresh `messageId` per turn.
 */
const buildRequestBody = (request: AutopilotSendRequest): string => {
  const message: Record<string, unknown> = {
    kind: 'message',
    messageId: randomId(),
    parts: [{ kind: 'text', text: `${request.context}\n\n${request.text}` }],
    role: 'user',
  }
  if (request.contextId) {
    message.contextId = request.contextId
  }
  return JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'message/stream', params: { message } })
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  (value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined)

/** Per-stream state carried across SSE events (so `session` fires once). */
interface KagentStreamState {
  contextSent: boolean
  /** Set once a `done` frame is emitted (from a `completed`/`final` event) so the
   * stream-close fallback in `run()` doesn't emit a SECOND `done` — a duplicate would
   * re-run the provider's finalize and wipe the rendered answer. */
  done: boolean
  /** The A2A task id seen on this stream (the initial `task` result's `id`, or any
   * `status-update`'s `taskId`) — an approval RESPONSE must target this task. */
  taskId?: string
}

/** Forward one message's tool frames (DataParts — see evidence.ts) and return its text. */
const emitParts = (parts: unknown[], handlers: AutopilotStreamHandlers): string => {
  let text = ''
  for (const part of parts) {
    const tool = readToolPart(part)
    if (tool?.type === 'call') {
      handlers.onFrame({ args: tool.args, id: tool.id, kind: 'tool_call', name: tool.name })
    } else if (tool?.type === 'result') {
      handlers.onFrame({ id: tool.id, isError: tool.isError, kind: 'tool_result', name: tool.name, output: tool.output, sessionId: tool.sessionId })
    } else {
      const value = asRecord(part)?.text
      if (typeof value === 'string') {
        text += value
      }
    }
  }
  return text
}

/**
 * Translate one A2A JSON-RPC payload into 0..n normalized frames:
 *   - `result.contextId` → a one-time `session` frame (thread continuity)
 *   - `status.message` with `role: 'agent'` → text: `kagent_adk_partial: true`
 *     appends a streamed chunk; `false` REPLACES with the authoritative full text;
 *     tool DataParts surface as `tool_call`/`tool_result`
 *   - `result.final === true` / state `completed` → `done`
 *   - a top-level JSON-RPC `error` → `error`
 * User-role echoes and status-only updates produce nothing.
 */
const handleKagentPayload = (
  payload: unknown,
  handlers: AutopilotStreamHandlers,
  state: KagentStreamState,
): void => {
  const root = asRecord(payload)
  if (!root) {
    return
  }
  const rpcError = asRecord(root.error)
  if (rpcError && typeof rpcError.message === 'string') {
    handlers.onFrame({ kind: 'error', message: rpcError.message })
    return
  }
  const result = asRecord(root.result)
  if (!result) {
    return
  }

  if (!state.contextSent && typeof result.contextId === 'string') {
    state.contextSent = true
    handlers.onFrame({ contextId: result.contextId, kind: 'session' })
  }

  // Track the task id across the stream: the initial `task` result carries it as `id`,
  // subsequent `status-update`s as `taskId`. An `input-required` pause must be answered
  // on THIS task, so the approval frame below needs it even when its own event omits it.
  if (typeof result.taskId === 'string') {
    state.taskId = result.taskId
  } else if (result.kind === 'task' && typeof result.id === 'string') {
    state.taskId = result.id
  }

  const status = asRecord(result.status)
  const message = asRecord(status?.message)
  if (message && message.role === 'agent' && Array.isArray(message.parts)) {
    const text = emitParts(message.parts, handlers)
    if (text) {
      const partial = asRecord(message.metadata)?.kagent_adk_partial
      handlers.onFrame({ delta: text, kind: 'text', replace: partial === false })
    }
  }

  // A2A `artifact-update` carries the AUTHORITATIVE full output. The ADK emits it
  // alongside (or, for some turns, INSTEAD of) the streamed `status-update` agent
  // text — so without this branch a turn whose answer arrives only as an artifact
  // renders an empty bubble (verified live: the answer was in `result.artifact`,
  // never in `status.message`). Treat it as the definitive text and REPLACE whatever
  // the status stream accumulated (identical when both fire; recovers the answer when
  // the status stream was empty). Tool parts still surface as tool frames.
  const artifact = asRecord(result.artifact)
  if (artifact && Array.isArray(artifact.parts)) {
    const artifactText = emitParts(artifact.parts, handlers)
    if (artifactText) {
      handlers.onFrame({ delta: artifactText, kind: 'text', replace: true })
    }
  }

  // kagent HITL pause: a tool with `requireApproval` flipped the task to
  // `input-required` (final=true) with `adk_request_confirmation` DataParts in the
  // status message. Surface it BEFORE the `done` below so the provider stores the
  // pending approval, then still finalize the streamed text (the turn IS over —
  // the resume is a separate decision stream via `respondToApproval`).
  if (status?.state === 'input-required') {
    const pause = parseApprovalPause(result, state.taskId)
    if (pause) {
      handlers.onFrame({ kind: 'require_approval', pause })
    }
  }

  if (result.final === true || status?.state === 'completed') {
    state.done = true
    handlers.onFrame({ kind: 'done' })
  }
}

/** Name the gateway's two auth statuses — otherwise they read as a broken agent. */
const describeHttpFailure = (status: number): string => {
  if (status === 401) {
    return 'Autopilot rejected the request (401) — your session is not valid. Sign in again.'
  }
  if (status === 403) {
    return 'Autopilot denied the request (403) — your user is not allowed to use this agent.'
  }
  return `Autopilot request failed (${status})`
}

/** Pull complete SSE events out of a rolling buffer, returning [events, remainder]. */
const drainSseEvents = (buffer: string): { events: string[]; rest: string } => {
  const events: string[] = []
  let rest = buffer
  let boundary = rest.indexOf('\n\n')
  while (boundary !== -1) {
    events.push(rest.slice(0, boundary))
    rest = rest.slice(boundary + 2)
    boundary = rest.indexOf('\n\n')
  }
  return { events, rest }
}

/** Extract the JSON string from an SSE event block's `data:` lines. */
const dataFromEvent = (event: string): string | null => {
  const lines = event.split('\n')
  const dataLines = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
  if (!dataLines.length) {
    return null
  }
  return dataLines.join('\n')
}

/** Parse one SSE event block and forward its frames. */
const processSseEvent = (event: string, handlers: AutopilotStreamHandlers, state: KagentStreamState): void => {
  const data = dataFromEvent(event)
  if (!data || data === '[DONE]') {
    return
  }
  try {
    handleKagentPayload(JSON.parse(data), handlers, state)
  } catch {
    // Non-JSON keepalive/comment line — ignore.
  }
}

/**
 * POST one JSON-RPC body to the A2A endpoint and pump its SSE reply through
 * `handleKagentPayload`. Shared by `send` (a user turn) and `respondToApproval`
 * (a HITL decision resuming a paused task) — identical streaming semantics, only
 * the request body and initial state differ. Returns the abort function.
 */
const streamJsonRpc = (
  baseUrl: string,
  body: string,
  handlers: AutopilotStreamHandlers,
  state: KagentStreamState,
): (() => void) => {
  const controller = new AbortController()

  // #106: a turn that runs longer than an upstream idle timeout (~60s) has its SSE cut BEFORE the task
  // completes, so the reply used to finalize empty. The task keeps running server-side, so on a premature
  // close we re-attach to the SAME task via A2A `tasks/resubscribe` and keep pumping until a terminal
  // frame arrives — recovering the answer with NO upstream change. Bounded so a dead/absent task still
  // finalizes; a JSON-RPC error (e.g. resubscribe unsupported) stops the loop after surfacing once.
  const MAX_RESUBSCRIBES = 30

  const run = async (): Promise<void> => {
    let payload = body
    let sawError = false
    // Observe frames so the reconnect logic can tell a JSON-RPC error (stop) from a bare stream drop
    // (resume). Forwards every frame to the real handlers unchanged.
    const observed: AutopilotStreamHandlers = {
      ...handlers,
      onFrame: (frame) => {
        if (frame.kind === 'error') {
          sawError = true
        }
        handlers.onFrame(frame)
      },
    }

    for (let attempt = 0; ; attempt += 1) {
      let response: Response
      try {
        // Header rebuilt per attempt so a resubscribe carries a refreshed token.
        // eslint-disable-next-line no-await-in-loop -- reconnect attempts are inherently sequential
        response = await fetch(buildA2aUrl(baseUrl), {
          body: payload,
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
            ...a2aAuthHeader(),
          },
          method: 'POST',
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        observed.onFrame({ kind: 'error', message: error instanceof Error ? error.message : 'network error' })
        return
      }

      if (!response.ok || !response.body) {
        observed.onFrame({ kind: 'error', message: describeHttpFailure(response.status) })
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for (;;) {
          // eslint-disable-next-line no-await-in-loop -- sequential stream reads are inherent to SSE
          const { done, value } = await reader.read()
          if (done) {
            break
          }
          buffer += decoder.decode(value, { stream: true })
          const { events, rest } = drainSseEvents(buffer)
          buffer = rest
          events.forEach((event) => processSseEvent(event, observed, state))
        }
      } catch (error) {
        // A mid-stream drop is exactly the #106 case → fall through to the reconnect decision rather than
        // surfacing a transient error. A hard abort (unmount) ends here.
        if (controller.signal.aborted) {
          return
        }
        void error
      }

      // Completed, aborted, or a real JSON-RPC error surfaced → stop (nothing to resume).
      if (state.done || controller.signal.aborted) {
        return
      }
      if (sawError) {
        // Error already shown; finalize the bubble (matches the pre-#106 fallback) and stop reconnecting.
        observed.onFrame({ kind: 'done' })
        return
      }
      // Premature close before completion: resume the still-running task if we know its id.
      if (state.taskId && attempt < MAX_RESUBSCRIBES) {
        payload = JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tasks/resubscribe', params: { id: state.taskId } })
        continue
      }
      // No task to resume (or reconnect budget spent): finalize with whatever text arrived.
      observed.onFrame({ kind: 'done' })
      return
    }
  }

  void run()
  return () => controller.abort()
}

export const createKagentTransport = (baseUrl: string): AutopilotTransport => ({
  // Resume a paused (`input-required`) task with the human's decision: the documented
  // response is a `user` message on the SAME taskId/contextId whose first part is the
  // `{decision_type: approve|reject}` DataPart (see approval.ts). The agent's
  // continuation streams back through the same normalized frames.
  respondToApproval: (decision: ApprovalDecision, pause: ApprovalPause, handlers: AutopilotStreamHandlers): (() => void) => {
    const body = JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'message/stream',
      params: { message: buildDecisionMessage(decision, pause, randomId()) },
    })
    // `contextSent: true` — the thread's contextId is already known to the provider;
    // re-emitting a `session` frame here would be redundant.
    return streamJsonRpc(baseUrl, body, handlers, { contextSent: true, done: false, taskId: pause.taskId })
  },
  send: (request: AutopilotSendRequest, handlers: AutopilotStreamHandlers): (() => void) =>
    streamJsonRpc(baseUrl, buildRequestBody(request), handlers, { contextSent: false, done: false }),
})

// ────────────────────────────────────────────────────────────────────────────
// Local echo transport (dev stub, no backend)
// ────────────────────────────────────────────────────────────────────────────

// The dev stub also demonstrates the Phase-2 driving channel: it emits a fenced
// `portal-action` block, which the bridge strips from the text and auto-applies
// (navigates) — exactly how the real orchestrator will propose once prompted.
const ECHO_REPLY = [
  'Local echo (no live backend) — I drafted the form. Review the fields and press Create when ready.',
  '',
  '```portal-action',
  '{"verb":"prefillForm","values":{"name":"demo-autopilot","namespace":"krateo-system"},"label":"drafted the create form"}',
  '```',
  '```portal-suggest',
  '["Change the name", "Explain these fields", "Cancel"]',
  '```',
].join('\n')

const ECHO_CHUNK = 48

// Dev exercise for the Phase-2 HITL surface: an "apply/delete/scale/hitl" prompt makes
// the echo stub pause with a fake `k8s_apply_manifest` approval (same ApprovalPause
// shape the kagent transport parses), so the card + deny-by-default paths are
// clickable with no backend. Clearly labelled as the local stub.
const ECHO_APPROVAL_TRIGGER = /\b(apply|delete|scale|hitl)\b/i

const ECHO_APPROVAL_PAUSE: ApprovalPause = {
  contextId: 'echo-ctx',
  requests: [{
    agentName: 'snowplow-agent',
    argumentsPreview: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: demo-autopilot\n  namespace: krateo-system\ndata:\n  greeting: hello',
    requestId: 'echo-confirm-1',
    toolCallId: 'echo-call-1',
    toolName: 'k8s_apply_manifest',
  }],
  taskId: 'echo-task-1',
}

/** Stream `text` in fixed-size character chunks, then run `finish`. Returns the abort fn. */
const streamEchoText = (text: string, handlers: AutopilotStreamHandlers, finish: () => void): (() => void) => {
  const chunks = Math.ceil(text.length / ECHO_CHUNK)
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let index = 0

  // Recursive scheduler (not a loop) so the closure is declared once; chunks by
  // characters (not words) so newlines in the fenced block survive.
  const step = (): void => {
    if (cancelled) {
      return
    }
    handlers.onFrame({ delta: text.slice(index * ECHO_CHUNK, (index + 1) * ECHO_CHUNK), kind: 'text' })
    index += 1
    if (index < chunks) {
      timer = setTimeout(step, 25)
    } else {
      finish()
    }
  }
  timer = setTimeout(step, 25)

  return () => {
    cancelled = true
    if (timer) {
      clearTimeout(timer)
    }
  }
}

export const createEchoTransport = (): AutopilotTransport => ({
  respondToApproval: (decision: ApprovalDecision, _pause: ApprovalPause, handlers: AutopilotStreamHandlers): (() => void) => {
    const text = decision.type === 'approve'
      ? 'Local echo (no live backend) — approval delivered; a real agent would now run the tool and stream its result.'
      : 'Local echo (no live backend) — denial delivered; a real agent would now conclude without running the tool.'
    return streamEchoText(text, handlers, () => handlers.onFrame({ kind: 'done' }))
  },
  send: (request: AutopilotSendRequest, handlers: AutopilotStreamHandlers): (() => void) => {
    if (ECHO_APPROVAL_TRIGGER.test(request.text)) {
      const text = 'Local echo (no live backend) — this write needs your approval. Review the manifest below.'
      return streamEchoText(text, handlers, () => {
        handlers.onFrame({ kind: 'require_approval', pause: ECHO_APPROVAL_PAUSE })
        handlers.onFrame({ kind: 'done' })
      })
    }
    return streamEchoText(ECHO_REPLY, handlers, () => handlers.onFrame({ kind: 'done' }))
  },
})
