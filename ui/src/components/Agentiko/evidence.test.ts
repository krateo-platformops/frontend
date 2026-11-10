/**
 * Evidence coverage. Every wire shape here was captured off the live kagent 0.9.12 A2A stream and
 * off `GET /api/sessions/<id>/tasks`. The metadata-only invariant is asserted by checking what a
 * row carries after a result whose body is a whole file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  agentFromToolName,
  describeArgs,
  deriveSessionsBase,
  evidenceFromParts,
  fetchDelegationEvidence,
  mergeToolResult,
  orgOfRepo,
  readToolPart,
  recordToolFrame,
  selectDelegationTask,
  serializeEvidence,
  summarizeEvidence,
} from './evidence'
import type { EvidenceEntry } from './types'

/** A real `Response`, so the code under test sees the status, the content type and the body exactly
 *  as the browser hands them over — a hand-built `{ json, ok }` object has no headers, and could not
 *  express the HTML-with-200 answer this file now has to catch. Fresh per call: a body reads once. */
const serve = (body: unknown, status = 200, contentType = 'application/json') =>
  vi.fn(() => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'content-type': contentType }, status })))

const call = (name: string, args: Record<string, unknown> | undefined, id: string, prefix = 'adk') => ({
  data: { args, id, name },
  kind: 'data',
  metadata: { [`${prefix}_type`]: 'function_call' },
})

const result = (name: string, output: unknown, id: string, extra: Record<string, unknown> = {}) => ({
  data: { id, name, response: { output, ...extra } },
  kind: 'data',
  metadata: { adk_type: 'function_response' },
})

const READ_OUTPUT = [
  "# core-provider @ 2.13.4 — this server's default version for this repository.",
  '# core-provider/helm/core-provider/templates/deployment.yaml — lines 1-134 of 134',
  '1\tapiVersion: apps/v1',
  '2\tkind: Deployment',
].join('\n')

const SEARCH_OUTPUT = [
  "# core-provider @ 2.13.4 — this server's default version for this repository.",
  'helm/core-provider/values.yaml:144: env:',
  'helm/core-provider/values.yaml:239:   env:',
].join('\n')

describe('reading tool parts off the wire', () => {
  it('parses a function_call DataPart under either metadata prefix', () => {
    expect(readToolPart(call('search_repo', { repo: 'authn' }, 'call_1'))).toEqual({
      args: { repo: 'authn' }, id: 'call_1', name: 'search_repo', type: 'call',
    })
    expect(readToolPart(call('search_repo', undefined, 'call_1', 'kagent'))?.type).toBe('call')
  })

  it('parses a function_response, including an agent tool\'s sub-agent session', () => {
    const part = result('krateo_system__NS__core_provider_agent', undefined, 'call_2', {
      result: 'the specialist answer', subagent_session_id: 'sess-9',
    })
    expect(readToolPart(part)).toMatchObject({ output: 'the specialist answer', sessionId: 'sess-9', type: 'result' })
  })

  it('ignores text parts and unknown data parts', () => {
    expect(readToolPart({ kind: 'text', text: 'hello' })).toBeUndefined()
    expect(readToolPart({ data: { decision_type: 'approve' }, kind: 'data', metadata: {} })).toBeUndefined()
  })
})

