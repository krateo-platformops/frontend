/**
 * THE HARNESS: one widget, rendered from its own example CR, in one theme. The URL picks it:
 *
 *   /visual/index.html?example=Button&doc=0&mode=dark
 *
 * `example` is the folder under src/examples/widgets; the component is resolved from the CR's own
 * `kind`, as the app does (the List folder holds `kind: Listy`).
 *
 * The fixtures are the examples that already ship with every widget
 * (src/examples/widgets/<Kind>/<Kind>.example.yaml), so a screenshot shows what a CR author is
 * told the widget looks like, and adding a widget example adds nothing here.
 *
 * The providers are the app's, minus the backend: the theme provider is the real one (it emits the
 * CSS variables and the antd theme), config is a static object instead of a fetch, routing is in
 * memory, and queries do not retry, so a widget that tries the network settles fast and the same
 * way every run.
 */
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import '../index.css'
import '../src/widgets/load'

import { library } from '@fortawesome/fontawesome-svg-core'
import { fab } from '@fortawesome/free-brands-svg-icons'
import { far } from '@fortawesome/free-regular-svg-icons'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp, Button, Space } from 'antd'
import { loadAll } from 'js-yaml'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router'

import DismissButton from '../src/components/DismissButton'
import FiltersProvider from '../src/components/FiltesProvider'
import ScreenHeader from '../src/components/ScreenHeader'
import StatusPill from '../src/components/StatusPill'
import { ConfigContext, type Config } from '../src/context/ConfigContext'
import { RoutesProvider } from '../src/context/RoutesContext'
import { ThemeModeProvider } from '../src/context/ThemeModeContext'
import type { WidgetProps } from '../src/types/Widget'
import PageHeader from '../src/widgets/PageHeader/PageHeader'
import { getWidgetModule } from '../src/widgets/registry'

const examples = import.meta.glob<string>('../src/examples/widgets/*/*.example.yaml', { eager: true, import: 'default', query: '?raw' })

// The icon set App.tsx registers. Without it every widget with an icon was photographed without one.
library.add(fab, fas, far)

const params = new URLSearchParams(window.location.search)
const folder = params.get('example') ?? ''
const doc = Number(params.get('doc') ?? 0)
const mode = params.get('mode') === 'dark' ? 'dark' : 'light'

// ThemeModeProvider reads its initial mode from here; set it before the first render.
localStorage.setItem('krateo-theme-mode', mode)

const config = {
  api: { AUTHN_API_BASE_URL: '', EVENTS_API_BASE_URL: '', EVENTS_PUSH_API_BASE_URL: '', INIT: '', SNOWPLOW_API_BASE_URL: 'http://127.0.0.1:9', TERMINAL_SOCKET_URL: '' },
  params: { DELAY_SAVE_NOTIFICATION: '0', FRONTEND_NAMESPACE: 'krateo-system' },
} as unknown as Config

type ExampleCR = { kind: string; spec: { resourcesRefs?: WidgetProps['resourcesRefs']; widgetData: unknown } }

const source = Object.entries(examples).find(([path]) => path.endsWith(`/${folder}/${folder}.example.yaml`))?.[1]
const example = source ? (loadAll(source) as ExampleCR[]).filter(Boolean)[doc] : undefined
const Component = example ? getWidgetModule(example.kind)?.component : undefined

/**
 * `?fixture=…`: the two headers with every slot filled, full width, so layout.spec.ts can measure
 * P26 in a real browser — status and actions centred on the title and subtitle together, on the
 * trailing edge, one row, never stacked.
 */
const fixture = params.get('fixture')
/** A resourcesRefs entry for a Button the spec serves by mock (see layout.spec.ts). */
const buttonRef = (id: string) => ({
  allowed: true,
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  id,
  name: id,
  namespace: 'krateo-system',
  path: `/call?resource=buttons&apiVersion=widgets.templates.krateo.io/v1beta1&name=${id}&namespace=krateo-system`,
  resource: 'buttons',
  verb: 'GET',
})
/** The PageHeader widget with the Autopilot entry point (A4) and one page action, with or without a subtitle. */
const pageHeader = (subtitle?: string) => (
  <PageHeader
    resourcesRefs={{ items: [buttonRef('ask-autopilot'), buttonRef('page-action')] } as never}
    uid='fixture'
    widgetData={{
      allowedResources: ['buttons'],
      items: [{ resourceRefId: 'ask-autopilot' }, { resourceRefId: 'page-action' }],
      subtitle,
      title: 'Controller Builder',
    } as never}
  />
)
const screenHeader = (subtitle?: string) => (
  <ScreenHeader
    actions={(
      <Space>
        <Button>Preview</Button>
        <Button>Undo</Button>
        <Button type='primary'>Publish</Button>
        <DismissButton>Close draft</DismissButton>
      </Space>
    )}
    meta='0.1.0 · Pet · cbv2202610021.example.io'
    status={<><span data-testid='status'>Saved · 23:00</span><StatusPill color='warning' label='Preview needed' /></>}
    subtitle={subtitle}
    title='cb-v2-20261002-1'
  />
)
const fixtures: Record<string, () => React.ReactNode> = {
  'page-header': () => pageHeader('Turn an OpenAPI document into Kubernetes kinds: which operations each kind maps, how it is identified, and the credentials it calls with.'),
  'page-header-no-subtitle': () => pageHeader(),
  'screen-header': () => screenHeader('Author a page and everything it needs, then publish the whole set as one change request.'),
  'screen-header-no-subtitle': () => screenHeader(),
}

const missing = <pre data-testid='missing'>{`no renderable example ${doc} in ${folder}`}</pre>
const widget = Component && example
  ? <Component resourcesRefs={example.spec.resourcesRefs ?? { items: [] }} uid={`visual-${folder}-${doc}`} widget={example as never} widgetData={example.spec.widgetData} />
  : missing
const body = fixture && fixtures[fixture] ? fixtures[fixture]() : widget

const root = ReactDOM.createRoot(document.getElementById('root')!)

root.render(
  <ThemeModeProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfigContext.Provider value={{ config, isLoading: false, refetch: (() => Promise.resolve(undefined)) as never }}>
        <RoutesProvider>
          <MemoryRouter>
            <AntdApp>
              <FiltersProvider>
                <div data-testid='case' style={{ background: 'var(--background-color)', boxSizing: 'border-box', padding: 'var(--spacing-md)', width: fixture ? '100%' : 720 }}>
                  {body}
                </div>
              </FiltersProvider>
            </AntdApp>
          </MemoryRouter>
        </RoutesProvider>
      </ConfigContext.Provider>
    </QueryClientProvider>
  </ThemeModeProvider>,
)
