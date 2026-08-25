/**
 * Evidence coverage. Every wire shape here was captured off the live kagent 0.9.12 A2A stream and
 * off `GET /api/sessions/<id>/tasks`. The metadata-only invariant is asserted by checking what a
 * row carries after a result whose body is a whole file.
 */
import { describe, expect, it } from 'vitest'

import {
  agentFromToolName,
  deriveSessionsBase,
  evidenceFromParts,
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
    // Nothing to match on → the newest task is the best guess available.
    expect(selectDelegationTask(tasks, undefined)?.id).toBe('t3')
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
