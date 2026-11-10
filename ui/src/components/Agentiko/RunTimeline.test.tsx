// @vitest-environment jsdom
/**
 * The run timeline, rendered: fold and unfold, live → done, failures, the stall, the turn that
 * didn't finish, specialists filling in (and failing to), the approval as a step, and Copy.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigContextModule from '../../context/ConfigContext'

import type { ApprovalPause } from './approval'
import { mergeToolResult } from './evidence'
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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  vi.setSystemTime(T0)
  copied.texts.length = 0
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
    for (const clock of run.querySelectorAll('[class*="time"], [class*="stepTime"]')) {
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
  it('while the specialist works its lane says when its steps will appear, and nothing is fetched', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<RunTimeline message={turn({ evidence: [handOff()], streaming: true })} />)
    expect(head().textContent).toContain('1 specialist busy')
    expect(within(screen.getByTestId('agentiko-run-lane')).getByText('its steps appear when it replies')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(fetchSpy).not.toHaveBeenCalled()
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
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe('/agentiko/sessions/s-1/tasks')
    const lane = within(screen.getByTestId('agentiko-run-lane'))
    expect(lane.getByText('Traced the config references of CompositionDefinition event-health')).toBeTruthy()
    expect(lane.getByText('Read Pods')).toBeTruthy()
  })

  it('says why the steps could not be loaded, and Retry fetches again', async () => {
    const fetchSpy = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(new Response('<html>login</html>', { status: 200 })))
      .mockImplementationOnce(() => respond(sessionWith([{ args: { namespace: 'krateo-system', resource_type: 'pods' }, id: 'c1', name: 'k8s_get_resources' }])))
    vi.stubGlobal('fetch', fetchSpy)
    render(<RunTimeline message={turn({ evidence: [handOff({ done: true, sessionId: 's-1' })], streaming: true })} />)
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Couldn’t load its steps: the session store answered with something that is not a trace')
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(within(screen.getByTestId('agentiko-run-lane')).getByText('Read Pods')).toBeTruthy()
  })

  it('a hand-off that returned no session says so without offering a retry that cannot work', () => {
    render(<RunTimeline message={turn({ evidence: [handOff({ done: true })], streaming: true })} />)
    expect(screen.getByText(/no trace exists to read/)).toBeTruthy()
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

  it('once decided, the turn records the decision as a step', () => {
    render(<RunTimeline approvalOutcome='denied k8s_apply_manifest' message={paused()} />)
    expect(screen.queryByTestId('agentiko-approval')).toBeNull()
    fireEvent.click(head())
    expect(screen.getByTestId('agentiko-approval-decided').textContent).toContain('denied k8s_apply_manifest')
  })
})
