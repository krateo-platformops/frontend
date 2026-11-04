// @vitest-environment jsdom
/**
 * A DENIED action and a MISTYPED one must not say the same thing.
 *
 * snowplow stamps `allowed: false` on a `resourcesRefs` item the caller may not call, and
 * `WidgetRenderer` FILTERS those items out before any widget sees them — so by the time an action
 * looks up its `resourceRefId`, a ref the viewer was denied and a ref the author misspelled are
 * byte-identical: both simply absent. `WidgetRenderer` also passes the ids it filtered as
 * `deniedRefIds`, and `useHandleActions` uses that to tell them apart. Its own comment records what
 * happened before it did: every denial was reported as a broken widget definition, "blaming the
 * author for the viewer's permissions".
 *
 * WHY THIS TEST EXISTS RATHER THAN A COMMENT. I traced this path and got it wrong — I followed the
 * lookup as far as `getResourceRef` returning undefined with a console.error, concluded nothing
 * visible happened, and told another session the action failed silently. It does not. I then
 * proposed making a Button with an unresolvable action non-clickable, which would have DELETED this
 * behaviour and replaced a specific message with a mute control. Both mistakes are the kind a
 * comment cannot prevent and an assertion can.
 *
 * It is live today: the service desk mints per-ticket Roles granting `patch` by `resourceNames`,
 * and snowplow's `allowed` flag cannot see a name-scoped grant until #1048 (snowplow 1.12.65). So a
 * requester clicking "Assign to me" takes exactly this path.
 */
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ButtonWidgetData } from './Button'
import Button from './Button'

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { api: { SNOWPLOW_API_BASE_URL: 'http://snowplow.test' } }, isLoading: false }),
}))

vi.mock('../../context/RoutesContext', () => ({
  useRoutesContext: () => ({ routes: [], setRoutes: vi.fn() }),
}))

/**
 * antd 6's `useApp()` under jsdom does not provide `message.destroy`, and the dispatcher calls it
 * on entry — so without this the handler throws before reaching the decision under test. The
 * notification API is captured rather than rendered, which is also more precise than reading the
 * DOM: it asserts WHICH call was made, not what a toast happened to paint.
 */
export const notified: { level: string; message: string; description: string }[] = []
vi.mock('antd/es/app/useApp', () => ({
  default: () => ({
    message: { destroy: vi.fn(), error: vi.fn(), loading: vi.fn(), success: vi.fn(), warning: vi.fn() },
    modal: { confirm: vi.fn() },
    notification: {
      error: (arg: { message: string; description: string }) => notified.push({ description: arg.description, level: 'error', message: arg.message }),
      success: vi.fn(),
      warning: (arg: { message: string; description: string }) => notified.push({ description: arg.description, level: 'warning', message: arg.message }),
    },
  }),
}))

vi.mock('../../utils/getAccessToken', () => ({
  getAccessToken: () => Promise.resolve('token'),
  invalidateAccessTokenCache: vi.fn(),
}))

const REF_ID = 'patch-ticket'

const widgetData = (): ButtonWidgetData => ({
  actions: {
    rest: [{
      headers: ['Content-Type: application/merge-patch+json'],
      id: 'assign',
      payload: {},
      resourceRefId: REF_ID,
      type: 'rest',
    }],
  },
  clickActionId: 'assign',
  label: 'Assign to me',
} as unknown as ButtonWidgetData)

/**
 * The ref is ABSENT from `resourcesRefs` in both cases — that is the whole point. Only
 * `deniedRefIds` distinguishes them.
 */
const renderButton = (deniedRefIds: string[]) => render(
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <App>
        <Button
          deniedRefIds={deniedRefIds}
          resourcesRefs={{ items: [] }}
          uid='test'
          widget={undefined as never}
          widgetData={widgetData()}
        />
      </App>
    </QueryClientProvider>
  </MemoryRouter>
)

beforeEach(() => {
  notified.length = 0
  // Nothing should be dialled on either path; a request here would mean the lookup "succeeded".
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no request should be made'))))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('a Button whose action ref was filtered out', () => {
  it('is CLICKABLE, not disabled — the absence is reported on click, not pre-emptively', () => {
    renderButton([REF_ID])
    const button = screen.getByRole('button', { name: /assign to me/i })
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.className).not.toMatch(/disabled/)
  })

  it('a DENIED ref says the viewer may not do this, and does not blame the widget author', async () => {
    renderButton([REF_ID])
    fireEvent.click(screen.getByRole('button', { name: /assign to me/i }))

    await waitFor(() => expect(notified).toHaveLength(1))
    expect(notified[0].level).toBe('warning')
    expect(notified[0].message).toMatch(/action not permitted/i)
    expect(notified[0].description).toMatch(/do not have permission to perform this action/i)
    // The author-blaming text belongs to the OTHER case and must not appear here.
    expect(notified[0].description).not.toMatch(/widget definition/i)
  })

  it('a MISTYPED ref says the definition is wrong, and does not accuse the viewer', async () => {
    // Same absent ref, no denial recorded: this is an authoring error, and saying "you do not have
    // permission" would send someone to an administrator about a typo.
    renderButton([])
    fireEvent.click(screen.getByRole('button', { name: /assign to me/i }))

    await waitFor(() => expect(notified).toHaveLength(1))
    expect(notified[0].level).toBe('error')
    expect(notified[0].message).toMatch(/error while executing the action/i)
    expect(notified[0].description).toMatch(/widget definition does not include a resource reference/i)
    expect(notified[0].description).not.toMatch(/do not have permission/i)
  })

  it('neither case dials anything', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('no request should be made')))
    vi.stubGlobal('fetch', fetchMock)
    renderButton([REF_ID])
    fireEvent.click(screen.getByRole('button', { name: /assign to me/i }))
    await waitFor(() => expect(notified).toHaveLength(1))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
