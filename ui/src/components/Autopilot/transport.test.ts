/**
 * Transport glue: emitParts is the live-stream path that turns A2A DataParts into the
 * tool_call/tool_result frames the Evidence panel reads (and accumulates the message text).
 * The pure readToolPart it delegates to is covered in evidence.test.ts; here we pin the wiring.
 */
import { describe, expect, it } from 'vitest'

import { emitParts } from './transport'
import type { AutopilotFrame, AutopilotStreamHandlers } from './types'

const dataPart = (metaType: string, data: Record<string, unknown>) => ({
  data,
  kind: 'data',
  metadata: { adk_type: metaType },
})
const textPart = (text: string) => ({ kind: 'text', text })

describe('emitParts wires A2A parts to tool frames and returns the message text', () => {
  it('emits a tool_call, accumulates the text, and emits a tool_result', () => {
    const frames: AutopilotFrame[] = []
    const handlers = { onFrame: (frame: AutopilotFrame) => frames.push(frame) } as unknown as AutopilotStreamHandlers

    const text = emitParts(
      [
        dataPart('function_call', { args: { repo: 'authn' }, id: 'c1', name: 'search_repo' }),
        textPart('answering '),
        dataPart('function_response', { id: 'c1', name: 'search_repo', response: { output: '# authn @ 0.27.2 — 2 results' } }),
        textPart('now'),
      ],
      handlers,
    )

    // Text parts accumulate into the return value; tool DataParts do not.
    expect(text).toBe('answering now')
    expect(frames).toHaveLength(2)
    expect(frames[0]).toEqual({ args: { repo: 'authn' }, id: 'c1', kind: 'tool_call', name: 'search_repo' })
    expect(frames[1]).toMatchObject({ id: 'c1', kind: 'tool_result', name: 'search_repo' })
    expect(JSON.stringify(frames[1])).toContain('2 results')
  })

  it('a message of only text emits no frames', () => {
    const frames: AutopilotFrame[] = []
    const handlers = { onFrame: (frame: AutopilotFrame) => frames.push(frame) } as unknown as AutopilotStreamHandlers
    expect(emitParts([textPart('just prose')], handlers)).toBe('just prose')
    expect(frames).toHaveLength(0)
  })
})
