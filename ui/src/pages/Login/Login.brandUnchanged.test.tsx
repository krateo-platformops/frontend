// @vitest-environment jsdom
/**
 * The sign-in card's brand band and heading. RECORDED ON MAIN, before the band and the installation
 * line were shared with the Card widget's `brand` frame: the commit that moves them into a shared
 * component has to keep this markup exactly (class names compared without their module hash, which
 * names the file they live in).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '../../context/ConfigContext'

import Login from './Login'

const branding = vi.hoisted(() => ({ login: undefined as Config['login'] }))

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({
    config: { api: { AUTHN_API_BASE_URL: 'http://authn.test' }, login: branding.login },
    isLoading: false,
  }),
}))

/** CSS-module class names without the hash of the file that defines them. */
const unhashed = (html: string): string => html.replace(/\b_([A-Za-z]+)_[0-9a-z]{4,8}\b/g, '_$1')

const renderLogin = async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <App>
      <MemoryRouter initialEntries={['/login']}>
        <QueryClientProvider client={queryClient}>
          <Login />
        </QueryClientProvider>
      </MemoryRouter>
    </App>,
  )
  await screen.findByLabelText('Username')
  return view
}

/** The band and the heading: everything in the card before the sign-in form. */
const brandMarkup = (container: HTMLElement): string => {
  const card = container.querySelector('main') as HTMLElement
  const band = card.firstElementChild as HTMLElement
  const body = band.nextElementSibling as HTMLElement
  const heading = [...body.children].slice(0, 2).map((each) => each.outerHTML).join('')
  return unhashed(band.outerHTML + heading)
}

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
})

beforeEach(() => {
  branding.login = undefined
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify([{ kind: 'basic', path: '/basic/login' }]), { status: 200 }))))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('the sign-in card\'s band and heading', () => {
  it('by default: the bundled logo, "Sign in", "to Krateo PlatformOps"', async () => {
    const { container } = await renderLogin()
    expect(brandMarkup(container)).toMatchSnapshot()
  })

  it('with a logo, its alt and an installation name from config', async () => {
    branding.login = { installationName: 'cmp.example.dev', logoAlt: 'Example', logoUrl: '/brand/logo.svg' }
    const { container } = await renderLogin()
    expect(brandMarkup(container)).toMatchSnapshot()
  })
})
