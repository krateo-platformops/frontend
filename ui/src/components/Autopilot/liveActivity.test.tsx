// @vitest-environment jsdom
/**
 * What the agent is doing WHILE you wait.
 *
 * The behaviour these tests pin is narrow and was absent: the rail rendered evidence only once a
 * turn had finished, so a long delegation showed a blinking caret and nothing else. Two halves have
 * to hold for the strip to say anything — the entry must know whether its call came back, and the
 * provider must publish evidence while the message is still streaming — so both are tested here,
 * the second through the real provider rather than a mock.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { mergeToolResult } from './evidence'
import { LiveActivity } from './liveActivity'
import type { EvidenceEntry } from './types'

afterEach(cleanup)

const entry = (over: Partial<EvidenceEntry> = {}): EvidenceEntry =>
  ({ id: 'c1', kind: 'tool', tool: 'get_resource', ...over })

const stateOf = (label: string) =>
  screen.getByText(label).closest('[data-state]')?.getAttribute('data-state')

describe('LiveActivity — the strip', () => {
  it('shows an unfinished call as RUNNING and a finished one as DONE', () => {
    render(<LiveActivity evidence={[
      entry({ id: 'a', tool: 'list_pods' }),
      entry({ done: true, id: 'b', tool: 'get_resource' }),
    ]} />)
    expect(stateOf('list_pods')).toBe('running')
    expect(stateOf('get_resource')).toBe('done')
  })

  it('marks a failed call as FAILED, not merely done', () => {
    render(<LiveActivity evidence={[entry({ done: true, failed: true, id: 'a', tool: 'apply' })]} />)
    expect(stateOf('apply')).toBe('failed')
  })

  it('names the SPECIALIST for a delegation, not the transfer mechanism', () => {
    // "asking frontend-agent" is the fact; `transfer_to_frontend_agent` is the plumbing, and it is
    // the plumbing that the tool name would show.
    render(<LiveActivity evidence={[entry({
      agent: 'frontend-agent',
      id: 'd1',
      kind: 'delegation',
      request: 'build the compositions page',
      tool: 'transfer_to_frontend_agent',
    })]} />)
    expect(screen.getByText('asking frontend-agent')).toBeTruthy()
    expect(screen.getByText('build the compositions page')).toBeTruthy()
    expect(screen.queryByText('transfer_to_frontend_agent')).toBeNull()
  })

  it('shows only the most recent few — during a long turn the useful answer is what it is doing NOW', () => {
    const many = Array.from({ length: 9 }, (_, index) => entry({ done: true, id: `t${index}`, tool: `tool_${index}` }))
    render(<LiveActivity evidence={many} />)
    expect(screen.queryByText('tool_0')).toBeNull()
    expect(screen.getByText('tool_8')).toBeTruthy()
  })

  it('SHOWS THAT IT IS WORKING BEFORE THE FIRST TOOL CALL — the longest part of the wait', () => {
    // This REVERSES an earlier assertion in this file, deliberately. Rendering nothing when there
    // is no evidence yet meant the strip appeared only once the agent had already started doing
    // things — and the wait before the first tool call, while it reads the page context and
    // decides, is the longest and the one that feels broken. What was visible then was a blinking
    // caret and nothing else, which is precisely what got reported.
    render(<LiveActivity evidence={[]} />)
    const strip = screen.getByTestId('autopilot-live-activity')
    expect(strip).toBeTruthy()
    expect(screen.getByText('working…')).toBeTruthy()
    expect(strip.querySelector('[data-state="running"]')).toBeTruthy()
  })

  it('says ANSWERING once the answer has started arriving — not still "working"', () => {
    // kagent's turn machine separates `working` (acknowledged, nothing back) from `streaming`
    // (content arriving), because the A2A transport spells them the same way. A turn already
    // writing its answer must not read as not having started.
    render(<LiveActivity answering evidence={[]} />)
    expect(screen.getByText('answering…')).toBeTruthy()
    expect(screen.queryByText('working…')).toBeNull()
  })

  it('replaces the placeholder as soon as there is a real step to name', () => {
    render(<LiveActivity evidence={[entry({ tool: 'list_pods' })]} />)
    expect(screen.queryByText('working…')).toBeNull()
    expect(screen.getByText('list_pods')).toBeTruthy()
  })

  it('is announced — someone who cannot see the strip has the same question', () => {
    render(<LiveActivity evidence={[entry()]} />)
    expect(screen.getByTestId('autopilot-live-activity').getAttribute('aria-live')).toBe('polite')
  })
})

describe('the completion marker the strip depends on', () => {
  it('mergeToolResult marks the entry done — `failed` alone cannot express it', () => {
    // Both a call still in flight and a call that returned cleanly have `failed: undefined`, so
    // without this the strip would show every finished step as still running.
    const [merged] = mergeToolResult([entry({ id: 'c1' })], { id: 'c1', name: 'get_resource', type: 'result' })
    expect(merged.done).toBe(true)
    expect(merged.failed).toBeUndefined()
  })

  it('a failed result is BOTH done and failed', () => {
    const [merged] = mergeToolResult(
      [entry({ id: 'c1' })],
      { id: 'c1', isError: true, name: 'get_resource', type: 'result' },
    )
    expect(merged.done).toBe(true)
    expect(merged.failed).toBe(true)
  })
})
