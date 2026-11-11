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

import { ReloadOutlined } from '@ant-design/icons'
import { library } from '@fortawesome/fontawesome-svg-core'
import { fab } from '@fortawesome/free-brands-svg-icons'
import { far } from '@fortawesome/free-regular-svg-icons'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp, Button, Space } from 'antd'
import { loadAll } from 'js-yaml'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router'

import DependencyGraph from '../src/components/DependencyGraph'
import DismissButton from '../src/components/DismissButton'
import FiltersProvider from '../src/components/FiltesProvider'
import ScreenHeader from '../src/components/ScreenHeader'
import StatusPill from '../src/components/StatusPill'
import { ConfigContext, type Config } from '../src/context/ConfigContext'
import { RoutesProvider } from '../src/context/RoutesContext'
import { ThemeModeProvider } from '../src/context/ThemeModeContext'
import type { WidgetProps } from '../src/types/Widget'
import { V1B } from '../src/widgets/FlowChart/__fixtures__/architecture'
import ArchitectureStateNode from '../src/widgets/FlowChart/ArchitectureStateNode'
import { ARCHITECTURE_NODE_SIZE, toArchitectureGraphData } from '../src/widgets/FlowChart/architectureVariant'
import FlowChart, { type FlowChartNodeData, type FlowChartWidgetData } from '../src/widgets/FlowChart/FlowChart'
import { Menu } from '../src/widgets/Menu/Menu'
import PageHeader from '../src/widgets/PageHeader/PageHeader'
import { getWidgetModule } from '../src/widgets/registry'
import Table, { type TableWidgetData } from '../src/widgets/Table/Table'

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
    }}
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
/**
 * `?fixture=focus-ring`: one antd Button of every type, after a plain <button> that only the
 * universal `*:focus-visible` rule styles, on the page ground and again on a panel. focus.spec.ts
 * Tabs through them and checks every Button wears the reference's ring.
 */
const focusRow = (where: string) => (
  <Space data-testid={where} wrap>
    <button data-testid={`reference-${where}`} type='button'>Plain button</button>
    <Button type='primary'>Primary</Button>
    <Button>Default</Button>
    <Button type='dashed'>Dashed</Button>
    <Button type='text'>Text</Button>
    <Button type='link'>Link</Button>
    <Button danger type='primary'>Delete</Button>
    <Button danger>Remove</Button>
    <Button aria-label='Refresh' icon={<ReloadOutlined />} />
  </Space>
)
const focusRing = () => (
  <Space orientation='vertical' size='large'>
    {focusRow('ground')}
    <div data-testid='panel-surface' style={{ background: 'var(--panelbg-color)', padding: 'var(--spacing-md)' }}>{focusRow('panel')}</div>
  </Space>
)
/**
 * `?fixture=table-cell-tooltip`: the trace page's spans table, whose red status tag carries the
 * span's OTel StatusMessage as its cell `tooltip`. tableCellTooltip.spec.ts Tabs to the tag and
 * photographs it with its tooltip open.
 */
const spansTable = {
  allowedResources: [],
  columns: [
    { title: 'Span', valueKey: 'span' },
    { title: 'Duration', valueKey: 'duration' },
    { title: 'Status', valueKey: 'status' },
  ],
  dataSource: [
    [
      { kind: 'jsonSchemaType', stringValue: 'snowplow /call', type: 'string', valueKey: 'span' },
      { kind: 'jsonSchemaType', stringValue: '30.0 s', type: 'string', valueKey: 'duration' },
      { color: 'red', kind: 'tag', stringValue: '500 · error', tooltip: 'dial tcp 10.40.4.184:8081: i/o timeout', valueKey: 'status' },
    ],
    [
      { kind: 'jsonSchemaType', stringValue: 'restaction resolve', type: 'string', valueKey: 'span' },
      { kind: 'jsonSchemaType', stringValue: '12 ms', type: 'string', valueKey: 'duration' },
      { color: 'green', kind: 'tag', stringValue: '200 · ok', valueKey: 'status' },
    ],
  ],
} as TableWidgetData

/**
 * `?fixture=nav-menu`: the sidebar nav Menu widget, its labels in sentence case and one starting
 * lower-case, so menu.spec.ts can check each renders exactly as declared. No refs and nothing
 * denied: the Menu shows every entry (navModel.isNavEntryAllowed's fail-open).
 */
