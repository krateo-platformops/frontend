// @vitest-environment jsdom
/**
 * UX-19 — the `?ask=` deep-link (every "Ask Agentiko →" button) on a portal WITHOUT an Agentiko
 * licence must not silently no-op: useAskDeepLink calls `onLocked` (the provider opens the locked
 * rail, which explains and offers the licence) and strips the consumed param, leaving the rest of
 * the URL intact. When licensed and reachable it seeds exactly one turn via `onAsk` instead.
 *
 * #653 — licensed but UNREACHABLE is refused the same way: no new thread, no turn that can only
 * fail. While the first probe is still checking, the param waits for the verdict.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAskDeepLink } from './askDeepLink'
import type { AskAccess } from './availability'

/** Calls the hook and mirrors the live query string, so the param strip is observable. */
const Probe = ({ access, onAsk, onLocked }: { access: AskAccess; onAsk: (ask: string) => void; onLocked: () => void }) => {
  useAskDeepLink(access, onAsk, onLocked)
  return <div data-testid='search'>{useLocation().search}</div>
}

const renderProbe = (access: AskAccess, initialEntry: string) => {
  const onAsk = vi.fn()
  const onLocked = vi.fn()
  const view = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Probe access={access} onAsk={onAsk} onLocked={onLocked} />
    </MemoryRouter>,
  )
  const rerender = (next: AskAccess) => {
    view.rerender(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Probe access={next} onAsk={onAsk} onLocked={onLocked} />
      </MemoryRouter>,
    )
  }
  return { onAsk, onLocked, rerender }
}

afterEach(() => {
  cleanup()
})

describe('useAskDeepLink — not licensed (UX-19 honesty)', () => {
  it('opens the locked rail once, strips ?ask=, and never seeds a turn', async () => {
    const { onAsk, onLocked } = renderProbe('locked', '/compositions/demo?ask=Diagnose%20this%20composition')
    await waitFor(() => { expect(screen.getByTestId('search').textContent).toBe('') })
    expect(onLocked).toHaveBeenCalledTimes(1)
    expect(onAsk).not.toHaveBeenCalled()
  })

  it('preserves unrelated query params while stripping ask', async () => {
    renderProbe('locked', '/compositions/demo?tab=events&ask=Diagnose')
    await waitFor(() => { expect(screen.getByTestId('search').textContent).toBe('?tab=events') })
  })

  it('does nothing without an ask param', () => {
    const { onAsk, onLocked } = renderProbe('locked', '/compositions/demo?tab=events')
    expect(screen.getByTestId('search').textContent).toBe('?tab=events')
    expect(onLocked).not.toHaveBeenCalled()
    expect(onAsk).not.toHaveBeenCalled()
  })
})

describe('useAskDeepLink — licensed but not reachable (#653)', () => {
  it('opens the rail, strips ?ask=, and neither starts a thread nor seeds a turn', async () => {
    const { onAsk, onLocked } = renderProbe('unavailable', '/compositions/demo?ask=Diagnose%20this')
    await waitFor(() => { expect(screen.getByTestId('search').textContent).toBe('') })
    expect(onLocked).toHaveBeenCalledTimes(1)
    expect(onAsk).not.toHaveBeenCalled()
  })

  it('holds the param while the probe is checking, then seeds once it answers reachable', async () => {
    const { onAsk, onLocked, rerender } = renderProbe('checking', '/compositions/demo?ask=Diagnose%20this')
    const settle = () => new Promise((resolve) => { setTimeout(resolve, 20) })
    await act(settle)
    expect(screen.getByTestId('search').textContent).toBe('?ask=Diagnose%20this')
    expect(onAsk).not.toHaveBeenCalled()
    expect(onLocked).not.toHaveBeenCalled()
    rerender('ready')
    await waitFor(() => { expect(onAsk).toHaveBeenCalledWith('Diagnose this') })
    expect(onAsk).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(screen.getByTestId('search').textContent).toBe('') })
  })

  it('holds the param while checking, then refuses once the probe answers unreachable', async () => {
    const { onAsk, onLocked, rerender } = renderProbe('checking', '/compositions/demo?ask=Diagnose')
    rerender('unavailable')
    await waitFor(() => { expect(onLocked).toHaveBeenCalledTimes(1) })
    expect(onAsk).not.toHaveBeenCalled()
  })
})

