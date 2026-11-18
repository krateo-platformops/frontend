import { afterEach, describe, expect, it, vi } from 'vitest'

import { discoverRun, foldRunEvents, followRun, type LiveDelegation, readStoredEvent } from './liveDelegation'
import type { EvidenceEntry } from './types'

const TOOL = 'krateo_system__NS__clickstack_agent'
const REQUEST = 'Investigate logs for the firing alert.'
const T0 = Date.parse('2026-11-18T14:10:50Z')

/** A row as kagent 0.10.1 serves it: the ADK event JSON-encoded under `data`, Go field names. */
const row = (id: string, createdAt: string, event: Record<string, unknown>) => ({
  created_at: createdAt,
  data: JSON.stringify({ Author: 'clickstack_agent', InvocationID: 'inv-1', Partial: false, ...event }),
  id,
  session_id: 'sub-1',
  user_id: 'admin',
})

const asked = (createdAt: string, invocation = 'inv-1', text = REQUEST) =>
  row(`u-${invocation}`, createdAt, { Author: 'user', Content: { parts: [{ text }], role: 'user' }, InvocationID: invocation })

const handOff: EvidenceEntry = { agent: 'clickstack-agent', id: 'd1', kind: 'delegation', request: REQUEST, startedAt: T0 + 1_000, tool: TOOL }

const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status }))

afterEach(() => { vi.unstubAllGlobals() })

describe('readStoredEvent', () => {
  it('reads author, invocation, request text and tool parts, and skips thoughts', () => {
    const event = readStoredEvent(row('e1', '2026-11-18T14:10:54.131356Z', {
      Content: {
        parts: [
          { text: 'thinking…', thought: true },
          { functionCall: { args: { query: 'DESCRIBE otel_logs' }, id: 'c1', name: 'run_query' } },
        ],
        role: 'model',
      },
    }))
    expect(event).toMatchObject({ author: 'clickstack_agent', invocationId: 'inv-1', partial: false, text: '' })
    expect(event?.tools).toEqual([{ args: { query: 'DESCRIBE otel_logs' }, id: 'c1', name: 'run_query', type: 'call' }])
  })

  it('reads both stored response shapes: {output: {...}} and {error}', () => {
    const ok = readStoredEvent(row('r1', '2026-11-18T14:10:54Z', { Content: { parts: [{ functionResponse: { id: 'c1', name: 'run_query', response: { output: { result: '{"rows": []}' } } } }] } }))
    const bad = readStoredEvent(row('r2', '2026-11-18T14:10:55Z', { Content: { parts: [{ functionResponse: { id: 'c2', name: 'run_query', response: { error: 'Tool execution failed.' } } }] } }))
    expect(ok?.tools[0]).toMatchObject({ isError: false, output: '{"rows": []}', type: 'result' })
    expect(bad?.tools[0]).toMatchObject({ isError: true, output: 'Error: Tool execution failed.', type: 'result' })
  })

  it('rejects a row that is not a stored event', () => {
    expect(readStoredEvent({ id: 'x' })).toBeUndefined()
    expect(readStoredEvent({ created_at: 'now', data: '{not json', id: 'x' })).toBeUndefined()
  })
})

