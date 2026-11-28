// @vitest-environment jsdom
/**
 * The `?agentiko=<contextId>` approval link's reads (approvalLink.ts), against the response shapes of
 * kagent v0.10.1's session API (handlers/sessions.go: HandleGetSession wraps { session, events };
 * HandleListTasksForSession returns legacy-wire A2A Tasks when no A2A-Version header is sent).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createExplicitApprovalGovernor } from './approval'
import { agentRefOfSessionAgentId, isRailAgent, linkedApprovalNotice, loadLinkedApproval, railNamespaceOf } from './approvalLink'

const BASE = 'https://gw.example/api/sessions'
const RAIL = { agent: 'agentiko', namespace: 'krateo-system' }

const confirmation = (id: string, tool = 'k8s_delete_resource', subagent = 'k8s-agent') => ({
  data: { args: { originalFunctionCall: { args: { name: 'payments-api' }, id: `call-${id}`, name: tool }, toolConfirmation: { confirmed: false, payload: { subagent_name: subagent } } }, id, name: 'adk_request_confirmation' },
  kind: 'data',
  metadata: { kagent_is_long_running: true, kagent_type: 'function_call' },
})
const task = (id: string, state: string, timestamp: string, parts: unknown[] = []) => ({
  contextId: 'ctx-1', id, kind: 'task', status: { message: { kind: 'message', messageId: `m-${id}`, parts, role: 'agent' }, state, timestamp },
})

const serve = (routes: Record<string, { body?: unknown; status?: number }>) => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    calls.push(url)
    const route = routes[url] ?? { status: 404 }
    return Promise.resolve({ json: () => Promise.resolve(route.body), ok: (route.status ?? 200) < 400, status: route.status ?? 200 })
  }))
  return calls
}
const session = (agentId?: string) => ({ body: { data: { events: [], session: { id: 'ctx-1', user_id: 'alice', ...(agentId ? { agent_id: agentId } : {}), source: 'user' } } } })

describe('loadLinkedApproval', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('finds the input-required task and turns it into the card the rail already draws', async () => {
    const calls = serve({
      [`${BASE}/ctx-1`]: session('krateo_system__NS__agentiko'),
      [`${BASE}/ctx-1/tasks`]: { body: { data: [task('t-done', 'completed', '2026-11-21T09:00:00Z'), task('t-paused', 'input-required', '2026-11-21T10:00:00Z', [confirmation('conf-1')])] } },
    })
    const result = await loadLinkedApproval(BASE, 'ctx-1', RAIL, { Authorization: 'Bearer x' })
    expect(result).toEqual({
      kind: 'paused',
      pause: {
        contextId: 'ctx-1',
        requests: [{ agentName: 'k8s-agent', argumentsPreview: expect.stringContaining('payments-api') as string, requestId: 'conf-1', toolCallId: 'call-conf-1', toolName: 'k8s_delete_resource' }],
        taskId: 't-paused',
      },
    })
    expect(calls).toEqual([`${BASE}/ctx-1`, `${BASE}/ctx-1/tasks`])
    // As the caller: the rail's own auth header goes on both reads.
    expect((fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.every(([, init]) => (init.headers as Record<string, string>).Authorization === 'Bearer x')).toBe(true)
  })

  it('with two paused tasks, the most recently updated one is the decision', async () => {
    serve({
      [`${BASE}/ctx-1`]: session('krateo_system__NS__agentiko'),
      [`${BASE}/ctx-1/tasks`]: { body: { data: [task('older', 'input-required', '2026-11-21T08:00:00Z', [confirmation('a')]), task('newer', 'input-required', '2026-11-21T10:00:00Z', [confirmation('b')])] } },
    })
    const result = await loadLinkedApproval(BASE, 'ctx-1', RAIL, {})
    expect(result.kind === 'paused' && result.pause.taskId).toBe('newer')
  })

  it('a session with nothing waiting says so', async () => {
    serve({ [`${BASE}/ctx-1`]: session('krateo_system__NS__agentiko'), [`${BASE}/ctx-1/tasks`]: { body: { data: [task('t', 'completed', '2026-11-21T10:00:00Z')] } } })
    expect(await loadLinkedApproval(BASE, 'ctx-1', RAIL, {})).toEqual({ kind: 'nothing-pending' })
  })

  it('an input-required task with no confirmation part is not a decision', async () => {
    serve({ [`${BASE}/ctx-1`]: session('krateo_system__NS__agentiko'), [`${BASE}/ctx-1/tasks`]: { body: { data: [task('t', 'input-required', '2026-11-21T10:00:00Z', [{ kind: 'text', text: 'which namespace?' }])] } } })
    expect(await loadLinkedApproval(BASE, 'ctx-1', RAIL, {})).toEqual({ kind: 'nothing-pending' })
  })

  it("another agent's session is refused before its tasks are read: an approve sent there could never land", async () => {
    const calls = serve({ [`${BASE}/ctx-1`]: session('krateo_system__NS__k8s_agent') })
    expect(await loadLinkedApproval(BASE, 'ctx-1', RAIL, {})).toEqual({ agent: 'krateo-system/k8s-agent', kind: 'other-agent' })
    expect(calls).toEqual([`${BASE}/ctx-1`])
  })

  it('404 (no such session, or not this person’s) and other failures are told apart', async () => {
    serve({})
    expect(await loadLinkedApproval(BASE, 'ctx-1', RAIL, {})).toEqual({ kind: 'not-found' })
    serve({ [`${BASE}/ctx-1`]: { status: 502 } })
    expect(await loadLinkedApproval(BASE, 'ctx-1', RAIL, {})).toEqual({ kind: 'error', status: 502 })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await loadLinkedApproval(BASE, 'ctx-1', RAIL, {})).toEqual({ kind: 'error' })
  })

  it('the contextId is encoded into the path', async () => {
    const calls = serve({})
    await loadLinkedApproval(`${BASE}/`, 'a/b c', RAIL, {})
    expect(calls[0]).toBe(`${BASE}/a%2Fb%20c`)
  })
})

describe('whose session it is', () => {
  it('kagent stores agent ids as Python identifiers; the rail compares namespace/name', () => {
    expect(agentRefOfSessionAgentId('krateo_system__NS__agentiko')).toBe('krateo-system/agentiko')
    expect(isRailAgent('krateo_system__NS__agentiko', 'agentiko', 'krateo-system')).toBe(true)
    expect(isRailAgent('other_ns__NS__agentiko', 'agentiko', 'krateo-system')).toBe(false)
    expect(isRailAgent('krateo_system__NS__agentiko', 'agentiko')).toBe(true)
    expect(isRailAgent('krateo_system__NS__k8s_agent', 'agentiko', 'krateo-system')).toBe(false)
  })

  it("the rail's namespace comes from its gateway endpoint, when it names one", () => {
    expect(railNamespaceOf('https://gw.example/api/a2a/krateo-system/agentiko')).toBe('krateo-system')
    expect(railNamespaceOf('https://gw.example/api/a2a/krateo-system/agentiko/')).toBe('krateo-system')
    expect(railNamespaceOf('https://agentiko.example')).toBeUndefined()
  })
})

describe('what the rail says when a link opens no decision', () => {
  it('names each outcome, never a blank', () => {
    expect(linkedApprovalNotice({ kind: 'nothing-pending' })).toContain('already decided')
    expect(linkedApprovalNotice({ kind: 'not-found' })).toContain("doesn't open a conversation of yours")
    expect(linkedApprovalNotice({ agent: 'krateo-system/k8s-agent', kind: 'other-agent' })).toContain('krateo-system/k8s-agent')
    expect(linkedApprovalNotice({ kind: 'error', status: 502 })).toContain('HTTP 502')
    expect(linkedApprovalNotice({ kind: 'error' })).not.toContain('HTTP')
  })
})

describe('the explicit-only governor', () => {
  it('has no timer: hours pass and nothing settles it; the first decision wins', () => {
    vi.useFakeTimers()
    const governor = createExplicitApprovalGovernor()
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(governor.settle()).toBe(true)
    expect(governor.settle()).toBe(false)
    vi.useRealTimers()
  })
})
