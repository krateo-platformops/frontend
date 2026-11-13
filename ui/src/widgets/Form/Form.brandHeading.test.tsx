// @vitest-environment jsdom
/**
 * A Form `title` inside a Card's `brand` frame: the sign-in card's heading, with the installation
 * line ("to Krateo PlatformOps · <installation>", from the frontend's config.login, never the CR)
 * under it — both gone when a Result replaces the form. Outside a frame the title is as before
 * (Form.inputsUnchanged, Form.presentation).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { BrandFrameContext } from '../../components/BrandFrame'
import { type Config, ConfigContext } from '../../context/ConfigContext'
import { createAnonymousTransport } from '../../public/anonymousTransport'
import { WidgetTransportProvider } from '../../transport/widgetTransport'

import Form, { type FormWidgetData } from './Form'

vi.mock('../../hooks/useHandleActions', () => ({ useHandleAction: () => ({ handleAction: () => Promise.resolve(), isActionLoading: false }) }))
vi.mock('antd/es/app/useApp', () => ({ default: () => ({ message: {}, modal: {}, notification: { error: () => undefined, success: () => undefined } }) }))
vi.mock('../../components/Agentiko/agentDraft', () => ({ useAgentDraft: () => ({ draft: null, nonce: 1 }) }))
vi.mock('../Drawer/DrawerContext', () => ({ useDrawerContext: () => ({ insideDrawer: false, setDrawerData: () => undefined }) }))
vi.mock('react-router', () => ({ useNavigate: () => () => undefined }))

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
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const widgetData: FormWidgetData = {
  initialValues: { name: 'x' },
  schema: { properties: { name: { title: 'Name', type: 'string' } }, type: 'object' },
  submitPost: { path: '/intake/requests', responses: [{ result: { status: 'info', title: 'Check your inbox' }, when: { status: [202] } }] },
  title: 'Request access',
}

const renderForm = ({ brand, login }: { brand: boolean; login?: Config['login'] }) => render(
  <ConfigContext.Provider value={{ config: { login } as Config, isLoading: false, refetch: vi.fn() as never }}>
    <BrandFrameContext.Provider value={brand}>
      <WidgetTransportProvider value={createAnonymousTransport({ postAllowlist: ['/intake/'] })}>
        <Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData} />
      </WidgetTransportProvider>
    </BrandFrameContext.Provider>
  </ConfigContext.Provider>,
)

describe('a Form title inside a brand frame', () => {
  it('is the page heading, with "to Krateo PlatformOps · <installation>" from config under it', () => {
    renderForm({ brand: true, login: { installationName: 'cmp.example.dev' } })
    const heading = screen.getByRole('heading', { level: 1, name: 'Request access' })
    const line = heading.nextElementSibling as HTMLElement
    expect(line.textContent).toBe('to Krateo PlatformOps · cmp.example.dev')
    expect(line.querySelector('span')?.textContent).toBe('cmp.example.dev')
  })

  it('without an installation name in config, the bare product line', () => {
    renderForm({ brand: true })
    expect(screen.getByRole('heading', { level: 1 }).nextElementSibling?.textContent).toBe('to Krateo PlatformOps')
  })

  it('outside a frame, the plain title and no line, even with an installation name in config', () => {
    renderForm({ brand: false, login: { installationName: 'cmp.example.dev' } })
    expect(screen.getByRole('heading', { level: 3, name: 'Request access' })).toBeTruthy()
    expect(screen.queryByText(/to Krateo PlatformOps/)).toBeNull()
  })

  it('the heading and the line go with the form when a Result replaces it', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 202 }))))
    renderForm({ brand: true, login: { installationName: 'cmp.example.dev' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Submit'))
      await Promise.resolve()
    })
    expect(await screen.findByText('Check your inbox', {}, { timeout: 30_000 })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.queryByText(/to Krateo PlatformOps/)).toBeNull()
  }, 60_000)
})