describe('useAskDeepLink — licensed and reachable (seed path unchanged)', () => {
  it('seeds exactly one turn with the decoded prompt and strips ?ask=', async () => {
    const { onAsk, onLocked } = renderProbe('ready', '/compositions/demo?ask=Diagnose%20this')
    await waitFor(() => { expect(onAsk).toHaveBeenCalledWith('Diagnose this') })
    expect(onAsk).toHaveBeenCalledTimes(1)
    expect(onLocked).not.toHaveBeenCalled()
    await waitFor(() => { expect(screen.getByTestId('search').textContent).toBe('') })
  })
})

/*
 * The provider that calls the hook lives in the persistent shell, so it is NOT remounted between
 * pages. Every "Ask Agentiko →" click is a navigation carrying its own `?ask=`, and each must start
 * its own turn. A once-only guard used to swallow every click after the first: the second prompt
 * was stripped from the URL and no turn started.
 */
describe('useAskDeepLink — one provider, many clicks', () => {
  let navigate: ReturnType<typeof useNavigate> | undefined
  const Shell = ({ access, onAsk, onLocked }: { access: AskAccess; onAsk: (ask: string) => void; onLocked: () => void }) => {
    navigate = useNavigate()
    useAskDeepLink(access, onAsk, onLocked)
    return <div data-testid='search'>{useLocation().search}</div>
  }
  const mount = (access: AskAccess, initialEntry: string) => {
    const onAsk = vi.fn<(ask: string) => void>()
    const onLocked = vi.fn<() => void>()
    const router = createMemoryRouter([{ element: <Shell access={access} onAsk={onAsk} onLocked={onLocked} />, path: '*' }], { initialEntries: [initialEntry] })
    render(<RouterProvider router={router} />)
    return { onAsk, onLocked }
  }

  it('seeds a turn for each click, on another page and on the same page again', async () => {
    const { onAsk } = mount('ready', '/incidents?ask=First')
    await waitFor(() => { expect(onAsk).toHaveBeenCalledTimes(1) })
    await act(async () => { await navigate?.('/compositions?status=failed&ask=Second') })
    await waitFor(() => { expect(onAsk).toHaveBeenCalledTimes(2) })
    await act(async () => { await navigate?.('/compositions?status=failed&ask=Second') })
    await waitFor(() => { expect(onAsk).toHaveBeenCalledTimes(3) })
    expect(onAsk.mock.calls.map(([ask]) => ask)).toEqual(['First', 'Second', 'Second'])
    await waitFor(() => { expect(screen.getByTestId('search').textContent).toBe('?status=failed') })
  })

  it('opens the locked rail on each click when not licensed', async () => {
    const { onAsk, onLocked } = mount('locked', '/incidents?ask=First')
    await waitFor(() => { expect(onLocked).toHaveBeenCalledTimes(1) })
    await act(async () => { await navigate?.('/audit?ask=Second') })
    await waitFor(() => { expect(onLocked).toHaveBeenCalledTimes(2) })
    expect(onAsk).not.toHaveBeenCalled()
  })

  it('a navigation without ask after a handled one starts nothing', async () => {
    const { onAsk } = mount('ready', '/incidents?ask=First')
    await waitFor(() => { expect(onAsk).toHaveBeenCalledTimes(1) })
    await act(async () => { await navigate?.('/audit') })
    const settle = () => new Promise((resolve) => { setTimeout(resolve, 20) })
    await act(settle)
    expect(onAsk).toHaveBeenCalledTimes(1)
  })
})
