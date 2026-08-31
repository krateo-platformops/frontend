/**
 * The rows behind an answer: the orchestrator's tool calls, which the A2A stream carries as
 * `function_call`/`function_response` DataParts, plus a delegated specialist's own calls, which it
 * does not — those come from the sub-agent session its response names.
 *
 * METADATA ONLY: tool, arguments, repo coordinates. A result payload is read for a ref/line/count
 * and dropped — the agent's RBAC is wider than the user's, and retrieving the content is the
 * user's own job, which is what makes this verification rather than a second telling.
 */

import { readPartMetadata } from './approval'
import { redactValue } from './redact'
import type { AutopilotFrame, EvidenceEntry, EvidenceKind, EvidenceSource } from './types'

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

/** Protocol, not sources: these drive the portal or ask the human something. */
const PROTOCOL_TOOLS = new Set(['adk_request_confirmation', 'adk_request_credential', 'ask_user', 'propose_portal_action'])

const REPO_TOOLS = new Set(['list_blueprints', 'list_repo_files', 'list_repos', 'read_repo_file', 'search_repo', 'validate_manifest'])

const GRAPH_TOOLS = new Set(['get_neighbors', 'graph_find', 'graph_map', 'graph_neighbors', 'graph_path', 'graph_stats', 'knowledge_lookup', 'query_graph', 'shortest_path'])

/** kagent encodes an agent tool as `<namespace>__NS__<agent_name>`, hyphens as underscores. */
const AGENT_TOOL = /__NS__/

export const isEvidenceTool = (name: string): boolean => !PROTOCOL_TOOLS.has(name)

/** `krateo_system__NS__core_provider_agent` → `core-provider-agent`. */
export const agentFromToolName = (name: string): string | undefined => {
  if (!AGENT_TOOL.test(name)) {
    return undefined
  }
  const [, agent] = name.split('__NS__')
  return agent ? agent.replace(/_/g, '-') : undefined
}

const classify = (name: string): EvidenceKind => {
  if (agentFromToolName(name)) {
    return 'delegation'
  }
  if (REPO_TOOLS.has(name)) {
    return 'repo'
  }
  if (GRAPH_TOOLS.has(name)) {
    return 'graph'
  }
  return name.startsWith('k8s_') || name.startsWith('helm_') ? 'cluster' : 'tool'
}

/** No tool reports the org, so it is guessed from repo-mcp-server's tier name shapes; a wrong
 *  guess only costs the row its link. See ui/docs/evidence-org-guess.md. */
export const orgOfRepo = (repo: string): string => {
  if (repo === 'krateo-autopilot' || repo === 'codegen-agents') {
    return 'krateo-agentiko'
  }
  return /blueprint|-kog(-chart)?$|^openstack-/.test(repo) ? 'krateo-blueprints' : 'krateo-platformops'
}

/** `#L12-L48` from a `lines 12-48 of 134` header. */
const lineFragment = (lines: string | undefined): string => {
  if (!lines) {
    return ''
  }
  const [start, end] = lines.split('-')
  return end && end !== start ? `#L${start}-L${end}` : `#L${start}`
}

const permalink = (source: EvidenceSource): string | undefined => {
  if (!source.org || !source.path) {
    return undefined
  }
  const ref = source.ref && source.ref !== 'HEAD' ? source.ref : 'HEAD'
  return `https://github.com/${source.org}/${source.repo}/blob/${ref}/${source.path}${lineFragment(source.lines)}`
}

/** repo-mcp-server opens every result with `# <repo> @ <ref> — …`, and a read adds
 *  `# <repo>/<path> — lines X-Y of Z`. */
