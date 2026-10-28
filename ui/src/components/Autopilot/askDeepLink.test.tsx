// @vitest-environment jsdom
/**
 * UX-19 — the `?ask=` deep-link (the composition-detail "Diagnose" button) on a
 * portal WITHOUT Autopilot must not silently no-op. useAskDeepLink shows an honest
 * notification and strips the consumed param (leaving the rest of the URL intact);
 * when Autopilot IS enabled it seeds exactly one turn via the callback instead.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ASK_UNAVAILABLE_DESCRIPTION, useAskDeepLink } from './askDeepLink'

/** Calls the hook and mirrors the live query string, so the param strip is observable. */
const Probe = ({ enabled, onAsk }: { enabled: boolean; onAsk: (ask: string) => void }) => {
  useAskDeepLink(enabled, onAsk)
  return <div data-testid='search'>{useLocation().search}</div>
}

const renderProbe = (enabled: boolean, initialEntry: string) => {
  const onAsk = vi.fn()
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App>
        <Probe enabled={enabled} onAsk={onAsk} />
      </App>
    </MemoryRouter>,
  )
  return onAsk
}

beforeAll(() => {
  // antd + jsdom compatibility shims
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      addEventListener: noop,
      addListener: noop,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: noop,
      removeListener: noop,
    }),
    writable: true,
  })
  globalThis.ResizeObserver = class {
    disconnect = noop
    observe = noop
    unobserve = noop
  }
})

afterEach(() => {
  // Unmount (not just wipe the body): the notification's pending motion/commit work
  // must be cancelled before the jsdom environment is torn down.
  cleanup()
  document.body.innerHTML = ''
})

describe('useAskDeepLink — Autopilot DISABLED (UX-19 honesty)', () => {
  it('shows the honest notification, strips ?ask=, and never seeds a turn', async () => {
    const onAsk = renderProbe(false, '/compositions/demo?ask=Diagnose%20this%20composition')
    expect(await screen.findByText(ASK_UNAVAILABLE_DESCRIPTION)).toBeDefined()
    await waitFor(() => { expect(screen.getByTestId('search').textContent).toBe('') })
    expect(onAsk).not.toHaveBeenCalled()
  })

  it('preserves unrelated query params while stripping ask', async () => {
    renderProbe(false, '/compositions/demo?tab=events&ask=Diagnose')
    await screen.findByText(ASK_UNAVAILABLE_DESCRIPTION)
    await waitFor(() => { expect(screen.getByTestId('search').textContent).toBe('?tab=events') })
  })

  it('does nothing without an ask param', () => {
    const onAsk = renderProbe(false, '/compositions/demo?tab=events')
    expect(screen.getByTestId('search').textContent).toBe('?tab=events')
    expect(screen.queryByText(ASK_UNAVAILABLE_DESCRIPTION)).toBeNull()
    expect(onAsk).not.toHaveBeenCalled()
  })
})

describe('useAskDeepLink — Autopilot ENABLED (seed path unchanged)', () => {
  it('seeds exactly one turn with the decoded prompt, strips ?ask=, no notification', async () => {
    const onAsk = renderProbe(true, '/compositions/demo?ask=Diagnose%20this')
    await waitFor(() => { expect(onAsk).toHaveBeenCalledWith('Diagnose this') })
    expect(onAsk).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(screen.getByTestId('search').textContent).toBe('') })
    expect(screen.queryByText(ASK_UNAVAILABLE_DESCRIPTION)).toBeNull()
  })
})