describe('rows built from a call/result pair', () => {
  it('gives a repo read its exact coordinates and a permalink at the ref actually read', () => {
    const [row] = evidenceFromParts([
      call('read_repo_file', { limit: 400, path: 'helm/core-provider/templates/deployment.yaml', repo: 'core-provider' }, 'c1'),
      result('read_repo_file', READ_OUTPUT, 'c1'),
    ])
    expect(row.source).toEqual({
      lines: '1-134', org: 'krateo-platformops', path: 'helm/core-provider/templates/deployment.yaml', ref: '2.13.4', repo: 'core-provider',
    })
    expect(row.url).toBe('https://github.com/krateo-platformops/core-provider/blob/2.13.4/helm/core-provider/templates/deployment.yaml#L1-L134')
    // No file content — only the coordinates read off the provenance header.
    expect(JSON.stringify(row)).not.toContain('apiVersion')
  })

  it('counts a search\'s matches without keeping them', () => {
    const [row] = evidenceFromParts([
      call('search_repo', { pattern: 'env:', repo: 'core-provider' }, 'c2'),
      result('search_repo', SEARCH_OUTPUT, 'c2'),
    ])
    expect(row.note).toBe('2 results')
    expect(row.source).toMatchObject({ ref: '2.13.4', repo: 'core-provider' })
    expect(row.source?.path).toBeUndefined()
    expect(JSON.stringify(row)).not.toContain('values.yaml:144')
  })

  it('marks a failed tool call', () => {
    const [row] = evidenceFromParts([
      call('read_repo_file', { path: 'nope.yaml', repo: 'authn' }, 'c3'),
      result('read_repo_file', "Error: file 'nope.yaml' not found in 'authn' (authn @ 0.27.2).", 'c3'),
    ])
    expect(row.failed).toBe(true)
  })

  it('surfaces a delegation as the specialist plus the session its own calls live in', () => {
    const [row] = evidenceFromParts([
      call('krateo_system__NS__core_provider_agent', { request: 'which env vars?' }, 'c4'),
      result('krateo_system__NS__core_provider_agent', undefined, 'c4', { result: 'answer', subagent_session_id: 'sess-9' }),
    ])
    expect(row).toMatchObject({ agent: 'core-provider-agent', kind: 'delegation', request: 'which env vars?', sessionId: 'sess-9' })
  })

  it('leaves protocol tools out — they drive the portal, they are not sources', () => {
    expect(evidenceFromParts([call('propose_portal_action', { verb: 'navigate' }, 'c5')])).toHaveLength(0)
  })

  it('counts a call once when the final artifact repeats the status stream\'s part', () => {
    const parts = [call('read_repo_file', { path: 'a.yaml', repo: 'authn' }, 'c7'), result('read_repo_file', READ_OUTPUT, 'c7')]
    expect(evidenceFromParts([...parts, ...parts])).toHaveLength(1)
  })

  it('keeps an unknown tool\'s arguments, which is the whole row for it', () => {
    const [row] = evidenceFromParts([call('k8s_get_resources', { name: 'core-provider', namespace: 'krateo-system', resource_type: 'deployment' }, 'c6')])
    expect(row).toMatchObject({ kind: 'cluster', tool: 'k8s_get_resources' })
    expect(row.args).toEqual({ name: 'core-provider', namespace: 'krateo-system', resource_type: 'deployment' })
  })
})

const task = (text: string, id: string) => ({ history: [{ parts: [{ kind: 'text', text }], role: 'user' }], id })

const TASKS = [task('an older delegation', 't1'), task('which env vars?', 't2'), task('a later, unrelated one', 't3')]

const delegation = (request: string): EvidenceEntry =>
  ({ agent: 'core-provider-agent', id: 'd1', kind: 'delegation', request, sessionId: 'sess-9', tool: 'krateo_system__NS__core_provider_agent' })

afterEach(() => vi.unstubAllGlobals())