const readProvenance = (output: string): { ref?: string; lines?: string; note?: string } => {
  const lines = output.split('\n')
  const ref = /^#\s*\S+\s+@\s+(\S+)/.exec(lines[0] ?? '')?.[1]
  const window = /—\s*lines\s+(\d+-\d+)\s+of\s+(\d+)/.exec(lines[1] ?? '')
  if (window) {
    return { lines: window[1], note: `${window[2]} lines`, ref }
  }
  if (/^No (matches|files found)/.test(lines[1] ?? '')) {
    return { note: 'no results', ref }
  }
  const body = lines.slice(1).filter((line) => line.trim() && !line.startsWith('...'))
  return { ...(body.length ? { note: `${body.length} results` } : {}), ref }
}

/** One tool DataPart, normalized. */
export interface ToolPart {
  type: 'call' | 'result'
  id: string
  name: string
  args?: Record<string, unknown>
  output?: string
  isError?: boolean
  sessionId?: string
}

/** Tool parts are DataParts carrying `adk_type`/`kagent_type` metadata; the legacy
 *  `functionCall` shape is accepted too. */
export const readToolPart = (part: unknown): ToolPart | undefined => {
  const record = asRecord(part)
  if (!record) {
    return undefined
  }
  const legacy = asRecord(record.functionCall)
  if (legacy && typeof legacy.name === 'string') {
    return { args: asRecord(legacy.args), id: typeof legacy.id === 'string' ? legacy.id : legacy.name, name: legacy.name, type: 'call' }
  }
  const type = readPartMetadata(asRecord(record.metadata), 'type')
  if (type !== 'function_call' && type !== 'function_response') {
    return undefined
  }
  const data = asRecord(record.data)
  if (!data || typeof data.name !== 'string') {
    return undefined
  }
  const id = typeof data.id === 'string' ? data.id : data.name
  if (type === 'function_call') {
    return { args: asRecord(data.args), id, name: data.name, type: 'call' }
  }
  const response = asRecord(data.response)
  const payload = response?.output ?? response?.result
  return {
    id,
    isError: response?.isError === true,
    name: data.name,
    ...(typeof payload === 'string' ? { output: payload } : {}),
    ...(typeof response?.subagent_session_id === 'string' ? { sessionId: response.subagent_session_id } : {}),
    type: 'result',
  }
}

/** A row for a call, before its result arrives. */
export const entryFromCall = (part: ToolPart): EvidenceEntry => {
  const kind = classify(part.name)
  const agent = agentFromToolName(part.name)
  const repo = typeof part.args?.repo === 'string' ? part.args.repo : undefined
  const path = typeof part.args?.path === 'string' ? part.args.path : undefined
  const request = typeof part.args?.request === 'string' ? part.args.request : undefined
  return {
    ...(part.args && Object.keys(part.args).length ? { args: part.args } : {}),
    ...(agent ? { agent } : {}),
    id: part.id,
    kind,
    ...(request ? { request } : {}),
    ...(repo ? { source: { org: orgOfRepo(repo), repo, ...(path ? { path } : {}) } } : {}),
    tool: part.name,
  }
}

/** Merge a result into the row its call opened. */
export const mergeToolResult = (entries: EvidenceEntry[], part: ToolPart): EvidenceEntry[] => {
  const index = entries.findIndex((entry) => entry.id === part.id && entry.tool === part.name)
  if (index === -1) {
    return entries
  }
  const entry = entries[index]
  const failed = part.isError || Boolean(part.output && part.output.startsWith('Error:'))
  const provenance = entry.kind === 'repo' && part.output ? readProvenance(part.output) : {}
  const source: EvidenceSource | undefined = entry.source
    ? { ...entry.source, ...(provenance.ref ? { ref: provenance.ref } : {}), ...(provenance.lines ? { lines: provenance.lines } : {}) }
    : undefined
  const merged: EvidenceEntry = {
    ...entry,
    ...(failed ? { failed: true } : {}),
    ...(provenance.note ? { note: provenance.note } : {}),
    ...(part.sessionId ? { sessionId: part.sessionId } : {}),
    ...(source ? { source, ...(permalink(source) ? { url: permalink(source) } : {}) } : {}),
  }
  return entries.map((current, at) => (at === index ? merged : current))
}