const NAV_LABELS = ['Raise a ticket', 'Platform review', 'kubectl access']
const navMenu = () => (
  <div style={{ width: 240 }}>
    <Menu
      deniedRefIds={[]}
      resourcesRefs={{ items: [] }}
      uid='fixture-nav'
      widgetData={{ items: NAV_LABELS.map((label, index) => ({ label, order: index, path: `/nav-${index}` })) } as never}
    />
  </div>
)
/**
 * `?fixture=architecture&box=1179[&density=regular]`: the architecture FlowChart drawing
 * builder-publish's four-rank chain (V1B, 1360px at true size) in a box `box` px wide, as the
 * composition page gives it. architectureFit.spec.ts checks every card lands inside the box.
 */
const architectureBox = Number(params.get('box') ?? 0) || 1179
const architectureDensity = params.get('density') ?? undefined
const architecture = () => (
  <div data-testid='architecture-host' style={{ width: architectureBox }}>
    <FlowChart
      resourcesRefs={{ items: [] }}
      uid='fixture-architecture'
      widgetData={{ data: V1B, density: architectureDensity, variant: 'architecture' } as FlowChartWidgetData}
    />
  </div>
)
/**
 * `?fixture=graph-zoom&zoom=0.8`: the same chain straight through DependencyGraph at a zoom under 1,
 * the path FlowChart takes when its type floor lets it scale (today's card never does). It proves
 * the zoom is G6's camera — the cards and the edges shrink together — not a size on paper.
 */
const graphZoom = Number(params.get('zoom') ?? 1)
const zoomGraph = toArchitectureGraphData(V1B)
const renderZoomCard = ({ data }: { data: FlowChartNodeData }) => <ArchitectureStateNode data={data} />
const graphZoomFixture = () => (
  <div data-testid='architecture-host' style={{ height: 360, width: 1179 }}>
    <DependencyGraph
      edges={zoomGraph.edges}
      fit='natural'
      nodeSize={ARCHITECTURE_NODE_SIZE}
      nodes={zoomGraph.nodes}
      renderNode={renderZoomCard}
      zoom={graphZoom}
    />
  </div>
)
/**
 * `?fixture=architecture-cards`: the architecture card at both densities with the longest values a
 * chart realistically hands it — a forEach kind (`LocalResource ×8`), a 63-character name, a long
 * detail line, and each exception label — so architectureCardText.spec.ts can check, at the 12px
 * type floor, that no line wraps or runs out of its card. Each card is in a `data-case` wrapper.
 */
const LONG_NAME = 'publish-pod-sizing-v1b-localresource-configmap-overrides-000009'
type CardCase = { case: string; data: FlowChartNodeData }
const CARD_CASES: CardCase[] = [
  { case: 'forEach', data: { detail: 'waits for Repository, Repo', kind: 'LocalResource ×8', name: 'publish-pod-sizing-v1b-000 … 007', parentRefs: [], state: 'withheld', uid: 'c1' } },
  { case: 'long-name', data: { detail: 'default_branch · main', kind: 'Repository', name: LONG_NAME, parentRefs: [], state: 'done', uid: 'c2' } },
  ...(['NotSynced', 'NotReady'] as const).map((label): CardCase => ({
    case: `forEach-${label}`,
    data: {
      detail: 'waits for all 10 LocalResource',
      exception: { label, message: 'cannot determine creation result', reason: 'ReconcileError' },
      kind: 'LocalResource ×8',
      name: LONG_NAME,
      parentRefs: [],
      state: 'waiting',
      uid: `c-${label}`,
    },
  })),
  { case: 'exception', data: { detail: 'targetCommitId · 0 of 1', exception: { label: 'NotSynced', reason: 'ReconcileError' }, kind: 'Repo', name: 'publish-pod-sizing-v1b-source', parentRefs: [], state: 'waiting', uid: 'c5' } },
]
const architectureCards = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
    {(['regular', 'compact'] as const).flatMap((density) => CARD_CASES.map(({ case: name, data }) => (
      <div data-case={`${density}/${name}`} data-density-case={density} key={`${density}/${name}`}>
        <ArchitectureStateNode data={data} density={density} />
      </div>
    )))}
  </div>
)
const fixtures: Record<string, () => React.ReactNode> = {
  architecture,
  'architecture-cards': architectureCards,
  'focus-ring': focusRing,
  'graph-zoom': graphZoomFixture,
  'nav-menu': navMenu,
  'page-header': () => pageHeader('Turn an OpenAPI document into Kubernetes kinds: which operations each kind maps, how it is identified, and the credentials it calls with.'),
  'page-header-no-subtitle': () => pageHeader(),
  'screen-header': () => screenHeader('Author a page and everything it needs, then publish the whole set as one change request.'),
  'screen-header-no-subtitle': () => screenHeader(),
  'table-cell-tooltip': () => <Table resourcesRefs={{ items: [] }} uid='fixture' widget={{} as never} widgetData={spansTable} />,
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
