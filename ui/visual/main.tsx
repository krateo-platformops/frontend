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
// The display role (page titles, the sign-in heading). Without it every title fell back to Inter
// here while the app drew it in Syne, and a change between the two faces could not be seen.
import '@fontsource/syne/400.css'
import '@fontsource/syne/500.css'
import '@fontsource/syne/600.css'
import '@fontsource/syne/700.css'
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
import { Link, MemoryRouter } from 'react-router'

import { AgentikoProvider, AgentikoShell, AgentikoToggle } from '../src/components/Agentiko'
import AgentikoBrandScope from '../src/components/Agentiko/AgentikoBrandScope'
import DependencyGraph from '../src/components/DependencyGraph'
import DismissButton from '../src/components/DismissButton'
import FiltersProvider from '../src/components/FiltesProvider'
import ScreenHeader from '../src/components/ScreenHeader'
import StatusPill from '../src/components/StatusPill'
import { ConfigContext, type Config } from '../src/context/ConfigContext'
import { RoutesProvider } from '../src/context/RoutesProvider'
import { ThemeModeProvider } from '../src/context/ThemeModeContext'
import Login from '../src/pages/Login'
import type { WidgetProps } from '../src/types/Widget'
import { V1B } from '../src/widgets/FlowChart/__fixtures__/architecture'
import ArchitectureStateNode from '../src/widgets/FlowChart/ArchitectureStateNode'
import { ARCHITECTURE_NODE_SIZE, architectureEdgeAppearance, architectureGraphSize, toArchitectureGraphData } from '../src/widgets/FlowChart/architectureVariant'
import FlowChart, { type FlowChartNodeData, type FlowChartWidgetData } from '../src/widgets/FlowChart/FlowChart'
import Layout from '../src/widgets/Layout/Layout'
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
/**
 * `fill`: the example fills the viewport's width instead of the fixed 720px column, so a spec can
 * set a phone-width viewport and check that a widget stays inside it (overviewBlocks.spec.ts).
 */
const fill = params.has('fill')

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
 * `?fixture=primary-button`: a primary Button, enabled and disabled, in the portal's theme and inside
 * an agent surface's nested theme (AgentikoBrandScope), on the page ground and on a panel.
 * primaryButton.spec.ts reads the fill and label the browser paints at rest, on hover and pressed.
 */
