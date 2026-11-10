// @vitest-environment jsdom
/**
 * Where the run timeline sits in a turn: one card ABOVE the answer, so the answer leads and the
 * work is one line over it. And the old two views are gone — no "Evidence" disclosure under it.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type * as ConfigContextModule from '../../context/ConfigContext'

import { MessageBubble } from './RailTranscript'
import type { AgentikoMessage } from './types'

vi.mock('../../context/ConfigContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigContextModule>()),
  useConfigContext: () => ({ config: { api: {} } }),
}))

// antd Timeline renders antd Steps, which reads window.matchMedia; jsdom has none (as in ClaimNotice.test.tsx).
beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
})

afterEach(cleanup)

const answered: AgentikoMessage = {
  createdAt: 1,
  evidence: [{ args: { namespace: 'krateo-system', resource_type: 'pods' }, done: true, id: 'c1', kind: 'cluster', tool: 'k8s_get_resources' }],
  id: 'a1',
  role: 'assistant',
  text: 'All pods are Running.',
}

describe('MessageBubble with a run', () => {
  it('puts the folded run above the answer, and no Evidence disclosure below it', () => {
    render(<MessageBubble message={answered} onRetryClaims={() => undefined} streaming={false} />)
    const run = screen.getByTestId('agentiko-run')
    const answer = screen.getByText('All pods are Running.')
    expect(run.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText(/^Evidence/)).toBeNull()
    expect(screen.queryByTestId('agentiko-live-activity')).toBeNull()
  })

  it('a user turn has no run', () => {
    render(<MessageBubble message={{ createdAt: 1, id: 'u1', role: 'user', text: 'hi' }} onRetryClaims={() => undefined} streaming={false} />)
    expect(screen.queryByTestId('agentiko-run')).toBeNull()
  })
})
