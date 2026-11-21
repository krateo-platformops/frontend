// @vitest-environment jsdom
/**
 * useApprovalLink: consuming `?agentiko=<contextId>` on a real router (the reads are
 * approvalLink.test.ts's subject; the provider's teardown rule is approvalLinkThread.test.tsx's).
 */
import { act, cleanup, render } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApprovalGovernor, ApprovalPause } from './approval'
import type * as ApprovalLinkModule from './approvalLink'
import type { AskAccess } from './availability'
import { agentikoConversationStore } from './conversationStore'
import type { AgentikoMessage } from './types'
import { useApprovalLink } from './useApprovalLink'

const harness = vi.hoisted(() => {
  const state: { calls: unknown[][]; result: ApprovalLinkModule.LinkedApproval } = { calls: [], result: { kind: 'nothing-pending' } }
  return state
})
vi.mock('./approvalLink', async (importOriginal) => ({
  ...(await importOriginal<typeof ApprovalLinkModule>()),
  loadLinkedApproval: (...args: unknown[]) => {
    harness.calls.push(args)
    return Promise.resolve(harness.result)
  },
}))
vi.mock('./transport', () => ({ a2aAuthHeader: () => ({ Authorization: 'Bearer person' }) }))

const PAUSE: ApprovalPause = { contextId: 'ctx-1', requests: [{ argumentsPreview: 'x', requestId: 'conf-1', toolName: 'k8s_delete_resource' }], taskId: 't-paused' }
const ENDPOINT = 'https://gw.example/api/a2a/krateo-system/agentiko'

let search = ''
const Where = () => {
  search = useLocation().search
  return null
}

const mount = (access: AskAccess, url = '/incidents/krateo-system/oom-1?agentiko=ctx-1&tab=Values') => {
  const spies = {
    approvalRef: { current: null } as MutableRefObject<{ governor: ApprovalGovernor; pause: ApprovalPause } | null>,
    messages: [] as AgentikoMessage[],
    newThread: vi.fn(),
    setOpen: vi.fn(),
    setPendingApproval: vi.fn(),
  }
  const Host = ({ value }: { value: AskAccess }) => {
    useApprovalLink({
      access: value,
      agent: 'agentiko',
      approvalRef: spies.approvalRef,
      endpoint: ENDPOINT,
      newThread: spies.newThread,
      setMessages: (update) => { spies.messages = typeof update === 'function' ? update(spies.messages) : update },
      setOpen: spies.setOpen,
      setPendingApproval: spies.setPendingApproval,
    })
    return <Where />
  }
  const view = render(<MemoryRouter initialEntries={[url]}><Host value={access} /></MemoryRouter>)
  // The SAME object, not a copy: setMessages reassigns `spies.messages`, and a spread would freeze it.
  return Object.assign(spies, { rerender: (value: AskAccess) => view.rerender(<MemoryRouter initialEntries={[url]}><Host value={value} /></MemoryRouter>) })
}

const settle = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  harness.calls.length = 0
  harness.result = { kind: 'nothing-pending' }
  localStorage.clear()
  agentikoConversationStore.reset()
})
afterEach(() => { cleanup() })

describe('?agentiko=<contextId>', () => {
  it('a paused task: the rail opens on a fresh thread bound to the session, with an explicit-only card', async () => {
    harness.result = { kind: 'paused', pause: PAUSE }
    const spies = mount('ready')
    await settle()
    expect(harness.calls).toEqual([['https://gw.example/api/sessions', 'ctx-1', { agent: 'agentiko', namespace: 'krateo-system' }, { Authorization: 'Bearer person' }]])
    expect(spies.setOpen).toHaveBeenCalledWith(true)
    expect(spies.newThread).toHaveBeenCalledTimes(1)
    expect(spies.setPendingApproval).toHaveBeenCalledWith({ ...PAUSE, origin: 'link' })
    expect(spies.approvalRef.current?.pause.origin).toBe('link')
    // A later turn continues that session.
    expect(agentikoConversationStore.getSnapshot().contextId).toBe('ctx-1')
    // The card hangs on a note that says where the decision came from.
    expect(spies.messages).toEqual([expect.objectContaining({ approvalAt: expect.any(Number) as number, role: 'assistant', text: 'A task you started from your own agent is waiting for your decision.' })])
    // Consumed: the param is gone, the page's own params stay.
    expect(search).toBe('?tab=Values')
  })

  it('no decision waiting: the rail says why, and no card or session binding appears', async () => {
    harness.result = { kind: 'not-found' }
    const spies = mount('ready')
    await settle()
    expect(spies.setPendingApproval).not.toHaveBeenCalled()
    expect(spies.messages.map((message) => message.text)).toEqual(["This approval link doesn't open a conversation of yours. It may belong to someone else, or it was removed."])
    expect(agentikoConversationStore.getSnapshot().contextId).toBeUndefined()
  })

  it('while availability is checking the param is HELD, then consumed once the verdict lands', async () => {
    harness.result = { kind: 'paused', pause: PAUSE }
    const spies = mount('checking')
    await settle()
    expect(harness.calls).toHaveLength(0)
    expect(search).toBe('?agentiko=ctx-1&tab=Values')
    spies.rerender('ready')
    await settle()
    expect(harness.calls).toHaveLength(1)
    expect(search).toBe('?tab=Values')
  })

  it('locked or unreachable: the rail opens (it explains why), nothing is read, the param is stripped', async () => {
    const spies = mount('locked')
    await settle()
    expect(spies.setOpen).toHaveBeenCalledWith(true)
    expect(harness.calls).toHaveLength(0)
    expect(spies.newThread).not.toHaveBeenCalled()
    expect(search).toBe('?tab=Values')
  })

  it('no param, no effect', async () => {
    const spies = mount('ready', '/compositions/krateo-system/web')
    await settle()
    expect([spies.setOpen.mock.calls.length, harness.calls.length]).toEqual([0, 0])
  })
})