const primaryRow = (where: string) => (
  <Space data-testid={where} wrap>
    <Button type='primary'>Primary</Button>
    <Button disabled type='primary'>Disabled</Button>
    <AgentikoBrandScope><Button type='primary'>Agent primary</Button></AgentikoBrandScope>
  </Space>
)
const primaryButton = () => (
  <Space orientation='vertical' size='large'>
    {primaryRow('ground')}
    <div data-testid='panel-surface' style={{ background: 'var(--panelbg-color)', padding: 'var(--spacing-md)' }}>{primaryRow('panel')}</div>
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
/**
 * `?fixture=architecture-graph`: the same chain through DependencyGraph with exactly the props the
 * architecture FlowChart gives it in a box wide enough for the design (the baseline arrangement, the
 * regular card, C19's gaps — 4 × 240 + 3 × 160 = 1440px — and its own height) — and the G6 graph handed to the page as
 * `window.__architectureGraph`, because the edges are painted on a canvas: architectureBaseline.spec.ts
 * reads the positions G6 holds and samples each drawn edge path through it.
 */
const baselineGraph = toArchitectureGraphData(V1B)
const baselineHeight = architectureGraphSize(baselineGraph.nodes, baselineGraph.edges, {
  direction: 'LR', nodeSize: ARCHITECTURE_NODE_SIZE, spacing: { nodesep: 32, ranksep: 160 },
})[1] + 32
const exposeGraph = (graph: unknown) => { (window as unknown as { __architectureGraph?: unknown }).__architectureGraph = graph ?? undefined }
const architectureGraphFixture = () => (
  <div data-testid='architecture-host' style={{ height: baselineHeight, width: 1600 }}>
    <DependencyGraph
      arrangement='baseline'
      edgeAppearance={architectureEdgeAppearance}
      edges={baselineGraph.edges}
      fit='natural'
      graphRef={exposeGraph}
      nodeSize={ARCHITECTURE_NODE_SIZE}
      nodes={baselineGraph.nodes}
      renderNode={renderZoomCard}
    />
  </div>
)
/**
 * `?fixture=app-shell`: the app shell's Layout widget as the portal chart declares it — a 236px
 * Sider with the brand in `sider.header`, the compact glyph in `sider.collapsedHeader`, the nav Menu
 * as its content, and a top bar. Its child widgets are fetched by reference, as in the app;
 * sidebar.spec.ts serves them by mock (the nav entries are the portal's pages, grouped by their
 * `krateo.io/nav-group`) and measures the rail: the 64px header band level with the top bar, the
 * one left edge at x = 24, 36px rows, the 16px gap, and the 80px collapsed rail.
 */
const shellRef = (id: string, resource: string) => ({
  allowed: true,
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  id,
  name: id,
  namespace: 'krateo-system',
  path: `/call?resource=${resource}&apiVersion=widgets.templates.krateo.io/v1beta1&name=${id}&namespace=krateo-system`,
  resource,
  verb: 'GET',
})
const appShell = () => (
  <div style={{ height: 720 }}>
    <Layout
      resourcesRefs={{ items: [shellRef('brand', 'images'), shellRef('glyph', 'images'), shellRef('nav', 'menus'), shellRef('top-bar', 'paragraphs')] } as never}
      uid='fixture-shell'
      widgetData={{ hasSider: true, header: 'top-bar', sider: { collapsedHeader: 'glyph', header: 'brand', resourceRefId: 'nav', width: 236 } }}
    />
  </div>
)
/**
 * `?fixture=login`: the sign-in page as an install that names itself and links an access request
 * sees it. Its /strategies (and the sign-in call, for the error state) are served by login.spec.ts.
 * The page fills the viewport, so this fixture is drawn without the case's padding.
 */
const loginConfig = { ...config, login: { installationName: 'krateo-057', requestAccountUrl: 'https://example.com/request-access' } } as Config
const login = () => (
  <ConfigContext.Provider value={{ config: loginConfig, isLoading: false, refetch: (() => Promise.resolve(undefined)) as never }}>
    <Login />
  </ConfigContext.Provider>
)
/**
 * `?fixture=agentiko-rail`: the real Agentiko provider and shell around a page with one
 * "Ask Agentiko →" link, which navigates with `?ask=` exactly as the widget buttons do, and the
 * header's Agentiko toggle, which opens the rail with no turn in flight. The agent's
 * endpoint is served by agentikoRail.spec.ts (the probe answers; a turn stays in flight), so the
 * rail opens and streams as it does on a live install. `&badge=…` sets AGENTIKO_RAIL_BADGE.
 */
const agentikoConfig = { ...config, api: { ...config.api, AGENTIKO_API_BASE_URL: '/agentiko-a2a/', AGENTIKO_RAIL_BADGE: params.get('badge') ?? undefined } } as Config
const agentikoRail = () => (
  <ConfigContext.Provider value={{ config: agentikoConfig, isLoading: false, refetch: (() => Promise.resolve(undefined)) as never }}>
    <AgentikoProvider>
      <AgentikoShell>
        <div style={{ padding: 'var(--spacing-md)' }}>
          <Link to='?ask=Investigate%20the%20firing%20alert'>Ask Agentiko →</Link>
          <AgentikoToggle />
        </div>
      </AgentikoShell>
    </AgentikoProvider>
  </ConfigContext.Provider>
)
const PAGE_FIXTURES = new Set(['agentiko-rail', 'login'])

/**
 * `?fixture=table-row-actions&display=menu|buttons|none&layout=normal|fit|virtual`: a Table with
 * `rowActions` (#700) in the real theme — a max-content table, a `fitContent` one, or one large
 * enough to virtualize. `display=none` is the same table without `rowActions`, the baseline its
 * rows are measured against. tableRowActions.spec.ts measures the actions column against its controls at
 * desktop and phone widths: the controls fit their cell, nothing overlaps, the header stays
 * screen-reader-only.
 */
const rowActionsDisplayParam = params.get('display')
const rowActionsDisplay = rowActionsDisplayParam === 'buttons' ? 'buttons' : 'menu'
const rowActionsLayout = params.get('layout') ?? 'normal'
const rowActionsRow = (index: number) => [
  { kind: 'jsonSchemaType', stringValue: `payments-api-${String(index).padStart(3, '0')}-eu-west-1-blue`, type: 'string', valueKey: 'name' },
  { kind: 'jsonSchemaType', stringValue: index % 2 ? 'team-checkout-production' : 'krateo-system', type: 'string', valueKey: 'ns' },
  { color: index % 3 ? 'green' : 'red', kind: 'tag', stringValue: index % 3 ? 'Ready' : 'ReconcileError', valueKey: 'status' },
  { kind: 'jsonSchemaType', numberValue: (index % 7) + 1, type: 'number', valueKey: 'replicas' },
  { kind: 'jsonSchemaType', stringValue: 'Pod scheduled on gke-krateo-pool-1 after a 30 s backoff', type: 'string', valueKey: 'message' },
]
const tableRowActions = () => (
  <Table
    resourcesRefs={{ items: [] }}
    uid='fixture-row-actions'
    widget={{} as never}
    widgetData={{
      // eslint-disable-next-line no-template-curly-in-string -- a navigate action's `${valueKey}` path
      actions: { navigate: [{ id: 'logs', path: '/compositions/${ns}/${name}/logs', type: 'navigate' }, { id: 'restart', path: '/compositions/${ns}/${name}/restart', type: 'navigate' }] },
      allowedResources: [],
      columns: [
        { title: 'Name', valueKey: 'name' },
        { title: 'Namespace', valueKey: 'ns' },
        { title: 'Status', valueKey: 'status' },
        { title: 'Replicas', valueKey: 'replicas' },
        { title: 'Message', valueKey: 'message' },
      ],
      dataSource: Array.from({ length: rowActionsLayout === 'virtual' ? 120 : 3 }, (_, index) => rowActionsRow(index)),
      fitContent: rowActionsLayout === 'fit',
      rowActions: rowActionsDisplayParam === 'none'
        ? undefined
        : [
          { actionId: 'logs', icon: 'fa-file-lines', label: 'Logs' },
          { actionId: 'restart', danger: true, icon: 'fa-rotate-right', label: 'Restart' },
        ],
      rowActionsDisplay,
      rowNavigateTo: '/compositions/{ns}/{name}',
    } as unknown as TableWidgetData}
  />
)

/**
 * `?fixture=table-virtual-alignment&box=1209&rows=116[&uid=…]`: a VIRTUAL Table shaped like the
 * open-proposals table that showed the defect — nine columns, most with a `minWidth`, two of tags,
 * one of condition pills, `fitContent`, small — in a box narrower than the columns ask for.
 * tableVirtualAlignment.spec.ts checks every header th starts where its body cells do, before and
 * after a column resize.
 */
const alignmentBox = Number(params.get('box') ?? 0) || 1209
const alignmentRows = Number(params.get('rows') ?? 0) || 116
const alignmentRow = (index: number) => [
  { kind: 'jsonSchemaType', stringValue: `Raise the memory limit of payments-api-${index} so it stops restarting under load`, type: 'string', valueKey: 'title' },
  { kind: 'jsonSchemaType', stringValue: `Deployment team-checkout/payments-api-${index}`, type: 'string', valueKey: 'subject' },
  { color: 'gray', kind: 'tag', stringValue: index % 2 ? 'yaml' : 'markdown', valueKey: 'kind' },
  { kind: 'jsonSchemaType', stringValue: 'Pods, events, container metrics', type: 'string', valueKey: 'sources' },
  { kind: 'conditions', stringValue: JSON.stringify([{ color: 'gray', status: 'True', type: 'Kind n/a' }]), valueKey: 'checks' },
  { color: index % 3 ? 'blue' : 'green', kind: 'tag', stringValue: index % 3 ? 'Open' : 'Ready', valueKey: 'phase' },
  { kind: 'jsonSchemaType', stringValue: index % 4 ? '-' : 'Yes', type: 'string', valueKey: 'superseded' },
  { kind: 'jsonSchemaType', stringValue: '3 hours ago', type: 'string', valueKey: 'created' },
  { kind: 'jsonSchemaType', stringValue: `apps/v1 Deployment team-checkout/payments-api-${index}`, type: 'string', valueKey: 'target' },
]
const tableVirtualAlignment = () => (
  <div data-testid='alignment-box' style={{ width: alignmentBox }}>
    <Table
      resourcesRefs={{ items: [] }}
      uid={params.get('uid') ?? 'fixture-virtual-alignment'}
      widget={{} as never}
      widgetData={{
        allowedResources: [],
        bordered: false,
        columns: [
          { minWidth: 300, title: 'Proposal', valueKey: 'title' },
          { minWidth: 180, title: 'Subject', valueKey: 'subject' },
          { title: 'Kind', valueKey: 'kind' },
          { minWidth: 150, title: 'Evidence sources', valueKey: 'sources' },
          { minWidth: 150, title: 'Checks', valueKey: 'checks' },
          { title: 'Status', valueKey: 'phase' },
          { title: 'Superseded', valueKey: 'superseded' },
          { minWidth: 110, title: 'Proposed', valueKey: 'created' },
          { minWidth: 180, title: 'Proposed target', valueKey: 'target' },
        ],
        dataSource: Array.from({ length: alignmentRows }, (_, index) => alignmentRow(index)),
        fitContent: true,
        size: 'small',
      } as unknown as TableWidgetData}
    />
  </div>
)

const fixtures: Record<string, () => React.ReactNode> = {
  'agentiko-rail': agentikoRail,
  'app-shell': appShell,
  architecture,
  'architecture-cards': architectureCards,
  'architecture-graph': architectureGraphFixture,
  'focus-ring': focusRing,
  'graph-zoom': graphZoomFixture,
  login,
  'nav-menu': navMenu,
  'page-header': () => pageHeader('Turn an OpenAPI document into Kubernetes kinds: which operations each kind maps, how it is identified, and the credentials it calls with.'),
  'page-header-no-subtitle': () => pageHeader(),
  'primary-button': primaryButton,
  'screen-header': () => screenHeader('Author a page and everything it needs, then publish the whole set as one change request.'),
  'screen-header-no-subtitle': () => screenHeader(),
  'table-cell-tooltip': () => <Table resourcesRefs={{ items: [] }} uid='fixture' widget={{} as never} widgetData={spansTable} />,
  'table-row-actions': tableRowActions,
  'table-virtual-alignment': tableVirtualAlignment,
}

const missing = <pre data-testid='missing'>{`no renderable example ${doc} in ${folder}`}</pre>
const widget = Component && example
  ? <Component resourcesRefs={example.spec.resourcesRefs ?? { items: [] }} uid={`visual-${folder}-${doc}`} widget={example as never} widgetData={example.spec.widgetData} />
  : missing
const body = fixture && fixtures[fixture] ? fixtures[fixture]() : widget
// A page fixture fills the viewport, as the app's own `.app` does (App.module.css).
const isPageFixture = !!fixture && PAGE_FIXTURES.has(fixture)

const root = ReactDOM.createRoot(document.getElementById('root')!)

root.render(
  <ThemeModeProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfigContext.Provider value={{ config, isLoading: false, refetch: (() => Promise.resolve(undefined)) as never }}>
        <RoutesProvider>
          <MemoryRouter>
            <AntdApp style={isPageFixture ? { height: '100%' } : undefined}>
              <FiltersProvider>
                <div
                  data-testid='case'
                  style={isPageFixture
                    ? { height: '100%', width: '100%' }
                    : { background: 'var(--background-color)', boxSizing: 'border-box', padding: 'var(--spacing-md)', width: fixture || fill ? '100%' : 720 }}
                >
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