describe('foldRunEvents', () => {
  const start: LiveDelegation = { children: [], cursor: { afterMs: T0, invocationId: 'inv-1', seen: [], sessionId: 'sub-1', skewMs: 0 } }
  const call = (id: string, createdAt: string, invocation = 'inv-1', partial = false) => readStoredEvent(row(`e-${id}`, createdAt, {
    Content: { parts: [{ functionCall: { args: { query: id }, id, name: 'run_query' } }] }, InvocationID: invocation, Partial: partial,
  }))!

  it('keeps only its own invocation, skips partial events, and reads an overlapping event once', () => {
    const once = foldRunEvents(start, [call('a', '2026-11-18T14:10:51Z'), call('b', '2026-11-18T14:10:52Z', 'inv-other'), call('c', '2026-11-18T14:10:53Z', 'inv-1', true)])
    const twice = foldRunEvents(once, [call('a', '2026-11-18T14:10:51Z')])
    expect(twice.children.map((child) => child.id)).toEqual(['a'])
  })

  it('advances the cursor by time, not by string: kagent trims trailing zeros from the fraction', () => {
    // '…51.5Z' sorts after '…51.50001Z' as a string, though it is earlier.
    const folded = foldRunEvents(start, [call('late', '2026-11-18T14:10:51.50001Z'), call('early', '2026-11-18T14:10:51.5Z')])
    expect(folded.cursor?.afterMs).toBe(Date.parse('2026-11-18T14:10:51.50001Z'))
  })

  it('moves times onto the browser clock', () => {
    const skewed = foldRunEvents({ ...start, cursor: { ...start.cursor!, skewMs: 5_000 } }, [call('a', '2026-11-18T14:10:51Z')])
    expect(skewed.children[0].startedAt).toBe(Date.parse('2026-11-18T14:10:51Z') + 5_000)
  })
})

describe('discoverRun', () => {
  const session = (id: string, agentId: string, updatedAt: string) => ({ agent_id: agentId, id, source: 'agent', updated_at: updatedAt })

  it('finds the run by the hand-off’s request in the specialist’s recent session, and its clock skew', async () => {
    const fetchSpy = vi.fn((url: string) => (url === '/s'
      ? respond({ data: [session('other-agent', 'krateo_system__NS__incident_agent', '2026-11-18T14:10:52Z'), session('sub-1', TOOL, '2026-11-18T14:10:52Z'), session('stale', TOOL, '2026-11-18T13:00:00Z')] })
      : respond({ data: { events: [asked('2026-11-18T14:10:51.2Z')] } })))
    vi.stubGlobal('fetch', fetchSpy)
    const cursor = await discoverRun('/s', handOff, new Set(), {})
    expect(cursor).toMatchObject({ invocationId: 'inv-1', sessionId: 'sub-1', skewMs: (T0 + 1_000) - Date.parse('2026-11-18T14:10:51.2Z') })
    expect(fetchSpy.mock.calls.map(([url]) => String(url).split('?')[0])).toEqual(['/s', '/s/sub-1'])
  })

  it('in a shared session, takes the newest matching run that no other hand-off claimed', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => (url === '/s'
      ? respond({ data: [session('sub-1', TOOL, '2026-11-18T14:10:52Z')] })
      : respond({ data: { events: [asked('2026-11-18T14:10:50Z', 'inv-a'), asked('2026-11-18T14:10:51Z', 'inv-b'), asked('2026-11-18T14:10:51Z', 'inv-c', 'another request')] } }))))
    expect((await discoverRun('/s', handOff, new Set(), {}))?.invocationId).toBe('inv-b')
    expect((await discoverRun('/s', handOff, new Set(['inv-b']), {}))?.invocationId).toBe('inv-a')
    expect(await discoverRun('/s', handOff, new Set(['inv-a', 'inv-b']), {})).toBeUndefined()
  })

  it('surfaces a refused read as an error, so the poller can give up', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ error: true }, 403)))
    await expect(discoverRun('/s', handOff, new Set(), {})).rejects.toThrow('HTTP 403')
  })
})

describe('followRun', () => {
  it('asks only for events after the cursor, less a small overlap', async () => {
    const fetchSpy = vi.fn(() => respond({ data: { events: [] } }))
    vi.stubGlobal('fetch', fetchSpy)
    await followRun('/s', { children: [], cursor: { afterMs: T0, invocationId: 'inv-1', seen: [], sessionId: 'sub-1', skewMs: 0 } }, {})
    const url = new URL(String((fetchSpy.mock.calls[0] as unknown[])[0]), 'http://x')
    expect(url.pathname).toBe('/s/sub-1')
    expect(url.searchParams.get('order')).toBe('asc')
    expect(Date.parse(url.searchParams.get('after') ?? '')).toBe(T0 - 2_000)
  })
})
