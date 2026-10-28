/**
 * SSE wire-format parsing, shared by every Server-Sent-Events client in the app.
 *
 * Lives on its own rather than in `refreshSse.ts` (where it used to) so a client can
 * parse frames without importing that module — `refreshSse` instantiates a
 * `RefreshManager` singleton at module scope, and `sseClient` is deliberately the
 * decoupled transport seam. `refreshSse` re-exports both names, so its own callers and
 * tests are unaffected.
 */

/** Pull complete SSE event blocks out of a rolling buffer, returning [events, remainder]. */
export const drainSseEvents = (buffer: string): { events: string[]; rest: string } => {
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

/**
 * Parse one SSE event block into its `event:` name and joined `data:` payload.
 * Comment lines (`:` prefix, e.g. `: keepalive`) and unknown fields are ignored.
 */
export const parseSseBlock = (block: string): { event?: string; data?: string } => {
  let event: string | undefined
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':') || line.length === 0) { continue }
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }
  return { data: dataLines.length ? dataLines.join('\n') : undefined, event }
}
