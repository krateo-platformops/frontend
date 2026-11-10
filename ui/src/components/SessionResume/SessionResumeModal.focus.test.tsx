// @vitest-environment jsdom
/**
 * The session-expired surface is a modal dialog for the keyboard too (audit X4 K1).
 *
 * The audit found focus left on <body> when it opened, and all 14 stops of a Tab walk landing on
 * the hidden app behind it. These tests mount it the way the Shell does — beside the app tree, with
 * an antd-style portal on <body> — and drive it with user-event:
 *   - focus moves to the heading on open, then to the first field once the form renders;
 *   - with no form to show, focus stays on the heading;
 *   - Tab and Shift+Tab wrap inside the dialog;
 *   - every control behind it sits inside an `inert` subtree, and only while it is open;
 *   - after an in-place resume, focus goes back to the control that had it;
 *   - the dialog is named by its own heading.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { tabbableIn } from '../../utils/focus'
import { invalidateAccessTokenCache } from '../../utils/getAccessToken'
import { __resetSessionResume, isSessionResumePending, raiseSessionExpired } from '../../utils/sessionResume'

import SessionResumeModal from './SessionResumeModal'

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: { api: { AUTHN_API_BASE_URL: 'http://authn.test' } },
    isLoading: false,
  }),
}))

vi.mock('../../utils/logout', () => ({
  forceLogout: vi.fn(() => Promise.resolve()),
}))

const FRESH_LOGIN = {
  accessToken: 'fresh-token',
  data: null,
  groups: ['admins'],
  user: { avatarURL: '', displayName: 'Diego', username: 'diego' },
}

/** `/strategies` answers when `release()` is called, so a test can look at the dialog before the form exists. */
const installFetchMock = () => {
  let release!: () => void
  const strategiesAnswered = new Promise<void>((resolve) => { release = resolve })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.endsWith('/strategies')) {
      await strategiesAnswered
      return new Response(JSON.stringify([{ kind: 'basic', name: 'basic', path: '/basic/login' }]), { status: 200 })
    }
    return new Response(JSON.stringify(FRESH_LOGIN), { status: 200 })
  }))
  return { release }
}

/** The app behind the surface: page and rail controls in the React tree, and a drawer that antd
 * would portal straight onto <body>. */
const renderShell = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const portal = document.createElement('div')
  portal.innerHTML = '<button type="button">Close drawer</button>'
  document.body.appendChild(portal)
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <div data-testid='app'>
          <button type='button'>Retry</button>
          <aside><button type='button'>Send</button></aside>
        </div>
        <SessionResumeModal />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const BACKGROUND = ['Retry', 'Send', 'Close drawer']

/** Presses Tab (Shift+Tab when `shift`) once per entry of `expected`, checking where focus lands
 * each time. Recursive because each press must land before the next. */
const walkTab = async (user: ReturnType<typeof userEvent.setup>, expected: HTMLElement[], shift: boolean, step = 0): Promise<void> => {
  if (step === expected.length) {
    return
  }
  await user.tab({ shift })
  const label = shift ? 'Shift+Tab' : 'Tab'
  expect(document.activeElement, `${label} ${step + 1} landed on ${document.activeElement?.outerHTML.slice(0, 80)}`).toBe(expected[step])
  await walkTab(user, expected, shift, step + 1)
}

const raise = async (cause?: Parameters<typeof raiseSessionExpired>[0]) => {
  act(() => { void raiseSessionExpired(cause) })
  return screen.findByRole('dialog')
}

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
  globalThis.ResizeObserver = class {
    disconnect = noop
    observe = noop
    unobserve = noop
  }
})

beforeEach(() => {
  __resetSessionResume()
  invalidateAccessTokenCache()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('SessionResumeModal — keyboard focus (X4 K1)', () => {
  it('takes focus on open: the heading at once, then the first field when the form renders', async () => {
    const { release } = installFetchMock()
    renderShell()

    const dialog = await raise()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Session expired' }))

    release()
    const username = await screen.findByLabelText(/username/i)
    await waitFor(() => { expect(document.activeElement).toBe(username) })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('keeps focus on the heading when there is no form to show', async () => {
    installFetchMock().release()
    renderShell()

    await raise({ action: 'configuration-fault', reason: 'StepUpNotConfigured' })
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Elevated access is not configured' }))
  })

  it('is named by its heading, which follows the cause', async () => {
    installFetchMock().release()
    renderShell()

    await raise({ action: 'server-fault', reason: null })
    expect(screen.getByRole('dialog', { name: 'Could not verify your access' }).getAttribute('aria-modal')).toBe('true')
  })

  it('wraps Tab and Shift+Tab inside the dialog', async () => {
    installFetchMock().release()
    renderShell()
    const user = userEvent.setup()

    const dialog = await raise()
    await screen.findByLabelText(/username/i)
    const stops = tabbableIn(dialog)
    expect(stops.length).toBeGreaterThan(2)
    act(() => { stops[0].focus() })

    // One lap forward from the first field visits every stop in order, then wraps to the first.
    await walkTab(user, [...stops.slice(1), stops[0]], false)
    // And one lap backward, wrapping from the first stop to the last.
    await walkTab(user, [...stops].reverse(), true)
  }, 60_000)

  it('makes the app behind it inert while open, and only while open', async () => {
    installFetchMock().release()
    renderShell()
    const user = userEvent.setup()

    const dialog = await raise()
    for (const name of BACKGROUND) {
      expect(screen.getByRole('button', { name }).closest('[inert]'), `${name} is reachable behind the dialog`).not.toBeNull()
    }
    expect(dialog.closest('[inert]')).toBeNull()
    expect(tabbableIn(document.body).every((el) => dialog.contains(el))).toBe(true)

    await user.type(await screen.findByLabelText(/username/i), 'd')
    await user.type(screen.getByLabelText(/password/i), 's')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })

    expect(document.querySelector('[inert]')).toBeNull()
  })

  it('puts focus back where it was after an in-place resume', async () => {
    installFetchMock().release()
    renderShell()
    const user = userEvent.setup()
    const retry = screen.getByRole('button', { name: 'Retry' })
    retry.focus()

    await raise()
    await user.type(await screen.findByLabelText(/username/i), 'd')
    await user.type(screen.getByLabelText(/password/i), 's')
    await user.keyboard('{Enter}')

    await waitFor(() => { expect(isSessionResumePending()).toBe(false) })
    await waitFor(() => { expect(document.activeElement).toBe(retry) })
  })
})
