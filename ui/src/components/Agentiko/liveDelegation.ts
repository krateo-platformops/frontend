/**
 * A specialist's steps WHILE it works.
 *
 * kagent's agent tool calls the specialist with a blocking A2A `message/send`, so the orchestrator's
 * stream carries the hand-off and, minutes later, its reply — nothing in between. The specialist's
 * runtime does write every event to the session store as it happens, though, so the rail reads them
 * from there:
 *
 *   1. find the session: the caller's own session list (`GET /api/sessions`), narrowed to the
 *      specialist's agent id and recent activity. The id itself only arrives with the reply;
 *   2. find the run: the user-authored event whose text is the hand-off's request verbatim. Every
 *      event of that run carries its `InvocationID`, which is what keeps another conversation's
 *      run apart when kagent reuses one session for every call (`isolateSessions` unset);
 *   3. follow it: `GET /api/sessions/<id>?order=asc&after=<cursor>` returns only newer events.
 *
 * Read-only and metadata-only, like the finished view (evidence.ts): a result is read for its
 * error line and dropped.
 */

import { entryFromCall, isEvidenceTool, mergeToolResult, type ToolPart } from './evidence'
import type { EvidenceEntry } from './types'

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

/** How far before the hand-off (browser clock) a session's activity may be and still count: the
 *  session store's clock is not the browser's. */
export const DISCOVERY_SKEW_MS = 120_000

/** Each follow re-reads this much before the newest event it has: an event committed a moment
 *  after a newer one was read would otherwise sit behind the cursor forever. Seen ids are skipped. */
const OVERLAP_MS = 2_000

/** At most this many recent sessions of the specialist are opened looking for the run. */
const CANDIDATES_MAX = 3

/** One stored ADK event, reduced to what the live lane reads. */
export interface StoredEvent {
  id: string
  /** The session store's insert time, ISO. */
  createdAt: string
  author: string
  invocationId: string
  partial: boolean
  text: string
  tools: ToolPart[]
}

/** The text of a failed or finished tool call's response: `{error}` or `{output}` in some nesting. */
const responseText = (response: Record<string, unknown>): { output?: string; isError: boolean } => {
  if (typeof response.error === 'string') {
    return { isError: true, output: `Error: ${response.error}` }
  }
  const output = response.output ?? response.result
  if (typeof output === 'string') {
    return { isError: false, output }
  }
  const nested = asRecord(output)
  const text = nested?.result ?? nested?.output
  return { isError: nested?.isError === true, ...(typeof text === 'string' ? { output: text } : {}) }
}

const toolPartOf = (part: Record<string, unknown>): ToolPart | undefined => {
  const call = asRecord(part.functionCall)
  if (call && typeof call.name === 'string') {
    return { args: asRecord(call.args), id: typeof call.id === 'string' ? call.id : call.name, name: call.name, type: 'call' }
  }
  const response = asRecord(part.functionResponse)
  if (response && typeof response.name === 'string') {
    const { isError, output } = responseText(asRecord(response.response) ?? {})
    return {
      id: typeof response.id === 'string' ? response.id : response.name,
      isError,
      name: response.name,
      ...(output === undefined ? {} : { output }),
      type: 'result',
    }
  }
  return undefined
}

/** A session-store event row (`{id, created_at, data}`, `data` a JSON-encoded ADK event). */
export const readStoredEvent = (row: unknown): StoredEvent | undefined => {
  const record = asRecord(row)
  if (!record || typeof record.id !== 'string' || typeof record.created_at !== 'string' || typeof record.data !== 'string') {
    return undefined
  }
  let event: Record<string, unknown> | undefined
  try {
    event = asRecord(JSON.parse(record.data))
  } catch {
    return undefined
  }
  if (!event) {
    return undefined
  }
  const parts = (asRecord(event.Content)?.parts as unknown[] | undefined) ?? []
  const records = parts.map(asRecord).filter(Boolean) as Record<string, unknown>[]
  return {
    author: typeof event.Author === 'string' ? event.Author : '',
    createdAt: record.created_at,
    id: record.id,
    invocationId: typeof event.InvocationID === 'string' ? event.InvocationID : '',
    partial: event.Partial === true,
    text: records.map((part) => (typeof part.text === 'string' && part.thought !== true ? part.text : '')).join(''),
    tools: records.map(toolPartOf).filter(Boolean) as ToolPart[],
  }
}

/** Where a run was found, and how far it has been read. */
export interface LiveCursor {
  sessionId: string
  invocationId: string
  /** The newest event read, session-store clock (epoch ms). kagent trims trailing zeros from the
   *  fraction, so its ISO strings do not order as strings. */
  afterMs: number
  /** Browser clock minus session-store clock, from the hand-off and the run's first event. */
  skewMs: number
  seen: string[]
}

