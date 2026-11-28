// @vitest-environment jsdom
/**
 * The run timeline, rendered: fold and unfold, live → done, failures, the stall, the turn that
 * didn't finish, specialists filling in (and failing to), the approval as a step, and Copy.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigContextModule from '../../context/ConfigContext'

import type { ApprovalPause } from './approval'
import { fetchDelegationEvidence, mergeToolResult } from './evidence'
import { RunTimeline } from './RunTimeline'
import type { AgentikoMessage, EvidenceEntry } from './types'

const copied = vi.hoisted(() => ({ texts: [] as string[] }))

vi.mock('../../context/ConfigContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigContextModule>()),
  useConfigContext: () => ({ config: { api: { AGENTIKO_API_BASE_URL: '/agentiko' } } }),
}))
// The copy library drives document.execCommand, which jsdom does not implement; what matters here
// is the TEXT it is handed.
vi.mock('react-copy-to-clipboard-ts', () => ({
  CopyToClipboard: ({ children, onCopy, text }: { children: ReactElement<{ onClick?: () => void }>; onCopy?: () => void; text: string }) =>
    cloneElement(children, { onClick: () => { copied.texts.push(text); onCopy?.() } }),
}))

const T0 = new Date('2026-11-10T10:00:00Z').getTime()

const read = (id: string, resourceType: string, over: Partial<EvidenceEntry> = {}): EvidenceEntry => ({
  args: { namespace: 'krateo-system', resource_type: resourceType },
  done: true,
  endedAt: T0 + 900,
  id,
  kind: 'cluster',
  startedAt: T0 + 500,
  tool: 'k8s_get_resources',
  ...over,
})

const REQUEST = 'Diagnose composition event-health in krateo-system. Is it healthy? If not, explain why.'

const handOff = (over: Partial<EvidenceEntry> = {}): EvidenceEntry => ({
  agent: 'core-provider-agent',
  args: { request: REQUEST },
  id: 'd1',
  kind: 'delegation',
  request: REQUEST,
  startedAt: T0 + 1000,
  tool: 'krateo_system__NS__core_provider_agent',
  ...over,
})

const turn = (over: Partial<AgentikoMessage> = {}): AgentikoMessage => ({ createdAt: T0, id: 'a1', role: 'assistant', text: '', ...over })

const head = () => screen.getByTestId('agentiko-run-head')
const steps = () => screen.queryAllByTestId('agentiko-run-step')

/** A session store answer carrying a specialist's calls, in the A2A DataPart shape. */
const sessionWith = (calls: { id: string; name: string; args: Record<string, unknown>; isError?: boolean; output?: string }[]) => ({
  data: [{
    history: [
      { parts: [{ kind: 'text', text: REQUEST }], role: 'user' },
      {
        parts: calls.flatMap((call) => [
          { data: { args: call.args, id: call.id, name: call.name }, kind: 'data', metadata: { adk_type: 'function_call' } },
          { data: { id: call.id, name: call.name, response: { isError: call.isError === true, output: call.output ?? 'ok' } }, kind: 'data', metadata: { adk_type: 'function_response' } },
        ]),
        role: 'agent',
      },
    ],
    status: { state: 'completed' },
  }],
})

const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status }))