/** The final artifact can repeat a part the status stream already carried. */
const appendCall = (entries: EvidenceEntry[], part: ToolPart): EvidenceEntry[] =>
  (entries.some((entry) => entry.id === part.id) ? entries : [...entries, entryFromCall(part)])

/** Buffer one live tool frame into the turn's rows. */
export const recordToolFrame = (entries: EvidenceEntry[], frame: AutopilotFrame): EvidenceEntry[] => {
  if (frame.kind === 'tool_call') {
    return isEvidenceTool(frame.name)
      ? appendCall(entries, { args: asRecord(frame.args), id: frame.id ?? frame.name, name: frame.name, type: 'call' })
      : entries
  }
  if (frame.kind === 'tool_result') {
    return mergeToolResult(entries, {
      id: frame.id ?? frame.name,
      isError: frame.isError,
      name: frame.name,
      output: frame.output,
      sessionId: frame.sessionId,
      type: 'result',
    })
  }
  return entries
}

/** Fold stored history, or a live stream's parts, into rows. */
export const evidenceFromParts = (parts: unknown[]): EvidenceEntry[] => {
  let entries: EvidenceEntry[] = []
  for (const part of parts) {
    const tool = readToolPart(part)
    if (!tool || !isEvidenceTool(tool.name)) {
      continue
    }
    entries = tool.type === 'call' ? appendCall(entries, tool) : mergeToolResult(entries, tool)
  }
  return entries
}

/**
 * Derived from the A2A endpoint so no second setting exists:
 *   `<gateway>/api/a2a/<ns>/autopilot` → `<gateway>/api/sessions`
 *   `/autopilot`                       → `/autopilot/sessions`
 */
export const deriveSessionsBase = (autopilotBase: string): string => {
  const base = autopilotBase.replace(/\/$/, '')
  const a2a = base.indexOf('/api/a2a/')
  return a2a === -1 ? `${base}/sessions` : `${base.slice(0, a2a)}/api/sessions`
}

const firstText = (message: unknown): string => {
  const parts = asRecord(message)?.parts
  if (!Array.isArray(parts)) {
    return ''
  }
  for (const part of parts) {
    const text = asRecord(part)?.text
    if (typeof text === 'string') {
      return text
    }
  }
  return ''
}

/**
 * A specialist's session outlives one delegation (kagent prunes `isolateSessions` below 0.10), and
 * a task's first history message is the request verbatim — so match on that. Nothing else
 * correlates the two: kagent 0.9.12 gives the caller only `subagent_session_id`, and a sub-task
 * carries no parent id. No match therefore means unknown, NOT the newest task — attributing
 * another turn's calls to this answer is the one failure this panel must not have.
 */
export const selectDelegationTask = (tasks: unknown[], request: string | undefined): Record<string, unknown> | undefined => {
  if (!request) {
    return undefined
  }
  const matched = (tasks.map(asRecord).filter(Boolean) as Record<string, unknown>[]).filter((task) => {
    const history = Array.isArray(task.history) ? task.history : []
    return firstText(history[0]).trim() === request.trim()
  })
  return matched[matched.length - 1]
}

/** The specialist's own rows, from its session's stored tasks. */
export const fetchDelegationEvidence = async (
  sessionsBase: string,
  entry: EvidenceEntry,
  headers: Record<string, string>,
): Promise<EvidenceEntry[]> => {
  if (!entry.sessionId) {
    return []
  }
  const response = await fetch(`${sessionsBase}/${entry.sessionId}/tasks`, { headers })
  if (!response.ok) {
    throw new Error(`session trace unavailable (${response.status})`)
  }
  const body = asRecord(await response.json())
  const tasks: unknown[] = Array.isArray(body?.data) ? body.data : []
  const task = selectDelegationTask(tasks, entry.request)
  if (!task) {
    throw new Error('this delegation is not identifiable in the session')
  }
  const history: unknown[] = Array.isArray(task.history) ? task.history : []
  const parts: unknown[] = []
  for (const message of history) {
    const own = asRecord(message)?.parts
    if (Array.isArray(own)) {
      parts.push(...(own as unknown[]))
    }
  }
  return evidenceFromParts(parts)
}

