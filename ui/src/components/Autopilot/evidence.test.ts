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
  orgOfRepo,
  readToolPart,
  selectDelegationTask,
  serializeEvidence,
  summarizeEvidence,
} from './evidence'
import type { EvidenceEntry } from './types'

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
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ data: tasks }), ok: true })))
    const rows = await fetchDelegationEvidence('/autopilot/sessions', delegation('which env vars?'), {})
    expect(rows.map((row) => row.tool)).toEqual(['read_repo_file'])
    await expect(fetchDelegationEvidence('/autopilot/sessions', delegation('a different request'), {})).rejects.toThrow()
  })

  it('surfaces an unreadable trace instead of an empty one', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({}), ok: false, status: 403 })))
    await expect(fetchDelegationEvidence('/autopilot/sessions', delegation('x'), {})).rejects.toThrow('403')
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

  it('flags a failed row', () => {
    const evidence: EvidenceEntry[] = [{ args: {}, failed: true, id: 'f', kind: 'cluster', tool: 'k8s_get' }]
    expect(serializeEvidence(evidence)).toContain('· failed')
  })
})
