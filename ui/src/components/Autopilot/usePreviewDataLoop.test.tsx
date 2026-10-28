// @vitest-environment jsdom
/**
 * The two guards the hook owns, pinned without the provider around them:
 *  - the follow-up never opens a SECOND stream — a check that settles while another turn is
 *    streaming drops its follow-up with a note, and the render stays on the envelope;
 *  - `holdsPublish` keeps the narrated-publish trampoline quiet while the render lists problems, and
 *    after the loop has sent its report.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getUserInfo } from '../../utils/getUserInfo'

import { draftOwner } from './draftRecord'
import { getPreviewRender, setPreviewRender } from './previewBus'
import type * as PreviewRenderModule from './previewRender'
import { sandboxDraftName } from './previewSandbox'
import type { AutopilotMessage } from './types'
import { usePreviewDataLoop } from './usePreviewDataLoop'

vi.mock('./previewRender', async (importOriginal) => {
  const actual = await importOriginal<typeof PreviewRenderModule>()
  return { ...actual, awaitSettledPreview: (read: () => PreviewRenderModule.RenderedWidgetState[]) => Promise.resolve({ states: read(), timedOut: false }) }
})

const SANDBOX = 'krateo-preview'
const WIDGETS = [{ kind: 'Table', metadata: { name: 'items-table' } }]
const DELEGATION = [{ agent: 'frontend-agent', id: 'c1', kind: 'delegation' as const, tool: 'krateo_system__NS__frontend_agent' }]

const emptyTable = (): PreviewRenderModule.RenderedWidgetState => ({
  data: { kind: 'Table', status: { widgetData: { dataSource: [] } } },
  endpoint: `/call?resource=tables&name=${sandboxDraftName('items-table', draftOwner(getUserInfo().username))}&namespace=${SANDBOX}`,
  loadState: 'ready',
  updatedAt: 1,
})

const mount = (streaming: boolean) => {
  let messages: AutopilotMessage[] = [{ createdAt: 0, id: 'a1', role: 'assistant', text: 'Previewing.' }]
  const send = vi.fn()
  const hook = renderHook(() => usePreviewDataLoop({
    readRenderedWidgets: () => [emptyTable()],
    sandboxNamespace: SANDBOX,
    sendRef: { current: send },
    setMessages: (update) => { messages = update(messages) },
    streaming,
  }))
  return { chips: () => messages[0].actions?.map(({ label }) => label) ?? [], hook, send }
}

const runCheck = async (hook: ReturnType<typeof mount>['hook']) => {
  const turn = hook.result.current.beginRun(DELEGATION)
  await act(async () => {
    hook.result.current.checkLivePreview('a1', turn, WIDGETS, 0, 'text')
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })
}

afterEach(() => setPreviewRender(null))

describe('usePreviewDataLoop — guards', () => {
  it('a check that settles while another turn streams never opens a second stream', async () => {
    const { chips, hook, send } = mount(true)
    await runCheck(hook)
    expect(send).not.toHaveBeenCalled()
    expect(chips().at(-1)).toMatch(/another answer was still streaming, so they were not sent automatically/)
    expect(getPreviewRender()?.problems).toEqual(['Table items-table: empty — 0 rows'])
  })

  it('holds the narrated publish while the render lists problems, and after the loop reported', async () => {
    const { hook, send } = mount(false)
    expect(hook.result.current.holdsPublish()).toBe(false)
    await runCheck(hook)
    expect(send).toHaveBeenCalledTimes(1)
    expect(hook.result.current.holdsPublish()).toBe(true)

    // The same problems again: the loop reports — and the hold outlives the render being cleared.
    await runCheck(hook)
    expect(send.mock.calls[1][0]).toMatch(/same problems the previous check reported/)
    setPreviewRender(null)
    expect(hook.result.current.holdsPublish()).toBe(true)

    // A new request lifts it.
    act(() => hook.result.current.reset())
    expect(hook.result.current.holdsPublish()).toBe(false)
  })
})