export interface LiveDelegation {
  cursor?: LiveCursor
  children: EvidenceEntry[]
}

/** Fold one run's new events into its rows. Times are moved onto the browser clock, so the lane's
 *  clocks and the card's stall check read them like the orchestrator's own steps. */
/** A call is added once; a result is merged into the call it answers. */
const foldTool = (children: EvidenceEntry[], tool: ToolPart, at: number): EvidenceEntry[] => {
  if (tool.type === 'result') {
    return mergeToolResult(children, tool, at)
  }
  return children.some((child) => child.id === tool.id) ? children : [...children, entryFromCall(tool, at)]
}

export const foldRunEvents = (live: LiveDelegation, events: StoredEvent[]): LiveDelegation => {
  const { cursor } = live
  if (!cursor) {
    return live
  }
  const seen = new Set(cursor.seen)
  let { children } = live
  let { afterMs } = cursor
  for (const event of events) {
    if (seen.has(event.id)) {
      continue
    }
    seen.add(event.id)
    const createdMs = Date.parse(event.createdAt)
    if (createdMs > afterMs) {
      afterMs = createdMs
    }
    if (event.invocationId !== cursor.invocationId || event.partial) {
      continue
    }
    const at = createdMs + cursor.skewMs
    for (const tool of event.tools) {
      if (!isEvidenceTool(tool.name)) {
        continue
      }
      children = foldTool(children, tool, at)
    }
  }
  return { children, cursor: { ...cursor, afterMs, seen: [...seen] } }
}

/** The newest moment a run was heard from, browser clock; 0 when nothing was. */
export const liveLastAt = (live: LiveDelegation | undefined): number => Math.max(
  0,
  ...(live?.children ?? []).flatMap((child) => [child.startedAt ?? 0, child.endedAt ?? 0]),
)

const getJson = async (url: string, headers: Record<string, string>): Promise<unknown> => {
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return asRecord(await response.json())?.data
}

const readEvents = async (sessionsBase: string, sessionId: string, after: string, headers: Record<string, string>): Promise<StoredEvent[]> => {
  const params = new URLSearchParams({ after, order: 'asc' })
  const data = asRecord(await getJson(`${sessionsBase}/${encodeURIComponent(sessionId)}?${params.toString()}`, headers))
  const rows = Array.isArray(data?.events) ? data.events : []
  return rows.map(readStoredEvent).filter(Boolean) as StoredEvent[]
}

/** RFC 3339 with milliseconds, which the session store's `after` parses. */
const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * Locate the run a hand-off started. Undefined until its first event is stored, and whenever the
 * match is not certain: a run another hand-off already claimed is skipped, so two identical
 * requests in flight at once stay unshown rather than showing one's steps under the other.
 */
export const discoverRun = async (
  sessionsBase: string,
  entry: EvidenceEntry,
  claimed: ReadonlySet<string>,
  headers: Record<string, string>,
): Promise<LiveCursor | undefined> => {
  const request = entry.request?.trim()
  if (!request || entry.startedAt === undefined) {
    return undefined
  }
  const since = entry.startedAt - DISCOVERY_SKEW_MS
  const sessions = await getJson(sessionsBase, headers)
  const candidates = (Array.isArray(sessions) ? sessions : [])
    .map(asRecord)
    .filter((session): session is Record<string, unknown> => Boolean(session
      && session.agent_id === entry.tool
      && typeof session.id === 'string'
      && Date.parse(String(session.updated_at)) >= since))
    .sort((older, newer) => Date.parse(String(newer.updated_at)) - Date.parse(String(older.updated_at)))
    .slice(0, CANDIDATES_MAX)
  for (const session of candidates) {
    const sessionId = session.id as string
    // eslint-disable-next-line no-await-in-loop -- usually one candidate; stop at the first match
    const events = await readEvents(sessionsBase, sessionId, iso(since), headers)
    const start = [...events].reverse().find((event) =>
      event.author === 'user' && event.text.trim() === request && event.invocationId && !claimed.has(event.invocationId))
    if (start) {
      return {
        afterMs: Date.parse(start.createdAt),
        invocationId: start.invocationId,
        seen: [],
        sessionId,
        skewMs: entry.startedAt - Date.parse(start.createdAt),
      }
    }
  }
  return undefined
}

/** One poll of a found run: its events since the cursor, less the overlap. */
export const followRun = async (sessionsBase: string, live: LiveDelegation, headers: Record<string, string>): Promise<LiveDelegation> => {
  const { cursor } = live
  if (!cursor) {
    return live
  }
  const events = await readEvents(sessionsBase, cursor.sessionId, iso(cursor.afterMs - OVERLAP_MS), headers)
  return foldRunEvents(live, events)
}
