/**
 * Transport ↔ frame glue. The payloads are verbatim shapes captured off the live kagent 0.9.12
 * A2A stream, so this locks the mapping the Evidence panel depends on — tool DataParts became
 * frames only after the dead `functionCall` branch was replaced, and nothing else asserts it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createKagentTransport } from './transport'
import type { AutopilotFrame } from './types'

const sseBody = (events: unknown[]): string =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')

/** A one-chunk ReadableStream reader, which is all the transport uses of a Response. */
const stubFetch = (body: string) => {
  const chunk = new TextEncoder().encode(body)
  let sent = false
  const read = () => {
    if (sent) {
      return Promise.resolve({ done: true, value: undefined })
    }
    sent = true
    return Promise.resolve({ done: false, value: chunk })
  }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ body: { getReader: () => ({ read }) }, ok: true })))
}

const dataPart = (data: Record<string, unknown>, type: string) => ({
  data,
  kind: 'data',
  metadata: { adk_type: type },
})

const agentMessage = (parts: unknown[]) => ({
  result: { kind: 'status-update', status: { message: { parts, role: 'agent' }, state: 'working' }, taskId: 'task-1' },
})

const collect = async (events: unknown[]): Promise<AutopilotFrame[]> => {
  stubFetch(sseBody(events))
  const frames: AutopilotFrame[] = []
  createKagentTransport('/autopilot').send(
    { context: '<page_context/>', sessionId: 's1', text: 'which env vars?' },
    { onFrame: (frame) => frames.push(frame) },
  )
  await vi.waitFor(() => expect(frames.some((frame) => frame.kind === 'done')).toBe(true))
  return frames
}

afterEach(() => vi.unstubAllGlobals())

describe('tool DataParts become tool frames', () => {
  it('surfaces a call with its arguments and the result it is merged on', async () => {
    const frames = await collect([
      agentMessage([dataPart({ args: { path: 'main.go', repo: 'core-provider' }, id: 'call_1', name: 'read_repo_file' }, 'function_call')]),
      agentMessage([dataPart({ id: 'call_1', name: 'read_repo_file', response: { output: '# core-provider @ 2.13.4' } }, 'function_response')]),
      { result: { final: true, kind: 'status-update', status: { state: 'completed' } } },
    ])
    expect(frames).toEqual([
      { args: { path: 'main.go', repo: 'core-provider' }, id: 'call_1', kind: 'tool_call', name: 'read_repo_file' },
      { id: 'call_1', isError: false, kind: 'tool_result', name: 'read_repo_file', output: '# core-provider @ 2.13.4', sessionId: undefined },
      { kind: 'done' },
    ])
  })

  it('carries a delegation\'s sub-agent session, which is the only link to its own calls', async () => {
    const frames = await collect([
      agentMessage([dataPart({
        id: 'call_2',
        name: 'krateo_system__NS__core_provider_agent',
        response: { result: 'the specialist answer', subagent_session_id: 'sess-9' },
      }, 'function_response')]),
      { result: { final: true, kind: 'status-update', status: { state: 'completed' } } },
    ])
    expect(frames[0]).toMatchObject({ kind: 'tool_result', sessionId: 'sess-9' })
  })

  it('keeps text and tool parts of one message apart', async () => {
    const frames = await collect([
      agentMessage([{ kind: 'text', text: 'Reading the chart…' }, dataPart({ id: 'call_3', name: 'list_repos' }, 'function_call')]),
      { result: { final: true, kind: 'status-update', status: { state: 'completed' } } },
    ])
    expect(frames.filter((frame) => frame.kind === 'text')).toEqual([{ delta: 'Reading the chart…', kind: 'text', replace: false }])
    expect(frames.filter((frame) => frame.kind === 'tool_call')).toHaveLength(1)
  })

  it('emits the authoritative artifact text without re-emitting its own tool parts as text', async () => {
    const frames = await collect([
      { result: { artifact: { parts: [{ kind: 'text', text: 'The final answer.' }] }, kind: 'artifact-update' } },
      { result: { final: true, kind: 'status-update', status: { state: 'completed' } } },
    ])
    expect(frames[0]).toEqual({ delta: 'The final answer.', kind: 'text', replace: true })
  })
})
