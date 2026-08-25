/**
 * Evidence coverage. Every wire shape here was captured off the live kagent 0.9.12 A2A stream and
 * off `GET /api/sessions/<id>/tasks`. The metadata-only invariant is asserted by checking what a
 * row carries after a result whose body is a whole file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  agentFromToolName,
  deriveSessionsBase,
  describeArgs,
  evidenceFromParts,
  fetchDelegationEvidence,
  orgOfRepo,
  readToolPart,
  selectDelegationTask,
  summarizeEvidence,
} from './evidence'

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

describe('reaching the session trace', () => {
  it('derives the trace base from the configured A2A endpoint in both exposure modes', () => {
    expect(deriveSessionsBase('http://krateo.localhost:8084/api/a2a/krateo-system/autopilot'))
      .toBe('http://krateo.localhost:8084/api/sessions')
    expect(deriveSessionsBase('/autopilot')).toBe('/autopilot/sessions')
    expect(deriveSessionsBase('/autopilot/')).toBe('/autopilot/sessions')
  })

  it('identifies the delegation\'s own task by its request, not by being the newest', () => {
    const task = (text: string, id: string) => ({ history: [{ parts: [{ kind: 'text', text }], role: 'user' }], id })
    const tasks = [task('an older delegation', 't1'), task('which env vars?', 't2'), task('a later, unrelated one', 't3')]
    expect(selectDelegationTask(tasks, 'which env vars?')?.id).toBe('t2')
    // A request that matches no task → pin nothing rather than mislabel this answer with a
    // different turn's calls (the panel then shows "no tool calls recorded").
    expect(selectDelegationTask(tasks, 'a request no task carries')).toBeUndefined()
    // Nothing to match on and several tasks → we cannot know which is this turn's; guess nothing.
    expect(selectDelegationTask(tasks, undefined)).toBeUndefined()
    // A single-task session with no request IS unambiguous → pin it.
    expect(selectDelegationTask([task('only one', 't1')], undefined)?.id).toBe('t1')
    // Two tasks in the same session share the request text (a re-delegated phrasing) → the newest
    // matching task wins the tie (best-effort within an already-authorized session).
    expect(selectDelegationTask([task('same ask', 'd1'), task('same ask', 'd2')], 'same ask')?.id).toBe('d2')
  })
})

describe('the delegation trace fetch is read-only and fails closed', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const entry = { id: 'x', kind: 'delegation', request: 'q', sessionId: 'sess-1' } as never

  it('throws on a forbidden (non-ok) response — 403 surfaces as unreadable, not data', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 403 } as Response)))
    await expect(fetchDelegationEvidence('/autopilot/sessions', entry, {})).rejects.toThrow('session trace unavailable (403)')
  })

  it('returns the specialist\'s metadata rows on a readable response', async () => {
    const body = { data: [{ history: [
      { parts: [{ kind: 'text', text: 'q' }], role: 'user' },
      { parts: [{ data: { args: { repo: 'authn' }, id: 'k1', name: 'search_repo' }, kind: 'data', metadata: { adk_type: 'function_call' } }], role: 'agent' },
    ],
    id: 't1' }] }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve(body), ok: true } as unknown as Response)))
    const rows = await fetchDelegationEvidence('/autopilot/sessions', entry, {})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ tool: 'search_repo' })
  })
})

describe('rendered arguments are redacted', () => {
  it('scrubs a credential-bearing tool argument, keeps benign ones', () => {
    const line = describeArgs({ args: { name: 'demo', note: 'ok', token: 'sk-abcdef123456' }, kind: 'cluster', tool: 'k8s_apply_manifest' } as never)
    expect(line).toContain('name: demo')
    expect(line).toContain('token: [redacted]')
    expect(line).not.toContain('sk-abcdef123456')
  })

  it('caps a large value (a manifest body) to a snippet', () => {
    const manifest = 'kind: Deployment\nspec:\n  replicas: 3\n'.repeat(20)
    const line = describeArgs({ args: { manifest }, kind: 'cluster', tool: 'k8s_apply_manifest' } as never)
    expect(line).toContain('manifest: ')
    expect(line).toContain('…')
    expect(line.length).toBeLessThan(200)
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
  })

  it('reads a specialist name out of the agent tool name', () => {
    expect(agentFromToolName('krateo_system__NS__core_provider_agent')).toBe('core-provider-agent')
    expect(agentFromToolName('read_repo_file')).toBeUndefined()
  })
})
