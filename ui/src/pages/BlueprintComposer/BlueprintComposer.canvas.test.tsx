// @vitest-environment jsdom
/**
 * The held chart: the header, the architecture graph, the machine it derives, and the node
 * inspector — mockup screens 3, 5 and 8, against builder-publish's real machine.
 *
 * The graph is the FlowGraph double (jsdom has no canvas). What it records is the contract that
 * matters here: every FlowGraph render is a full G6 layout in the real thing, so "renders stays at
 * 1" means the person's pan and zoom survived; `setElementState` is the step drawn without one.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTOPILOT_PREVIEW_FILE_ADD_EVENT, type FileAddDetail } from '../../components/Autopilot/previewFileAdd'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'

import { ARCHITECTURE_TEMPLATE_PATH, parseArchitecture, unwrapFromConfigMapTemplate, type ResourceNode } from './architecture'
import { builderPublishChart, chartWith, hold, installAntdShims, installScrollShim, listen, mount, scrolled, seededChart } from './blueprintTestHarness'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

beforeAll(() => {
  installAntdShims()
  installScrollShim()
})
beforeEach(() => graphDouble.reset())
afterEach(cleanup)

const card = (id: string): HTMLElement => screen.getByTestId(`node-card-${id}`)
const statesOf = (id: string): string[] => (card(id).getAttribute('data-states') ?? '').split(' ').filter(Boolean)
const step = (label: RegExp) => screen.getByRole('button', { name: label })
const native = (id: string, dependsOn?: ResourceNode['dependsOn']): ResourceNode =>
  ({ apiVersion: 'v1', class: 'native', dependsOn, id, kind: 'ConfigMap', template: `templates/${id}.yaml` })

describe('BlueprintComposer — the header of a held chart (screen 3)', () => {
  it('names the chart, its version and its generated Kind, and counts the files with no cap', () => {
    mount()
    hold(builderPublishChart())
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toContain('builder-publish')
    expect(within(heading).getByText('0.1.0 · BuilderPublish')).toBeTruthy()
    expect(screen.getByText('9 files')).toBeTruthy()
    expect(screen.getByText('Blueprint Builder / Compose')).toBeTruthy()
  })

  it('offers Preview, Undo, Publish and Close draft', () => {
    mount()
    hold(builderPublishChart())
    for (const name of ['Preview', 'Undo', 'Publish', 'Close draft']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })
})

describe('BlueprintComposer — the architecture graph', () => {
  it('draws one card per resource, from templates/architecture.yaml, with its kind, group and class', () => {
    mount()
    hold(builderPublishChart())
    expect(graphDouble.last().data?.nodes?.map((node) => node.id)).toEqual(['localresources', 'pullrequest', 'repo', 'repository', 'username-secret'])
    expect(within(card('repository')).getByText('Repository · github.krateo.io')).toBeTruthy()
    expect(within(card('localresources')).getByText('×N')).toBeTruthy()
    expect(within(card('username-secret')).getByText('shim')).toBeTruthy()
    expect(within(card('repo')).getByText('optional')).toBeTruthy()
    const pane = screen.getByLabelText('Architecture')
    expect(within(pane).getByText('5 resources')).toBeTruthy()
    expect(within(pane).getByText('4 states')).toBeTruthy()
  })

  it('hands dagre the card box (156×72) and dashes nothing that waits for readiness', () => {
    mount()
    hold(chartWith([native('db'), native('web', [{ ref: 'db' }]), native('svc', [{ ready: true, ref: 'web' }])]))
    const options = graphDouble.last()
    expect((options.node as { style: { size: number[] } }).style.size).toEqual([156, 72])
    const { style } = (options.edge as { style: { lineDash: (datum: unknown) => unknown } })
    const edges = options.data?.edges as { id: string }[]
    expect(style.lineDash(edges.find((edge) => edge.id === 'web:dependsOn[0]'))).toEqual([6, 4])
    expect(style.lineDash(edges.find((edge) => edge.id === 'svc:dependsOn[0]'))).toBe(0)
  })

  it('labels an edge only with `all` — the Values conditions stay in the inspector, off the curves', () => {
    mount()
    hold(builderPublishChart())
    const options = graphDouble.last()
    const { style } = (options.edge as { style: { labelText: (datum: unknown) => string } })
    const edges = options.data?.edges as { id: string }[]
    expect(style.labelText(edges.find((edge) => edge.id === 'pullrequest:dependsOn[0]'))).toBe('all')
    expect(style.labelText(edges.find((edge) => edge.id === 'repo:dependsOn[0]'))).toBe('')
  })

  it('zero resources: the screen-3 empty state, adapted — how to add one today — and "S1 · initial"', () => {
    mount()
    hold(seededChart())
    const pane = screen.getByLabelText('Architecture')
    expect(within(pane).getByText('No resources yet')).toBeTruthy()
    expect(within(pane).getByText(/ask Autopilot to add it/)).toBeTruthy()
    expect(within(pane).getByText('0 resources')).toBeTruthy()
    expect(within(pane).getByText('S1 · initial')).toBeTruthy()
    // Nothing to lay out: no graph was drawn at all.
    expect(graphDouble.renders).toHaveLength(0)
  })

  it('NO architecture file: its own state, and one button that adds an empty, readable descriptor', () => {
    const adds = listen<FileAddDetail>(AUTOPILOT_PREVIEW_FILE_ADD_EVENT)
    const { [ARCHITECTURE_TEMPLATE_PATH]: _descriptor, ...agentAuthored } = seededChart()
    mount()
    hold(agentAuthored)
    expect(screen.getByText('This chart has no architecture file')).toBeTruthy()
    act(() => { screen.getByRole('button', { name: `Add ${ARCHITECTURE_TEMPLATE_PATH}` }).click() })
    adds.stop()
    expect(adds.seen).toHaveLength(1)
    expect(adds.seen[0].path).toBe(ARCHITECTURE_TEMPLATE_PATH)
    const parsed = parseArchitecture(unwrapFromConfigMapTemplate(adds.seen[0].content) ?? '')
    expect(parsed.ok && parsed.architecture).toMatchObject({ chart: 'builder-publish', resources: [] })
  })

  it('a file with no descriptor block: said, not crashed', () => {
    mount()
    hold({ ...seededChart(), [ARCHITECTURE_TEMPLATE_PATH]: 'apiVersion: v1\nkind: ConfigMap\ndata: {}\n' })
    expect(screen.getByText('The architecture file carries no descriptor')).toBeTruthy()
    expect(graphDouble.renders).toHaveLength(0)
  })

  it('a descriptor the kernel refuses: each problem by path, and the way to the file', () => {
    mount()
    hold(chartWith([native('web', [{ ref: 'nowhere' }])]))
    expect(screen.getByText('The architecture file cannot be drawn')).toBeTruthy()
    expect(screen.getByText(/resources\[0\]\.dependsOn\[0\] — "nowhere" is not a resource of this chart/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: `Open ${ARCHITECTURE_TEMPLATE_PATH}` }).length).toBeGreaterThan(0)
  })

  it('a cycle: the loop is drawn and named, its members marked, and there are no states to step', () => {
    mount()
    hold(chartWith([native('a', [{ ref: 'b' }]), native('b', [{ ref: 'a' }])]))
    expect(screen.getByRole('alert').textContent).toMatch(/The dependencies form a cycle: a → b → a|The dependencies form a cycle: b → a → b/)
    expect(statesOf('a')).toContain('cycle')
    expect(statesOf('b')).toContain('cycle')
    expect(within(screen.getByLabelText('Architecture')).getByText('no states')).toBeTruthy()
    expect(within(screen.getByLabelText('State')).getByText(/never leaves its first state/)).toBeTruthy()
  })
})

describe('BlueprintComposer — the state stepper (screen 8)', () => {
  it('one step per derived state, named from the descriptor; S1 lit to start', () => {
    mount()
    hold(builderPublishChart())
    for (const label of [/S1\s*repository-only/, /S2\s*seeding/, /S3\s*committing/, /S4\s*change-request-open/]) {
      expect(step(label)).toBeTruthy()
    }
    expect(step(/S1/).getAttribute('aria-pressed')).toBe('true')
    expect(statesOf('repository')).toEqual(['frontier'])
    expect(statesOf('pullrequest')).toEqual(['withheld'])
    expect(statesOf('username-secret')).toEqual(['orthogonal'])
  })

  it('stepping sets ELEMENT STATES on the live graph and does NOT lay it out again', () => {
    mount()
    hold(builderPublishChart())
    expect(graphDouble.renders).toHaveLength(1)
    act(() => { step(/S3/).click() })
    expect(graphDouble.renders).toHaveLength(1)
    expect(graphDouble.stateUpdates).toHaveLength(1)
    expect(graphDouble.stateUpdates[0]).toMatchObject({
      localresources: ['frontier'],
      'localresources:dependsOn[0]': ['lit'],
      pullrequest: ['withheld'],
      'pullrequest:dependsOn[0]': ['withheld'],
      repo: ['lit'],
      repository: ['lit'],
      'username-secret': ['orthogonal'],
    })
    // …and the cards redraw in their new states where they stand.
    expect(statesOf('localresources')).toEqual(['frontier'])
    expect(statesOf('repository')).toEqual(['lit'])
    expect(step(/S3/).getAttribute('aria-pressed')).toBe('true')
    expect(step(/S1/).getAttribute('data-done')).toBe('true')
  })

  it('the side panel says what the selected state renders, withholds and waits for — shims apart', () => {
    mount()
    hold(builderPublishChart())
    act(() => { step(/S3/).click() })
    const panel = screen.getByLabelText('State')
    expect(within(panel).getByText('State S3')).toBeTruthy()
    expect(within(panel).getByText('committing')).toBeTruthy()
    expect(within(panel).getByText('localresources ×N · repo · repository')).toBeTruthy()
    expect(within(panel).getByText('pullrequest')).toBeTruthy()
    expect(within(panel).getByText('every localresources has .status.targetCommitId')).toBeTruthy()
    expect(within(panel).getByText('username-secret')).toBeTruthy()
    act(() => { step(/S4/).click() })
    expect(within(panel).getByText('This is the last state: nothing waits on it.')).toBeTruthy()
  })

  it('a broadcast that changes only the gate is not a re-layout (Preview arming the chart keeps pan and zoom)', () => {
    const files = builderPublishChart()
    mount()
    hold(files, { previewed: false })
    hold({ ...files }, { previewed: true })
    expect(graphDouble.renders).toHaveLength(1)
  })

  it('an edit to the descriptor IS new data, laid out once, with the current step in it', () => {
    const files = builderPublishChart()
    mount()
    hold(files)
    act(() => { step(/S2/).click() })
    const edited = files[ARCHITECTURE_TEMPLATE_PATH].replace('- { name: seeding }', '- { name: seeding-the-repo }')
    hold({ ...files, [ARCHITECTURE_TEMPLATE_PATH]: edited })
    expect(graphDouble.renders).toHaveLength(2)
    const repo = graphDouble.last().data?.nodes?.find((node) => node.id === 'repo')
    expect(repo?.states).toEqual(['frontier'])
    expect(step(/S2\s*seeding-the-repo/)).toBeTruthy()
  })
})

describe('BlueprintComposer — selecting a node (screen 5)', () => {
  it('a click on the graph fills the inspector, read-only, with the descriptor\'s own fields', () => {
    mount()
    hold(builderPublishChart())
    act(() => graphDouble.click('localresources'))
    const inspector = screen.getByLabelText('Inspector')
    expect(within(inspector).getByText('LocalResource · git.krateo.io/v1alpha1')).toBeTruthy()
    expect(within(inspector).getByRole('button', { name: 'templates/localresources.yaml' })).toBeTruthy()
    expect(within(inspector).getByText('.status.targetCommitId')).toBeTruthy()
    expect(within(inspector).getByText('builder-publish.files')).toBeTruthy()
    expect(within(inspector).getByText(/waits until it is ready, only when \.Values\.repository\.create is set/)).toBeTruthy()
    expect(within(inspector).getByText('S3')).toBeTruthy()
    expect(within(inspector).getByText(/Read-only for now/)).toBeTruthy()
  })

  it('a class default answers readiness when readyWhen is omitted, and says it is the default', () => {
    mount()
    hold(builderPublishChart())
    act(() => graphDouble.click('username-secret'))
    const inspector = screen.getByLabelText('Inspector')
    expect(within(inspector).getByText('Ready when · default for this class')).toBeTruthy()
    expect(within(inspector).getByText('kstatus Current')).toBeTruthy()
    expect(within(inspector).getByText('outside the sequence')).toBeTruthy()
  })

  it('marks the node selected on the live graph — without a layout — and opens its template in Chart files', async () => {
    mount()
    hold(builderPublishChart())
    act(() => graphDouble.click('repository'))
    expect(graphDouble.renders).toHaveLength(1)
    expect(statesOf('repository')).toContain('selected')
    expect(screen.getByRole('tab', { name: 'Chart files', selected: true })).toBeTruthy()
    // The reveal scrolls on the next frame, once the Files tab is mounted.
    await waitFor(() => expect(scrolled).toHaveBeenCalled())
  })

  it('the card is a real button: a keyboard press selects exactly as a pointer click does', () => {
    mount()
    hold(builderPublishChart())
    act(() => { card('repo').click() })
    expect(within(screen.getByLabelText('Inspector')).getByText('Repo · git.krateo.io/v1alpha1')).toBeTruthy()
    expect(card('repo').getAttribute('aria-pressed')).toBe('true')
  })

  it('Source still opens with a node selected — the reveal does not pin the Files tab', () => {
    mount()
    hold(builderPublishChart())
    act(() => graphDouble.click('repository'))
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Source' })) })
    expect(screen.getByRole('tab', { name: 'Source', selected: true })).toBeTruthy()
  })

  it('Clear returns the inspector to its hint', () => {
    mount()
    hold(builderPublishChart())
    act(() => graphDouble.click('repository'))
    act(() => { screen.getByRole('button', { name: 'Clear' }).click() })
    expect(within(screen.getByLabelText('Inspector')).getByText(/Select a node to see what it is/)).toBeTruthy()
    expect(statesOf('repository')).not.toContain('selected')
  })
})

describe('BlueprintComposer — the create-form preview, under the inspector', () => {
  it('says why it is empty when the schema has no properties (screen 3)', () => {
    mount()
    hold(seededChart())
    expect(screen.getByText('The form is empty because values.schema.json has no properties yet.')).toBeTruthy()
  })

  it('renders the form a consumer would get once the schema has a field — once, beside the graph, not again in Source', () => {
    const schema = JSON.stringify({ properties: { replicas: { title: 'Replicas', type: 'integer' } }, type: 'object' })
    mount()
    hold({ ...seededChart(), 'values.schema.json': schema })
    expect(screen.getAllByTestId('autopilot-form-preview')).toHaveLength(1)
    expect(within(screen.getByLabelText('Inspector')).getByTestId('autopilot-form-preview')).toBeTruthy()
  })
})