describe('reaching the session trace', () => {
  it('derives the trace base from the configured A2A endpoint in both exposure modes', () => {
    expect(deriveSessionsBase('http://krateo.localhost:8084/api/a2a/krateo-system/autopilot'))
      .toBe('http://krateo.localhost:8084/api/sessions')
    expect(deriveSessionsBase('http://krateo.localhost:8084/api/a2a/krateo-system/agentiko'))
      .toBe('http://krateo.localhost:8084/api/sessions')
    expect(deriveSessionsBase('/agentiko')).toBe('/agentiko/sessions')
    expect(deriveSessionsBase('/autopilot')).toBe('/autopilot/sessions')
    expect(deriveSessionsBase('/autopilot/')).toBe('/autopilot/sessions')
  })

  it('identifies the delegation\'s own task by its request, not by being the newest', () => {
    expect(selectDelegationTask(TASKS, 'which env vars?')?.id).toBe('t2')
  })

  it('reports unknown rather than guessing when no task matches', () => {
    // Mislabelling another turn's calls as this answer's is the one failure this panel must not have.
    expect(selectDelegationTask(TASKS, 'a request from some other thread')).toBeUndefined()
    expect(selectDelegationTask(TASKS, undefined)).toBeUndefined()
    expect(selectDelegationTask([], 'which env vars?')).toBeUndefined()
  })

  it('takes the most recent of identical requests', () => {
    const repeated = [...TASKS, task('which env vars?', 't4')]
    expect(selectDelegationTask(repeated, 'which env vars?')?.id).toBe('t4')
  })

  it('fetches a specialist\'s rows, and refuses to attribute the wrong task', async () => {
    const tasks = [{ history: [{ parts: [{ kind: 'text', text: 'which env vars?' }], role: 'user' }, { parts: [call('read_repo_file', { path: 'main.go', repo: 'core-provider' }, 'x1')], role: 'agent' }], id: 't1' }]
    vi.stubGlobal('fetch', serve({ data: tasks }))
    const rows = await fetchDelegationEvidence('/autopilot/sessions', delegation('which env vars?'), {})
    expect(rows.map((row) => row.tool)).toEqual(['read_repo_file'])
    await expect(fetchDelegationEvidence('/autopilot/sessions', delegation('a different request'), {})).rejects.toThrow()
  })

  it('surfaces an unreadable trace instead of an empty one', async () => {
    vi.stubGlobal('fetch', serve({ error: true, message: 'forbidden' }, 403))
    await expect(fetchDelegationEvidence('/autopilot/sessions', delegation('x'), {})).rejects.toThrow('403')
  })

  // frontend#181. Every one of these used to reach the panel as the single sentence "its activity is
  // not readable from here" — the one fact the reader already had. They have different owners: an
  // expired session is theirs to fix, a 403 is an authorization boundary, a 404 means nothing was
  // ever recorded. A panel that exists so an answer can be CHECKED has to say which.
  it.each([
    [401, /session expired/i],
    [403, /refused|permissions/i],
    [404, /kept no session|never/i],
    [503, /returned 503/],
  ])('names WHY a trace could not be read (%i)', async (status, expected) => {
    vi.stubGlobal('fetch', serve({ error: true, message: 'x' }, status))
    await expect(fetchDelegationEvidence('/autopilot/sessions', delegation('x'), {})).rejects.toThrow(expected)
  })

  it('distinguishes "recorded nothing at all" from "not this delegation"', async () => {
    // The first is the signature of a specialist that ran no tools at all — exactly what someone
    // opening this panel is trying to find out. It deliberately does NOT claim the specialist
    // "answered": it may equally have failed before it started, which is what actually happened in
    // the outage traced through agentgateway-policies#55 (see the failed-task case below).
    vi.stubGlobal('fetch', serve({ data: [] }))
    await expect(fetchDelegationEvidence('/autopilot/sessions', delegation('x'), {}))
      .rejects.toThrow(/recorded no activity/i)

    const other = [{ history: [{ parts: [{ kind: 'text', text: 'someone else\'s turn' }], role: 'user' }], id: 't9' }]
    vi.stubGlobal('fetch', serve({ data: other }))
    await expect(fetchDelegationEvidence('/autopilot/sessions', delegation('x'), {}))
      .rejects.toThrow(/not identifiable among the 1 task/i)
  })

  it('surfaces the cause when the task failed before the specialist reasoned', async () => {
    // kagent puts the cause in status.message, NOT in history — the only place this used to look.
    // So a hard failure rendered as an EMPTY trace that said nothing, and a total delegation outage
    // was indistinguishable from a specialist with nothing to say. This is the real message every
    // delegation returned while a prompt placeholder was unresolvable (frontend-agent#13).
    const failed = [{
      ...task('x', 't7'),
      status: {
        message: { parts: [{ kind: 'text', text: 'failed to append instructions: failed to inject session state into instruction: state key does not exist' }], role: 'agent' },
        state: 'failed',
      },
    }]
    vi.stubGlobal('fetch', serve({ data: failed }))
    await expect(fetchDelegationEvidence('/autopilot/sessions', delegation('x'), {}))
      .rejects.toThrow(/failed before returning — failed to append instructions/i)
  })

  it('says a failed task failed even when it recorded no reason', async () => {
    const bare = [{ ...task('x', 't8'), status: { state: 'failed' } }]
    vi.stubGlobal('fetch', serve({ data: bare }))
    await expect(fetchDelegationEvidence('/autopilot/sessions', delegation('x'), {}))
      .rejects.toThrow(/failed before returning, and recorded no reason/i)
  })

  it('still returns the trace for a task that did not fail', async () => {
    // Guard the happy path: a completed task must not be swallowed by the failed-state branch.
    const ok = [{ ...task('x', 't9'), status: { state: 'completed' } }]
    vi.stubGlobal('fetch', serve({ data: ok }))
    await expect(fetchDelegationEvidence('/autopilot/sessions', delegation('x'), {})).resolves.toEqual([])
  })

  // The three ways a delegation still reached the reader with nothing to act on AFTER the statuses
  // above were named. Each one bypasses them: no request is made, the request never completes, or it
  // completes with a body that is not a trace.
  it('will not pass off an unlooked-at trace as an empty one', async () => {
    // No subagent_session_id means there is nothing to fetch. Resolving [] rendered as "no tool calls
    // recorded" — a claim about the specialist's work that nobody checked. Worse, the panel skips
    // fetching these rows entirely, so the hop expanded to a BLANK box: the #181 complaint, with even
    // the one sentence removed.
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(fetchDelegationEvidence('/autopilot/sessions', { ...delegation('x'), sessionId: undefined }, {}))
      .rejects.toThrow(/no session id/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('names an unreachable session store rather than echoing the browser', async () => {
    // A rejected fetch never reaches the status table, so `TypeError: Failed to fetch` — which names
    // neither what was being reached nor what to do — went to the reader verbatim.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(fetchDelegationEvidence('/autopilot/sessions', delegation('x'), {}))
      .rejects.toThrow(/could not reach the session store/i)
  })

  // What krateo-057 actually answered on 2026-11-10 for the rail's session read: `curl -D -` on
  // https://portal.krateo.dev/api/sessions/<id>/tasks gave `HTTP/2 200`, `server: nginx/1.30.6`,
  // `content-type: text/html` and this page — the portal's own index.html, because the TLS gateway
  // listener had no /api/sessions route and the SPA's catch-all `try_files … /index.html` took it.
  const PORTAL_INDEX = '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Krateo</title>\n'

  it('calls the session store at the path 057\'s config derives', async () => {
    // AGENTIKO_API_BASE_URL in 057's frontend-config-vars, verbatim. The rail fetched the right path;
    // the gateway did not route it (agentgateway-policies). Pinned so a fix there is not chased here.
    const fetchSpy = serve({ data: [] })
    vi.stubGlobal('fetch', fetchSpy)
    const base = deriveSessionsBase('https://portal.krateo.dev/api/a2a/krateo-system/agentiko')
    expect(base).toBe('https://portal.krateo.dev/api/sessions')
    await fetchDelegationEvidence(base, delegation('x'), { Authorization: 'Bearer t' }).catch(() => undefined)
    expect(fetchSpy).toHaveBeenCalledWith('https://portal.krateo.dev/api/sessions/sess-9/tasks', { headers: { Authorization: 'Bearer t' } })
  })

  it('says a web page came back instead of data, with the status, when 057\'s answer arrives', async () => {
    vi.stubGlobal('fetch', serve(PORTAL_INDEX, 200, 'text/html'))
    await expect(fetchDelegationEvidence('https://portal.krateo.dev/api/sessions', delegation('x'), {}))
      .rejects.toThrow('the activity endpoint returned a web page instead of data (HTTP 200, text/html)')
  })

  it('does not read an HTML 404 as "no session was kept"', async () => {
    // kagent answers a missing session with a JSON 404. A web server's HTML 404 says nothing about
    // the specialist, so it must not get the 404 sentence from the status table.
    vi.stubGlobal('fetch', serve('<html><body>404 Not Found</body></html>', 404, 'text/html; charset=utf-8'))
    await expect(fetchDelegationEvidence('/agentiko/sessions', delegation('x'), {}))
      .rejects.toThrow('web page instead of data (HTTP 404, text/html; charset=utf-8)')
  })

  it('catches an HTML page even when it is mislabelled', async () => {
    vi.stubGlobal('fetch', serve(PORTAL_INDEX, 200, 'application/json'))
    await expect(fetchDelegationEvidence('/agentiko/sessions', delegation('x'), {}))
      .rejects.toThrow('web page instead of data (HTTP 200, application/json)')
  })

  it('names a body that is not JSON at all', async () => {
    vi.stubGlobal('fetch', serve('upstream connect error', 200, 'text/plain'))
    await expect(fetchDelegationEvidence('/agentiko/sessions', delegation('x'), {}))
      .rejects.toThrow('the activity endpoint returned something that is not JSON (HTTP 200, text/plain)')
  })

  it('will not read some other service\'s JSON as "recorded no activity"', async () => {
    vi.stubGlobal('fetch', serve([{ id: 'not-a-task-list-envelope' }]))
    await expect(fetchDelegationEvidence('/agentiko/sessions', delegation('x'), {}))
      .rejects.toThrow('JSON that is not a session\'s task list (HTTP 200)')
    vi.stubGlobal('fetch', serve({ data: 'nope' }))
    await expect(fetchDelegationEvidence('/agentiko/sessions', delegation('x'), {}))
      .rejects.toThrow('JSON that is not a session\'s task list')
  })

  it('reads kagent\'s empty session, which omits `data`, as a session with no tasks', async () => {
    // StandardResponse tags Data `json:"data,omitempty"` (kagent 0.10.1 go/api/httpapi/types.go), so
    // a session with no tasks arrives with no `data` key at all. The stricter shape check above must
    // not turn that into a failure.
    vi.stubGlobal('fetch', serve({ error: false, message: 'Successfully retrieved session tasks' }))
    await expect(fetchDelegationEvidence('/agentiko/sessions', delegation('x'), {}))
      .rejects.toThrow(/recorded no activity/i)
  })
})

describe('panel headline and naming', () => {
  it('reports an ungrounded turn honestly instead of showing nothing', () => {
    expect(summarizeEvidence([])).toBe('No tools used — answered from the page context')
  })

  it('counts lookups, distinct files and specialists', () => {
    const rows = evidenceFromParts([
      call('read_repo_file', { path: 'a.yaml', repo: 'authn' }, 'c1'),
      call('read_repo_file', { path: 'a.yaml', repo: 'authn' }, 'c2'),
      call('krateo_system__NS__snowplow_agent', { request: 'x' }, 'c3'),
    ])
    expect(summarizeEvidence(rows)).toBe('3 lookups · 1 file · 1 specialist')
  })

  it('maps a repo to its org by tier shape', () => {
    expect(orgOfRepo('core-provider')).toBe('krateo-platformops')
    expect(orgOfRepo('krateo-aws-blueprint')).toBe('krateo-blueprints')
    expect(orgOfRepo('krateo-zendesk-kog')).toBe('krateo-blueprints')
    expect(orgOfRepo('krateo-autopilot')).toBe('krateo-agentiko')
    expect(orgOfRepo('agentiko')).toBe('krateo-agentiko')
  })

  it('reads a specialist name out of the agent tool name', () => {
    expect(agentFromToolName('krateo_system__NS__core_provider_agent')).toBe('core-provider-agent')
    expect(agentFromToolName('read_repo_file')).toBeUndefined()
  })
})

describe('arguments are metadata, but still scrubbed', () => {
  const args = (value: Record<string, unknown>): EvidenceEntry => ({ args: value, id: 'a1', kind: 'tool', tool: 't' })
  // Assembled at runtime: a JWT-shaped literal in the tree is itself a secret-scan finding.
  const jwtShaped = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJhZG1pbiJ9', 'c2lnbmF0dXJl'].join('.')

  it('redacts a credential-shaped argument through the shared denylist', () => {
    const described = describeArgs(args({ password: 'hunter2', token: 'abc', values: `auth: ${jwtShaped}` }))
    expect(described).toContain('[redacted]')
    expect(described).not.toContain('hunter2')
    expect(described).toContain('[redacted-jwt]')
  })

  it('clamps each argument on its own, so a manifest cannot crowd out the rest', () => {
    const manifest = `apiVersion: v1\nkind: ConfigMap\n${'  greeting: hello there\n'.repeat(40)}`
    const described = describeArgs(args({ manifest, namespace: 'krateo-system' }))
    expect(described).toContain('apiVersion: v1 kind: ConfigMap')
    expect(described).toContain('…')
    // The clamped manifest cannot swallow the argument that identifies the target.
    expect(described).toContain('namespace: krateo-system')
  })

  it('redacts a long base64 blob — a Secret payload — wherever it sits', () => {
    expect(describeArgs(args({ manifest: `data:\n  key: ${'QUJD'.repeat(30)}` }))).toContain('[redacted]')
  })

  it('full: true skips the length caps (for the hover title) but still redacts', () => {
    const query = `SELECT ServiceName, count() FROM otel_logs WHERE ${'Body ILIKE \'%err%\' OR '.repeat(60)}1 GROUP BY ServiceName`
    const clamped = describeArgs(args({ query }))
    const full = describeArgs(args({ query }), { full: true })
    // the inline display still caps a pathological value
    expect(clamped).toContain('…')
    // the full form shows it whole
    expect(full).not.toContain('…')
    // including the tail the clamp dropped
    expect(full).toContain('GROUP BY ServiceName')
    // redaction is not bypassed by full
    expect(describeArgs(args({ password: 'hunter2' }), { full: true })).not.toContain('hunter2')
  })

  it('leaves the delegated request out — the specialist row already carries it', () => {
    expect(describeArgs(args({ request: 'a long delegated question' }))).toBe('')
  })
})

describe('serializeEvidence — copy-to-clipboard text', () => {
  it('summarizes then lists each row (tool + meta), never tool output', () => {
    const evidence: EvidenceEntry[] = [
      { id: '1', kind: 'repo', source: { org: 'krateo', path: 'main.go', ref: 'v1', repo: 'core' }, tool: 'get_file_content', url: 'https://x/main.go' },
      { args: { resource: 'pods' }, id: '2', kind: 'cluster', tool: 'k8s_get' },
    ]
    const text = serializeEvidence(evidence)
    expect(text.split('\n')[0]).toBe(summarizeEvidence(evidence))
    expect(text).toContain('- get_file_content: krateo/core @ v1 — https://x/main.go')
    expect(text).toContain('- k8s_get: resource: pods')
  })

  it('renders a delegated hop as a specialist line', () => {
    const evidence: EvidenceEntry[] = [{ agent: 'k8s-agent', id: 'd', kind: 'delegation', tool: 'call' }]
    expect(serializeEvidence(evidence)).toContain('- k8s-agent (specialist)')
  })

  it('nests the specialist\'s own lookups under it when they are resolved (all evidence levels, not just the first)', () => {
    const evidence: EvidenceEntry[] = [
      { agent: 'clickstack-agent', id: 'd', kind: 'delegation', sessionId: 's-1', tool: 'call' },
    ]
    const childrenBySession = {
      's-1': [
        { args: { query: 'SELECT count() FROM otel_logs' }, id: 'c1', kind: 'cluster' as const, tool: 'run_select_query' },
        { args: { query: 'SELECT now()' }, id: 'c2', kind: 'cluster' as const, tool: 'run_select_query' },
      ],
    }
    const text = serializeEvidence(evidence, childrenBySession)
    // Header carries the resolved child count; each child is indented under the specialist.
    expect(text).toContain('- clickstack-agent (specialist · 2 lookups)')
    expect(text).toContain('  - run_select_query: query: SELECT count() FROM otel_logs')
    expect(text).toContain('  - run_select_query: query: SELECT now()')
  })

  it('falls back to the bare specialist line when a hop\'s children are unresolved', () => {
    const evidence: EvidenceEntry[] = [
      { agent: 'k8s-agent', id: 'd', kind: 'delegation', sessionId: 's-2', tool: 'call' },
    ]
    // sessionId present but not in the map (not fetched / unreadable) → no count, no nested rows.
    const text = serializeEvidence(evidence, {})
    expect(text).toContain('- k8s-agent (specialist)')
    expect(text).not.toContain('lookups')
  })

  it('flags a failed row', () => {
    const evidence: EvidenceEntry[] = [{ args: {}, failed: true, id: 'f', kind: 'cluster', tool: 'k8s_get' }]
    expect(serializeEvidence(evidence)).toContain('· failed')
  })

  it('copies the FULL unclamped argument — not the inline-clamped one', () => {
    const query = `SELECT ServiceName FROM otel_logs WHERE ${'Body ILIKE \'%err%\' OR '.repeat(60)}1`
    const evidence: EvidenceEntry[] = [{ args: { query }, id: 'q', kind: 'cluster', tool: 'run_select_query' }]
    const text = serializeEvidence(evidence)
    // the whole query is present in the copied text (no ellipsis truncation)
    expect(text).toContain(query.replace(/\s+/g, ' ').trim())
    expect(text).not.toContain('…')
    // redaction still applies on the copy path
    const secret: EvidenceEntry[] = [{ args: { password: 'hunter2' }, id: 's', kind: 'cluster', tool: 'x' }]
    expect(serializeEvidence(secret)).not.toContain('hunter2')
  })
})

describe('the completion marker and the frame clock (run timeline)', () => {
  const open = (): EvidenceEntry[] => recordToolFrame([], { args: { resource_type: 'pods' }, id: 'c1', kind: 'tool_call', name: 'k8s_get_resources' }, 1000)

  it('a call opens a row stamped with when its frame arrived, not yet done', () => {
    const [entry] = open()
    expect(entry.startedAt).toBe(1000)
    expect(entry.done).toBeUndefined()
  })

  it('its result marks it done and stamps when that arrived — `failed` alone could not say it', () => {
    const [entry] = recordToolFrame(open(), { id: 'c1', kind: 'tool_result', name: 'k8s_get_resources', output: 'pod/x' }, 1400)
    expect([entry.done, entry.failed, entry.endedAt]).toEqual([true, undefined, 1400])
  })

  it('a repeated result (the final artifact re-carrying a part) keeps the first arrival time', () => {
    const once = recordToolFrame(open(), { id: 'c1', kind: 'tool_result', name: 'k8s_get_resources', output: 'ok' }, 1400)
    const twice = recordToolFrame(once, { id: 'c1', kind: 'tool_result', name: 'k8s_get_resources', output: 'ok' }, 9000)
    expect(twice[0].endedAt).toBe(1400)
  })

  it('a repeated call keeps the first start time', () => {
    const again = recordToolFrame(open(), { args: {}, id: 'c1', kind: 'tool_call', name: 'k8s_get_resources' }, 5000)
    expect(again).toHaveLength(1)
    expect(again[0].startedAt).toBe(1000)
  })

  it('a failed result is BOTH done and failed, and keeps the first line of its error as the reason', () => {
    const [entry] = mergeToolResult(open(), { id: 'c1', isError: true, name: 'k8s_get_resources', output: 'Error: pods is forbidden: cannot list\nstack…', type: 'result' })
    expect([entry.done, entry.failed, entry.reason]).toEqual([true, true, 'pods is forbidden: cannot list'])
  })

  it('a successful result keeps no reason and no payload', () => {
    const [entry] = mergeToolResult(open(), { id: 'c1', name: 'k8s_get_resources', output: 'secret-ish payload', type: 'result' })
    expect(entry.reason).toBeUndefined()
    expect(JSON.stringify(entry)).not.toContain('secret-ish payload')
  })

  it('a row folded from stored history carries no times — there was no frame to clock', () => {
    const [entry] = evidenceFromParts([call('k8s_get_resources', { resource_type: 'pods' }, 'c1'), result('k8s_get_resources', 'ok', 'c1')])
    expect([entry.startedAt, entry.endedAt]).toEqual([undefined, undefined])
  })
})
