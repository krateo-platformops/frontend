/**
 * The `?agentiko=<contextId>` approval link (decided 2026-11-21).
 *
 * A person's own agent (OpenClaw, Hermes, ...) starts an Agentiko task through agentiko-mcp-server.
 * When a `requireApproval` tool pauses it, that server sends the person an `approval.pending` event
 * whose link is any portal route plus `?agentiko=<contextId>`, so the decision is taken HERE, in the
 * portal, never from the personal agent. The contextId is the kagent session id.
 *
 * This module is the pure half: it reads the session and its paused task from kagent's session API
 * (the same `<gateway>/api/sessions` the run timeline reads, as the same user):
 *
 *   GET /api/sessions/{id}         → { data: { session: { agent_id, source, ... }, events } }
 *   GET /api/sessions/{id}/tasks   → { data: [ A2A Task, ... ] }   (legacy wire: no A2A-Version header)
 *
 * (kagent v0.10.1, go/core/internal/httpserver/handlers/sessions.go HandleGetSession /
 * HandleListTasksForSession.) Both are scoped to the caller: a session that is not the caller's
 * answers 404, exactly as one that does not exist, and the link says so without telling them apart.
 *
 * The session must belong to the agent this rail talks to: kagent refuses a write to a session
 * another agent owns, so an approve sent to the wrong one could never land. `agent_id` is stored in
 * kagent's Python-identifier form (`krateo_system__NS__agentiko`, utils.ConvertToPythonIdentifier).
 */
import { parseApprovalPause, type ApprovalPause } from './approval'

/** The query parameter. Consumed once and stripped, like `?ask=`. */
export const APPROVAL_LINK_PARAM = 'agentiko'

export type LinkedApproval =
  | { kind: 'paused'; pause: ApprovalPause }
  /** The session exists and is the caller's, but nothing in it is waiting for a decision (decided, or finished). */
  | { kind: 'nothing-pending' }
  /** No such session for this person: never existed, or someone else's (kagent answers 404 for both). */
  | { kind: 'not-found' }
  /** The session belongs to another agent than the one this rail talks to. */
  | { kind: 'other-agent'; agent: string }
  | { kind: 'error'; status?: number }

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

/** kagent's stored agent id back to `namespace/name` (inverse of utils.ConvertToPythonIdentifier). */
export const agentRefOfSessionAgentId = (agentId: string): string =>
  agentId.replaceAll('__NS__', '/').replaceAll('_', '-')

/** Whether a session's agent is the rail's agent. The rail knows its agent by name (`agentOfA2aBase`),
 * and by namespace too when its endpoint names one (`.../api/a2a/<ns>/<name>`). */
export const isRailAgent = (sessionAgentId: string, railAgent: string, railNamespace?: string): boolean => {
  const ref = agentRefOfSessionAgentId(sessionAgentId)
  const slash = ref.lastIndexOf('/')
  const name = slash === -1 ? ref : ref.slice(slash + 1)
  const namespace = slash === -1 ? undefined : ref.slice(0, slash)
  return name === railAgent && (!railNamespace || !namespace || namespace === railNamespace)
}

/** The namespace in the rail's own A2A endpoint (`.../api/a2a/<ns>/<name>`), when it names one. */
export const railNamespaceOf = (endpoint: string): string | undefined => {
  const match = /\/api\/a2a\/([^/]+)\/[^/]+\/?$/.exec(endpoint)
  return match ? decodeURIComponent(match[1]) : undefined
}

/** A task's status timestamp (RFC 3339, so it sorts as text); '' when absent. */
const statusTime = (task: Record<string, unknown>): string => {
  const timestamp = asRecord(task.status)?.timestamp
  return typeof timestamp === 'string' ? timestamp : ''
}

class HttpError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`) }
}

const getData = async (url: string, headers: Record<string, string>): Promise<unknown> => {
  const response = await fetch(url, { headers })
  if (!response.ok) { throw new HttpError(response.status) }
  return asRecord(await response.json())?.data
}

/**
 * Read the session behind a link and the approval it is waiting on. When more than one task is
 * input-required (kagent allows it; in practice there is one), the most recently updated one is the
 * one the event was about.
 */
export const loadLinkedApproval = async (
  sessionsBase: string,
  contextId: string,
  rail: { agent: string; namespace?: string },
  headers: Record<string, string>,
): Promise<LinkedApproval> => {
  const sessionUrl = `${sessionsBase.replace(/\/$/, '')}/${encodeURIComponent(contextId)}`
  try {
    const session = asRecord(asRecord(await getData(sessionUrl, headers))?.session)
    const agentId = typeof session?.agent_id === 'string' ? session.agent_id : undefined
    if (agentId && !isRailAgent(agentId, rail.agent, rail.namespace)) {
      return { agent: agentRefOfSessionAgentId(agentId), kind: 'other-agent' }
    }
    const tasks = await getData(`${sessionUrl}/tasks`, headers)
    const paused = (Array.isArray(tasks) ? tasks : [])
      .map(asRecord)
      .filter((task): task is Record<string, unknown> => asRecord(task?.status)?.state === 'input-required')
      .sort((left, right) => statusTime(right).localeCompare(statusTime(left)))
    for (const task of paused) {
      const pause = parseApprovalPause(task, typeof task.id === 'string' ? task.id : undefined)
      if (pause) { return { kind: 'paused', pause: { ...pause, contextId: pause.contextId ?? contextId } } }
    }
    return { kind: 'nothing-pending' }
  } catch (error) {
    if (error instanceof HttpError) {
      return error.status === 404 ? { kind: 'not-found' } : { kind: 'error', status: error.status }
    }
    return { kind: 'error' }
  }
}

/** The note the approval card hangs on, so the reader knows where the decision came from. */
export const LINKED_APPROVAL_NOTE = 'A task you started from your own agent is waiting for your decision.'

/** What the rail says when a link opens no decision: every outcome is said, never silently dropped. */
export const linkedApprovalNotice = (result: Exclude<LinkedApproval, { kind: 'paused' }>): string => {
  switch (result.kind) {
    case 'nothing-pending':
      return 'Nothing is waiting for a decision in this conversation any more: the task was already decided, or it has finished.'
    case 'not-found':
      return "This approval link doesn't open a conversation of yours. It may belong to someone else, or it was removed."
    case 'other-agent':
      return `This approval belongs to ${result.agent}, not to Agentiko in this portal.`
    default:
      return `Couldn't load this approval${result.status ? ` (HTTP ${result.status})` : ''}. Open the link again in a moment.`
  }
}
