// @vitest-environment jsdom
/**
 * UX-19 — the `?ask=` deep-link (every "Ask Agentiko →" button) on a portal WITHOUT an Agentiko
 * licence must not silently no-op: useAskDeepLink calls `onLocked` (the provider opens the locked
 * rail, which explains and offers the licence) and strips the consumed param, leaving the rest of
 * the URL intact. When licensed it seeds exactly one turn via `onAsk` instead.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAskDeepLink } from './askDeepLink'

/** Calls the hook and mirrors the live query string, so the param strip is observable. */
const Probe = ({ licensed, onAsk, onLocked }: { licensed: boolean; onAsk: (ask: string) => void; onLocked: () => void }) => {
  useAskDeepLink(licensed, onAsk, onLocked)
  return <div data-testid='search'>{useLocation().search}</div>
}

const renderProbe = (licensed: boolean, initialEntry: string) => {
  const onAsk = vi.fn()
  const onLocked = vi.fn()
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Probe licensed={licensed} onAsk={onAsk} onLocked={onLocked} />
    </MemoryRouter>,
  )
  return { onAsk, onLocked }
}

afterEach(() => {
  cleanup()
})

describe('useAskDeepLink — not licensed (UX-19 honesty)', () => {
  it('opens the locked rail once, strips ?ask=, and never seeds a turn', async () => {
    const { onAsk, onLocked } = renderProbe(false, '/compositions/demo?ask=Diagnose%20this%20composition')
    await waitFor(() => { expect(screen.getByTestId('search').textContent).toBe('') })
    expect(onLocked).toHaveBeenCalledTimes(1)
    expect(onAsk).not.toHaveBeenCalled()
  })

  it('preserves unrelated query params while stripping ask', async () => {
    renderProbe(false, '/compositions/demo?tab=events&ask=Diagnose')
    await waitFor(() => { expect(screen.getByTestId('search').textContent).toBe('?tab=events') })
  })

  it('does nothing without an ask param', () => {
    const { onAsk, onLocked } = renderProbe(false, '/compositions/demo?tab=events')
    expect(screen.getByTestId('search').textContent).toBe('?tab=events')
    expect(onLocked).not.toHaveBeenCalled()
    expect(onAsk).not.toHaveBeenCalled()
  })
})

describe('useAskDeepLink — licensed (seed path unchanged)', () => {
  it('seeds exactly one turn with the decoded prompt and strips ?ask=', async () => {
    const { onAsk, onLocked } = renderProbe(true, '/compositions/demo?ask=Diagnose%20this')
    await waitFor(() => { expect(onAsk).toHaveBeenCalledWith('Diagnose this') })
    expect(onAsk).toHaveBeenCalledTimes(1)
    expect(onLocked).not.toHaveBeenCalled()
    await waitFor(() => { expect(screen.getByTestId('search').textContent).toBe('') })
  })
})
