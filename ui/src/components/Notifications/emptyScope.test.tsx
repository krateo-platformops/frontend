// @vitest-environment jsdom
/**
 * An EMPTY event scope has no other symptom.
 *
 * When sse-proxy resolves a caller's scope to nothing, the stream opens and never delivers — from
 * the drawer's side that is identical to a healthy bell on a quiet cluster: no error, no
 * disconnect, nothing to render a state from. The proxy therefore says so explicitly with
 * `X-Krateo-Event-Scope: none` (sse-proxy#34), and this is the only place that distinction becomes
 * visible to a person.
 *
 * The second case is the one that matters more: an ABSENT header means the proxy does not scope at
 * all. Rendering that as an empty scope would tell every user on an older sse-proxy that they may
 * see no events.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EventScope } from '../../hooks/sseClient'

import { NotificationsDrawer } from './Notifications'

const harness = vi.hoisted(() => ({ scope: { kind: 'unscoped' } }))

vi.mock('./NotificationsContext', () => ({
  useNotifications: () => ({
    isLoading: false,
    notifications: [],
    open: true,
    scope: harness.scope,
    setOpen: () => undefined,
  }),
}))
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => () => undefined,
}))

/** Read THIS render's own container: document.body accumulates across renders, so reading it
 *  lets one case's text satisfy the next one's assertion. */
const drawerText = (scope: EventScope): string => {
  harness.scope = scope
  const { baseElement } = render(<NotificationsDrawer />)

  return baseElement.textContent ?? ''
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the bell with nothing in it', () => {
  it('says the scope is empty when the proxy said so explicitly', () => {
    expect(drawerText({ kind: 'none' })).toContain('No events are in scope for you')
  })

  it('says only "No events" when the proxy does not scope — an older proxy must not read as "you see nothing"', () => {
    const text = drawerText({ kind: 'unscoped' })
    expect(text).toContain('No events')
    expect(text).not.toContain('in scope for you')
  })

  it('says only "No events" when the caller HAS namespaces and the cluster is simply quiet', () => {
    const text = drawerText({ kind: 'namespaces', namespaces: ['demo-system'] })
    expect(text).not.toContain('in scope for you')
  })

  it('says only "No events" when the caller sees everything', () => {
    expect(drawerText({ kind: 'all' })).not.toContain('in scope for you')
  })
})