/** The panel's headline: "6 lookups · 4 files · 1 specialist". */
export const summarizeEvidence = (entries: EvidenceEntry[]): string => {
  if (!entries.length) {
    return 'No tools used — answered from the page context'
  }
  const files = new Set(entries.filter((entry) => entry.source?.path).map((entry) => `${entry.source?.repo}/${entry.source?.path}`))
  const agents = new Set(entries.filter((entry) => entry.agent).map((entry) => entry.agent))
  const parts = [`${entries.length} lookup${entries.length === 1 ? '' : 's'}`]
  if (files.size) {
    parts.push(`${files.size} file${files.size === 1 ? '' : 's'}`)
  }
  if (agents.size) {
    parts.push(`${agents.size} specialist${agents.size === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}

const ARG_MAX = 120
const ARGS_MAX = 300

const clamp = (text: string, max: number): string =>
  (text.length > max ? `${text.slice(0, max)}…` : text)

/**
 * `key: value` list for a row with no richer shape. Arguments go through the same redactor as the
 * outbound context — a specialist's own trace can carry a write tool's manifest or helm values —
 * and each value is clamped on its own so one long argument cannot crowd out the rest.
 */
export const describeArgs = (entry: EvidenceEntry): string => {
  const args = (redactValue(entry.args ?? {}) ?? {}) as Record<string, unknown>
  const rendered = Object.entries(args)
    .filter(([key]) => key !== 'request')
    .map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
      return `${key}: ${clamp(text.replace(/\s+/g, ' ').trim(), ARG_MAX)}`
    })
  return clamp(rendered.join(' · '), ARGS_MAX)
}

/** One tool-call row — `- tool: meta · tail — loc` — indented for nesting under a specialist. */
const serializeToolLine = (entry: EvidenceEntry, indent: string): string => {
  const meta = entry.source
    ? `${entry.source.org ? `${entry.source.org}/` : ''}${entry.source.repo}${entry.source.ref ? ` @ ${entry.source.ref}` : ''}`
    : describeArgs(entry)
  const tail = [entry.note, entry.failed ? 'failed' : ''].filter(Boolean).join(' · ')
  const loc = entry.source?.path ? ` — ${entry.url ?? entry.source.path}` : ''
  return `${indent}- ${entry.tool}: ${meta}${tail ? ` · ${tail}` : ''}${loc}`
}

/**
 * Plain-text rendering of a turn's evidence — the summary line plus one line per tool call /
 * delegated hop — for copy-to-clipboard. Mirrors exactly what EvidencePanel shows (metadata only,
 * never tool output), so what's copied is what's on screen.
 *
 * A delegated hop's own tool calls live on the specialist's session, not this stream, so they are
 * resolved lazily and passed in via `childrenBySession` (keyed by `entry.sessionId`). When present
 * they are nested — indented — under the specialist line, so Copy captures ALL evidence levels and
 * not just the top one (the reported bug: "copies only the first levels"). A delegation with no
 * resolved children (not yet fetched, empty, or unreadable) still emits its single specialist line.
 */
export const serializeEvidence = (
  entries: EvidenceEntry[],
  childrenBySession: Record<string, EvidenceEntry[]> = {},
): string => {
  const lines = entries.flatMap((entry) => {
    if (entry.agent) {
      const children = entry.sessionId ? (childrenBySession[entry.sessionId] ?? []) : []
      const head = `- ${entry.agent} (specialist${children.length ? ` · ${children.length} lookups` : ''})`
      return [head, ...children.map((child) => serializeToolLine(child, '  '))]
    }
    return [serializeToolLine(entry, '')]
  })
  return [summarizeEvidence(entries), ...lines].join('\n')
}