// antd Timeline renders antd Steps, which reads window.matchMedia; jsdom has none (as in ClaimNotice.test.tsx).
beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  vi.setSystemTime(T0)
  copied.texts.length = 0
  // A live hand-off polls the session store; by default it has nothing stored yet.
  vi.stubGlobal('fetch', vi.fn(() => respond({ data: [] })))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('live → done: one object that folds', () => {
  it('says it is working before the first tool call, and answering once text arrives', () => {
    const { rerender } = render(<RunTimeline message={turn({ streaming: true })} />)
    expect(head().textContent).toContain('Working')
    rerender(<RunTimeline message={turn({ streaming: true, text: 'The comp' })} />)
    expect(head().textContent).toContain('Answering')
  })

  it('is announced politely, and keeps its ticking clocks out of the announcement', () => {
    render(<RunTimeline message={turn({ evidence: [read('a', 'pods', { done: undefined, endedAt: undefined })], streaming: true })} />)
    const run = screen.getByTestId('agentiko-run')
    expect(run.getAttribute('aria-live')).toBe('polite')
    const clocks = run.querySelectorAll('[data-clock]')
    // The header's total and the in-flight step's clock: two, so the loop below cannot pass vacuously.
    expect(clocks).toHaveLength(2)
    for (const clock of clocks) {
      expect(clock.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('runs a clock on the step in flight, then shows its duration once it returns', () => {
    const inFlight = read('a', 'pods', { done: undefined, endedAt: undefined, startedAt: T0 })
    const { rerender } = render(<RunTimeline message={turn({ evidence: [inFlight], streaming: true })} />)
    act(() => { vi.advanceTimersByTime(7_000) })
    expect(steps()[0].getAttribute('data-status')).toBe('running')
    expect(steps()[0].textContent).toContain('0:07')
    expect(head().textContent).toContain('0:07')

    const returned = mergeToolResult([inFlight], { id: 'a', name: 'k8s_get_resources', output: 'pod/x', type: 'result' }, T0 + 7_400)
    rerender(<RunTimeline message={turn({ evidence: returned, streaming: true })} />)
    expect(steps()[0].getAttribute('data-status')).toBe('done')
    expect(steps()[0].textContent).toContain('7.4s')
  })

  it('folds to one line when the answer lands, and opens back into the same tree', () => {
    const evidence = [read('a', 'pods'), read('b', 'services')]
    const { rerender } = render(<RunTimeline message={turn({ evidence, streaming: true })} />)
    expect(steps()).toHaveLength(1)
    expect(steps()[0].textContent).toContain('Read 2 resources')

    rerender(<RunTimeline message={turn({ evidence, lastEventAt: T0 + 41_000, text: 'It is healthy.' })} />)
    expect(steps()).toHaveLength(0)
    expect(head().getAttribute('aria-expanded')).toBe('false')
    expect(head().textContent).toContain('Checked 2 things')
    expect(head().textContent).toContain('0:41')

    fireEvent.click(head())
    expect(head().getAttribute('aria-expanded')).toBe('true')
    expect(steps()[0].textContent).toContain('Read 2 resources')
    fireEvent.click(head())
    expect(steps()).toHaveLength(0)
  })

  it('keeps the raw tool name and its arguments in the hover title', () => {
    render(<RunTimeline message={turn({ evidence: [read('a', 'pods')], streaming: true })} />)
    expect(steps()[0].getAttribute('title')).toBe('k8s_get_resources · namespace: krateo-system · resource_type: pods')
  })

  it('a turn with no tools says so', () => {
    render(<RunTimeline message={turn({ evidence: [], text: 'Hi' })} />)
    expect(head().textContent).toContain('Answered from the page context')
    expect(head().tagName).toBe('DIV')
  })

  it('renders nothing for a finished turn that carries no trace at all', () => {
    const { container } = render(<RunTimeline message={turn({ text: 'old' })} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('failures, in words', () => {
  it('shows the reason in the step and counts it in the header and footer', () => {
    const failed = read('b', 'pods', { failed: true, reason: 'pods is forbidden: cannot list in krateo-system' })
    render(<RunTimeline message={turn({ evidence: [read('a', 'services'), failed], lastEventAt: T0 + 38_000, text: 'x' })} />)
    expect(head().textContent).toContain('Done · 1 step failed')
    fireEvent.click(head())
    const [, row] = steps()
    expect(row.getAttribute('data-status')).toBe('failed')
    expect(row.getAttribute('data-tone')).toBe('bad')
    expect(row.textContent).toContain('Failed:')
    expect(row.textContent).toContain('pods is forbidden')
    expect(screen.getByText(/1 agent · 2 steps · 1 failed/)).toBeTruthy()
  })
})

describe('honest about silence', () => {
  const silent = () => turn({ evidence: [read('a', 'pods'), handOff({ startedAt: T0 + 1_000 })], streaming: true })

  it('after two minutes with no event, says so — and the specialist in flight is the one named', () => {
    render(<RunTimeline message={silent()} onAskAgain={vi.fn()} />)
    act(() => { vi.advanceTimersByTime(119_000) })
    expect(head().textContent).not.toContain('No reply')
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(head().textContent).toContain('No reply for 2:00')
    expect(screen.getByText('core-provider-agent hasn’t answered')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keep waiting' })).toBeTruthy()
  })

  it('"Keep waiting" re-arms the check for another two minutes', () => {
    render(<RunTimeline message={silent()} onAskAgain={vi.fn()} />)
    act(() => { vi.advanceTimersByTime(122_000) })
    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }))
    expect(head().textContent).not.toContain('No reply')
    act(() => { vi.advanceTimersByTime(119_000) })
    expect(head().textContent).not.toContain('No reply')
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(head().textContent).toContain('No reply for 4:0')
  })

  it('"Stop and ask again" hands back to the provider', () => {
    const onAskAgain = vi.fn()
    render(<RunTimeline message={silent()} onAskAgain={onAskAgain} />)
    act(() => { vi.advanceTimersByTime(121_000) })
    fireEvent.click(screen.getByRole('button', { name: 'Stop and ask again' }))
    expect(onAskAgain).toHaveBeenCalledTimes(1)
  })

  it('any event resets the silence: answer text counts', () => {
    const { rerender } = render(<RunTimeline message={silent()} onAskAgain={vi.fn()} />)
    act(() => { vi.advanceTimersByTime(100_000) })
    rerender(<RunTimeline message={{ ...silent(), lastEventAt: Date.now(), text: 'so far' }} onAskAgain={vi.fn()} />)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(head().textContent).not.toContain('No reply')
  })

  it('a turn restored with its last step unfinished folds to "didn’t finish", not to a spinner', () => {
    render(<RunTimeline message={turn({ evidence: [read('a', 'pods'), read('b', 'pods', { done: undefined, endedAt: undefined })] })} />)
    vi.setSystemTime(T0 + 3 * 60_000)
    expect(head().textContent).toContain('This run didn’t finish')
    expect(head().textContent).toContain('no answer was recorded')
    expect(screen.getByTestId('agentiko-run').getAttribute('data-phase')).toBe('done')
    expect(screen.getByTestId('agentiko-run').querySelector('[data-tone="running"]')).toBeNull()
    fireEvent.click(head())
    expect(steps().at(-1)?.getAttribute('data-status')).toBe('unfinished')
    expect(steps().at(-1)?.textContent).toContain('didn’t return')
  })

  it('a stopped turn that had started answering says its last step never returned', () => {
    render(<RunTimeline message={turn({ evidence: [read('a', 'pods', { done: undefined })], text: 'partial' })} />)
    expect(head().textContent).toContain('its last step never returned')
  })
})

describe('specialists as lanes, filled in when they reply', () => {
  it('while the specialist works and none of its steps are stored yet, its lane says they will appear', () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ data: [] })))
    render(<RunTimeline message={turn({ evidence: [handOff()], streaming: true })} />)
    expect(head().textContent).toContain('1 specialist busy')
    expect(within(screen.getByTestId('agentiko-run-lane')).getByText('its steps appear as it works')).toBeTruthy()
  })

  it('shows a one-line intent with the full request one click away', () => {
    render(<RunTimeline message={turn({ evidence: [handOff()], streaming: true })} />)
    expect(steps()[0].textContent).toContain('Asked core-provider-agent to diagnose composition event-health in krateo-system')
    expect(screen.queryByText(REQUEST)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'full request' }))
    expect(screen.getByText(REQUEST)).toBeTruthy()
  })

  it('fills the lane from the session store the moment the specialist replies', async () => {
    const fetchSpy = vi.fn(() => respond(sessionWith([
      { args: { kind: 'CompositionDefinition', name: 'event-health', namespace: 'krateo-system' }, id: 'c1', name: 'config_refs' },
      { args: { namespace: 'krateo-system', resource_type: 'pods' }, id: 'c2', name: 'k8s_get_resources' },
    ])))
    vi.stubGlobal('fetch', fetchSpy)
    const { rerender } = render(<RunTimeline message={turn({ evidence: [handOff()], streaming: true })} />)
    rerender(<RunTimeline message={turn({ evidence: [handOff({ done: true, endedAt: T0 + 37_000, sessionId: 's-1' })], streaming: true })} />)
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    // While it was running the live lane read the session list too; the stored task is read once.
    const taskReads = fetchSpy.mock.calls.map((call) => String((call as unknown[])[0])).filter((url) => url.endsWith('/tasks'))
    expect(taskReads).toEqual(['/agentiko/sessions/s-1/tasks'])
    const lane = within(screen.getByTestId('agentiko-run-lane'))
    expect(lane.getByText('Traced the config references of CompositionDefinition event-health')).toBeTruthy()
    expect(lane.getByText('Read Pods')).toBeTruthy()
  })

  it('says why the steps could not be loaded, and Retry fetches again', async () => {
    const loginPage = () => Promise.resolve(new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' }, status: 200 }))
    // The reason is evidence.ts's to word; the timeline's job is to show it, plainly and whole.
    vi.stubGlobal('fetch', loginPage)
    const reason = await fetchDelegationEvidence('/agentiko/sessions', handOff({ done: true, sessionId: 's-1' }), {}).then(() => '', (err: Error) => err.message)
    expect(reason).not.toBe('')
    const fetchSpy = vi.fn()
      .mockImplementationOnce(loginPage)
      .mockImplementationOnce(() => respond(sessionWith([{ args: { namespace: 'krateo-system', resource_type: 'pods' }, id: 'c1', name: 'k8s_get_resources' }])))
    vi.stubGlobal('fetch', fetchSpy)
    render(<RunTimeline message={turn({ evidence: [handOff({ done: true, sessionId: 's-1' })], streaming: true })} />)
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(`Couldn’t load its steps: ${reason}`)
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(within(screen.getByTestId('agentiko-run-lane')).getByText('Read Pods')).toBeTruthy()
  })

  it('a hand-off that returned no session says so without offering a retry that cannot work', () => {
    render(<RunTimeline message={turn({ evidence: [handOff({ done: true })], streaming: true })} />)
    expect(screen.getByText(/returned no session id, so its steps cannot be read from here/)).toBeTruthy()
    // It must not claim what it cannot see: the specialist may have run and been traced.
    expect(screen.queryByText(/no trace exists|never reached/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('a folded turn read back from history fetches only when opened', async () => {
    const fetchSpy = vi.fn(() => respond(sessionWith([])))
    vi.stubGlobal('fetch', fetchSpy)
    render(<RunTimeline message={turn({ evidence: [handOff({ done: true, sessionId: 's-1' })], text: 'done' })} />)
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(fetchSpy).not.toHaveBeenCalled()
    fireEvent.click(head())
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('a specialist’s steps while it works', () => {
  const TOOL = 'krateo_system__NS__core_provider_agent'
  /** A session-store event row: kagent stores the ADK event JSON-encoded under `data`. */
  const row = (id: string, atMs: number, event: Record<string, unknown>) => ({
    created_at: new Date(atMs).toISOString(),
    data: JSON.stringify({ Author: 'core_provider_agent', InvocationID: 'inv-1', Partial: false, ...event }),
    id,
  })
  const asked = (atMs: number, invocation = 'inv-1') =>
    row(`u-${invocation}`, atMs, { Author: 'user', Content: { parts: [{ text: REQUEST }], role: 'user' }, InvocationID: invocation })
  const call = (id: string, atMs: number, name: string, args: Record<string, unknown>, invocation = 'inv-1') =>
    row(`e-${id}`, atMs, { Content: { parts: [{ functionCall: { args, id, name } }], role: 'model' }, InvocationID: invocation })
  const result = (id: string, atMs: number, name: string, response: Record<string, unknown>) =>
    row(`r-${id}`, atMs, { Content: { parts: [{ functionResponse: { id, name, response } }], role: 'user' } })

  /** The session store: one sub-agent session whose stored events are `events()` at each read. */
  const store = (events: () => unknown[]) => vi.fn((url: string) => {
    if (url === '/agentiko/sessions') {
      return respond({ data: [{ agent_id: TOOL, id: 'sub-1', source: 'agent', updated_at: new Date(T0 + 2_000).toISOString() }] })
    }
    if (url.startsWith('/agentiko/sessions/sub-1?')) {
      return respond({ data: { events: events(), session: { id: 'sub-1' } } })
    }
    return respond({ data: [] })
  })

  const tick = async (ms: number) => {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  it('fills the lane from the session store as each step is stored, before the specialist replies', async () => {
    let stored: unknown[] = [asked(T0 + 1_100), call('c1', T0 + 1_500, 'k8s_get_resources', { namespace: 'krateo-system', resource_type: 'pods' })]
    const fetchSpy = store(() => stored)
    vi.stubGlobal('fetch', fetchSpy)
    render(<RunTimeline message={turn({ evidence: [handOff()], streaming: true })} />)
    await tick(0)
    const lane = () => within(screen.getByTestId('agentiko-run-lane'))
    expect(lane().getByText('Read Pods')).toBeTruthy()
    expect(lane().getByTestId('agentiko-run-step').getAttribute('data-status')).toBe('running')

    stored = [...stored, result('c1', T0 + 1_900, 'k8s_get_resources', { output: { output: 'NAME READY' } })]
    await tick(2_000)
    expect(lane().getByTestId('agentiko-run-step').getAttribute('data-status')).toBe('done')
    const reads = fetchSpy.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/agentiko/sessions/sub-1?'))
    expect(new URL(reads[reads.length - 1], 'http://x').searchParams.get('order')).toBe('asc')
  })

  it('shows only its own run when the specialist’s session is shared with other conversations', async () => {
    vi.stubGlobal('fetch', store(() => [
      asked(T0 + 900, 'inv-other'),
      call('x1', T0 + 950, 'k8s_get_resource_yaml', { name: 'other' }, 'inv-other'),
      asked(T0 + 1_100),
      call('c1', T0 + 1_500, 'k8s_get_resources', { namespace: 'krateo-system', resource_type: 'pods' }),
    ]))
    render(<RunTimeline message={turn({ evidence: [handOff()], streaming: true })} />)
    await tick(0)
    const lane = within(screen.getByTestId('agentiko-run-lane'))
    expect(lane.getAllByTestId('agentiko-run-step')).toHaveLength(1)
    expect(lane.getByText('Read Pods')).toBeTruthy()
  })

  it('marks a step that failed while the specialist is still working', async () => {
    vi.stubGlobal('fetch', store(() => [
      asked(T0 + 1_100),
      call('c1', T0 + 1_500, 'run_query', { query: 'SELECT 1' }),
      result('c1', T0 + 1_600, 'run_query', { error: 'Tool execution failed. Details: Query error' }),
    ]))
    render(<RunTimeline message={turn({ evidence: [handOff()], streaming: true })} />)
    await tick(0)
    const step = within(screen.getByTestId('agentiko-run-lane')).getByTestId('agentiko-run-step')
    expect(step.getAttribute('data-status')).toBe('failed')
    expect(step.textContent).toContain('Tool execution failed. Details: Query error')
  })

  it('a specialist that is visibly working does not trip the two-minute silence', async () => {
    let stored: unknown[] = [asked(T0 + 1_100)]
    vi.stubGlobal('fetch', store(() => stored))
    render(<RunTimeline message={turn({ evidence: [handOff()], streaming: true })} onAskAgain={vi.fn()} />)
    await tick(100_000)
    stored = [...stored, call('c1', Date.now(), 'k8s_get_resources', { namespace: 'krateo-system', resource_type: 'pods' })]
    await tick(40_000)
    expect(head().textContent).not.toContain('No reply')
  })

  it('stops polling once the specialist replies, and the stored task takes over', async () => {
    const fetchSpy = store(() => [asked(T0 + 1_100)])
    vi.stubGlobal('fetch', fetchSpy)
    const { rerender } = render(<RunTimeline message={turn({ evidence: [handOff()], streaming: true })} />)
    await tick(0)
    rerender(<RunTimeline message={turn({ evidence: [handOff({ done: true, endedAt: T0 + 9_000, sessionId: 'sub-1' })], streaming: true })} />)
    await tick(0)
    const before = fetchSpy.mock.calls.length
    await tick(10_000)
    const after = fetchSpy.mock.calls.slice(before).map(([url]) => String(url))
    expect(after.filter((url) => !url.endsWith('/tasks'))).toEqual([])
  })

  it('backs off while the run cannot be found, then gives up and waits for the reply', async () => {
    const other = row('u-other', T0 + 1_100, { Author: 'user', Content: { parts: [{ text: 'a different request' }], role: 'user' }, InvocationID: 'inv-x' })
    const fetchSpy = store(() => [other])
    vi.stubGlobal('fetch', fetchSpy)
    render(<RunTimeline message={turn({ evidence: [handOff()], streaming: true })} />)
    const listReads = () => fetchSpy.mock.calls.filter(([url]) => String(url) === '/agentiko/sessions').length
    await tick(0)
    expect(listReads()).toBe(1)
    await tick(10_000)
    // Tries at 0, 4 and 12 s: a 2 s poll would have listed 6 times by now.
    expect(listReads()).toBe(2)
    await tick(80_000)
    expect(listReads()).toBe(6)
    expect(within(screen.getByTestId('agentiko-run-lane')).getByText('its steps appear when it replies')).toBeTruthy()
    await tick(300_000)
    expect(listReads()).toBe(6)
  })

  it('follows a run that is found on a later try at the normal rate', async () => {
    let stored: unknown[] = []
    const fetchSpy = store(() => stored)
    vi.stubGlobal('fetch', fetchSpy)
    render(<RunTimeline message={turn({ evidence: [handOff()], streaming: true })} />)
    await tick(0)
    stored = [asked(T0 + 1_100), call('c1', T0 + 1_500, 'k8s_get_resources', { namespace: 'krateo-system', resource_type: 'pods' })]
    await tick(4_000)
    expect(within(screen.getByTestId('agentiko-run-lane')).getByText('Read Pods')).toBeTruthy()
    const followReads = () => fetchSpy.mock.calls.filter(([url]) => String(url).startsWith('/agentiko/sessions/sub-1?')).length
    const before = followReads()
    await tick(10_000)
    expect(followReads() - before).toBe(5)
  })

  it('stops after repeated failed reads and says the steps come with the reply', async () => {
    const fetchSpy = vi.fn(() => respond({ error: true }, 403))
    vi.stubGlobal('fetch', fetchSpy)
    render(<RunTimeline message={turn({ evidence: [handOff()], streaming: true })} />)
    await tick(10_000)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(within(screen.getByTestId('agentiko-run-lane')).getByText('its steps appear when it replies')).toBeTruthy()
  })

  it('does not poll a turn read back from history', async () => {
    const fetchSpy = vi.fn(() => respond({ data: [] }))
    vi.stubGlobal('fetch', fetchSpy)
    render(<RunTimeline message={turn({ evidence: [handOff()] })} />)
    await tick(10_000)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('Copy steps', () => {
  it('copies every level, the specialist’s calls nested under it, with raw tool names', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(sessionWith([
      { args: { namespace: 'krateo-system', resource_name: 'kagent-tools', resource_type: 'service' }, id: 'c1', name: 'k8s_describe_resource' },
    ]))))
    render(<RunTimeline message={turn({ evidence: [read('a', 'pods'), handOff({ done: true, sessionId: 's-1' })], text: 'done' })} />)
    fireEvent.click(head())
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    fireEvent.click(screen.getByRole('button', { name: 'Copy steps to clipboard' }))
    expect(copied.texts).toEqual([[
      '2 lookups · 1 specialist',
      '- k8s_get_resources: namespace: krateo-system · resource_type: pods',
      '- core-provider-agent (specialist · 1 lookups)',
      '  - k8s_describe_resource: namespace: krateo-system · resource_name: kagent-tools · resource_type: service',
    ].join('\n')])
    expect(screen.getByRole('button', { name: 'Copy steps to clipboard' }).textContent).toContain('Copied')
  })
})

describe('the approval, as a step', () => {
  const pause: ApprovalPause = {
    requests: [{ agentName: 'k8s-agent', argumentsPreview: 'kind: Deployment\nmetadata:\n  name: readiness-probe-test', requestId: 'r1', toolName: 'k8s_apply_manifest' }],
    taskId: 't1',
  }
  const paused = () => turn({ approvalAt: T0 + 12_000, evidence: [read('a', 'deployments'), handOff({ agent: 'k8s-agent' })], text: '' })

  it('renders at the end of the turn that paused, with the header waiting on you', () => {
    vi.setSystemTime(T0 + 24_000)
    render(<RunTimeline approval={{ onApprove: vi.fn(), onDeny: vi.fn(), pause }} message={paused()} />)
    expect(head().textContent).toContain('Waiting for you')
    expect(head().textContent).toContain('0:12')
    const card = screen.getByTestId('agentiko-approval')
    expect(card.textContent).toContain('k8s-agent wants to apply a manifest')
    expect(card.textContent).toContain('name: readiness-probe-test')
    expect(card.textContent).toContain('Deny is the default')
    // The hand-off that raised it is waiting on a person, not lost.
    expect(steps().at(-1)?.getAttribute('data-status')).toBe('paused')
  })

  it('Approve, Deny and dismiss call exactly the provider paths they called before', () => {
    const onApprove = vi.fn()
    const onDeny = vi.fn()
    render(<RunTimeline approval={{ onApprove, onDeny, pause }} message={paused()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect([onApprove.mock.calls.length, onDeny.mock.calls.length]).toEqual([1, 0])
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss (denies)' }))
    expect([onApprove.mock.calls.length, onDeny.mock.calls.length]).toEqual([1, 2])
  })

  it('a pause opened from an approval link is explicit only: no dismiss, and the note says leaving keeps it paused', () => {
    const onDeny = vi.fn()
    render(<RunTimeline approval={{ onApprove: vi.fn(), onDeny, pause: { ...pause, origin: 'link' } }} message={paused()} />)
    const card = screen.getByTestId('agentiko-approval')
    expect(screen.queryByRole('button', { name: 'Dismiss (denies)' })).toBeNull()
    expect(card.textContent).toContain('Only Approve or Deny decide. Closing the rail or leaving the page keeps the task paused.')
    expect(card.textContent).not.toContain('Deny is the default')
    // Deny is still a decision, on purpose.
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(onDeny).toHaveBeenCalledTimes(1)
  })

  it('once decided, the turn records the decision as a step', () => {
    render(<RunTimeline approvalOutcome='denied k8s_apply_manifest' message={paused()} />)
    expect(screen.queryByTestId('agentiko-approval')).toBeNull()
    fireEvent.click(head())
    expect(screen.getByTestId('agentiko-approval-decided').textContent).toContain('denied k8s_apply_manifest')
  })
})

describe('the steps are an antd Timeline', () => {
  it('each step is a Timeline item whose icon is the status mark, and the step in flight is antd’s in-progress item', () => {
    render(<RunTimeline message={turn({ evidence: [read('a', 'pods'), handOff()], streaming: true })} />)
    const timeline = screen.getByTestId('agentiko-run').querySelector('.ant-timeline')
    expect(timeline).not.toBeNull()
    const items = [...(timeline as Element).querySelectorAll(':scope > .ant-timeline-item')]
    expect(items).toHaveLength(steps().length)
    expect(items.map((item) => item.querySelector('.ant-timeline-item-icon [data-tone]')?.getAttribute('data-tone'))).toEqual(['ok', 'running'])
    expect(items.map((item) => item.classList.contains('ant-steps-item-process'))).toEqual([false, true])
  })

  it('a specialist’s lane is its own Timeline, nested in its hand-off', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(sessionWith([
      { args: { namespace: 'krateo-system', resource_type: 'pods' }, id: 'c1', name: 'k8s_get_resources' },
    ]))))
    render(<RunTimeline message={turn({ evidence: [handOff({ done: true, sessionId: 's-1' })], streaming: true })} />)
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    const lane = screen.getByTestId('agentiko-run-lane')
    expect(lane.closest('.ant-timeline-item')).not.toBeNull()
    expect(lane.querySelectorAll('.ant-timeline .ant-timeline-item')).toHaveLength(1)
  })
})
