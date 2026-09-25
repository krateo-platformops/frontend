// @vitest-environment jsdom
/**
 * The Blueprint Composer's LIFECYCLE: mounting bare, owning the claim, parking a page, starting a
 * chart. The canvas and the machine are BlueprintComposer.canvas.test.tsx; preview and publish are
 * BlueprintComposer.preview.test.tsx.
 *
 * The acceptance criteria are the approved mockup screens — 2 (Start) and 3 (the empty composer) —
 * held to what S3b builds: the copy the person reads, the derivations shown as they type, and the
 * provider's answers routed to where they can be acted on.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTOPILOT_PREVIEW_EVENT } from '../../components/Autopilot/previewBus'
import { AUTOPILOT_DRAFT_REPLAY_EVENT, emitDraftChanged, previewSurfaceClaimed } from '../../components/Autopilot/previewDraftChanged'
import { onDraftClose } from '../../components/Autopilot/previewDraftClose'
import { AUTOPILOT_CHART_START_EVENT, type ChartStartDetail } from '../../components/Autopilot/previewDraftRender'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'

import BlueprintComposer from './BlueprintComposer'
import { answer, hold, installAntdShims, installScrollShim, listen, mount, mountWithOwner, renderedPayload, seededChart } from './blueprintTestHarness'
import { startChart } from './startChart'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

beforeAll(() => {
  installAntdShims()
  installScrollShim()
})
beforeEach(() => graphDouble.reset())
afterEach(cleanup)

/** Open the Start modal from the empty state. */
const openStart = () => {
  act(() => { screen.getByRole('button', { name: 'Start a chart' }).click() })
  return screen.getByRole('dialog')
}

const type = (label: string, value: string) => {
  act(() => { fireEvent.change(screen.getByLabelText(label), { target: { value } }) })
}

describe('BlueprintComposer — mounted bare, like the Page Composer', () => {
  it('renders with NO provider of any kind around it', () => {
    // No AutopilotProvider, no router, no theme, no config: the page talks to the provider only
    // through window buses, so there is nothing above it to require.
    expect(() => render(<BlueprintComposer />)).not.toThrow()
    expect(screen.getByText(/No chart open/)).toBeTruthy()
  })

  it('asks for a replay on mount, so a chart held before it opened is shown', () => {
    const replays = vi.fn()
    window.addEventListener(AUTOPILOT_DRAFT_REPLAY_EVENT, replays)
    mount()
    window.removeEventListener(AUTOPILOT_DRAFT_REPLAY_EVENT, replays)
    expect(replays).toHaveBeenCalledTimes(1)
  })

  it('claims the BLUEPRINT preview surface while mounted and releases it on unmount — never the page one', () => {
    expect(previewSurfaceClaimed('blueprint')).toBe(false)
    const view = mount()
    expect(previewSurfaceClaimed('blueprint')).toBe(true)
    // A page preview must still reach the drawer (or the Page Composer): this page cannot show one.
    expect(previewSurfaceClaimed('page')).toBe(false)
    view.unmount()
    expect(previewSurfaceClaimed('blueprint')).toBe(false)
  })
})

describe('BlueprintComposer — nothing held (screen 2, behind the modal)', () => {
  it('names the page and says no chart is open, through the shared empty state with Start inside it', () => {
    mount()
    expect(screen.getByText('Blueprint Builder / Compose')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Blueprint composer' })).toBeTruthy()
    const empty = document.querySelector('.ant-empty')
    expect(empty?.textContent).toMatch(/No chart open/)
    expect(empty?.querySelector('button')?.textContent).toBe('Start a chart')
  })

  it('offers no chart controls — there is nothing to preview, publish or close', () => {
    mount()
    for (const name of ['Preview', 'Publish', 'Undo', 'Close draft']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.queryByLabelText('Architecture')).toBeNull()
  })
})

describe('BlueprintComposer — a held PAGE draft is parked, never read as a chart', () => {
  const pageSet = {
    'Chart.yaml': 'apiVersion: v2\nname: portal-pages\nversion: 0.1.0\n',
    'templates/flex.page-x.yaml': 'kind: Flex\nmetadata:\n  name: page-x\n',
    'values.schema.json': '{"type":"object","properties":{}}',
  }

  it('says a portal page draft is open and links to the Portal Builder, client-side', () => {
    mount()
    act(() => emitDraftChanged({ files: pageSet, kind: 'page' }))
    expect(screen.getByText(/A portal page draft is open in this thread/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the page in the Portal Builder' }).getAttribute('href')).toBe('/portal-builder/compose')
  })

  it('draws nothing from the page set: no header name, no file count, no canvas, no Chart files', () => {
    // A page set carries Chart.yaml and values.schema.json under a chart's own names; read as a
    // chart, it would draw a composer for "portal-pages" that publishes a page as a blueprint.
    mount()
    act(() => emitDraftChanged({ files: pageSet, kind: 'page' }))
    expect(screen.queryByText('portal-pages')).toBeNull()
    expect(screen.queryByText(/3 files/)).toBeNull()
    expect(screen.queryByLabelText('Architecture')).toBeNull()
    expect(screen.queryByText('Chart files')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start a chart' })).toBeNull()
  })

  it('parks files broadcast with NO kind too — a legacy emitter only ever held pages', () => {
    mount()
    act(() => emitDraftChanged({ files: pageSet }))
    expect(screen.getByText(/A portal page draft is open/)).toBeTruthy()
  })

  it('offers a real discard of the parked page — the provider drops it', () => {
    const closes = vi.fn()
    const stop = onDraftClose(closes)
    mount()
    act(() => emitDraftChanged({ files: pageSet, kind: 'page' }))
    act(() => { screen.getByRole('button', { name: 'Discard page draft' }).click() })
    act(() => { screen.getByRole('button', { name: 'Discard' }).click() })
    stop()
    expect(closes).toHaveBeenCalledTimes(1)
  })

  it('un-parks when the page is gone, back to the empty state', () => {
    mount()
    act(() => emitDraftChanged({ files: pageSet, kind: 'page' }))
    act(() => emitDraftChanged({ files: {}, kind: null }))
    expect(screen.getByText(/No chart open/)).toBeTruthy()
  })
})

describe('BlueprintComposer — Start a chart (screen 2)', () => {
  it('opens the modal the mockup draws: eyebrow, heading, version defaulted to 0.1.0', () => {
    mount()
    const dialog = openStart()
    expect(within(dialog).getByText('Start a chart')).toBeTruthy()
    expect(within(dialog).getByText('Name the chart; the Kind follows')).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('Version').value).toBe('0.1.0')
    expect(within(dialog).getByText(/Nothing reaches the cluster before the change request/)).toBeTruthy()
  })

  it('derives the Kind and the claim apiVersion AS THE NAME IS TYPED — core-provider\'s rules, acronyms included', () => {
    mount()
    openStart()
    expect(screen.getByTestId('derived-kind').textContent).toBe('—')
    type('Chart name', 'builder-publish')
    expect(screen.getByTestId('derived-kind').textContent).toBe('BuilderPublish')
    expect(screen.getByTestId('derived-api-version').textContent).toBe('composition.krateo.io/v0-1-0')
    type('Chart name', 'api-gateway')
    expect(screen.getByTestId('derived-kind').textContent).toBe('APIGateway')
    type('Version', '10.20.30')
    expect(screen.getByTestId('derived-api-version').textContent).toBe('composition.krateo.io/v10-20-30')
  })

  it('OMITS "Registered as" when the install names no blueprint builder owner — no guessed org', () => {
    mount()
    openStart()
    type('Chart name', 'builder-publish')
    expect(screen.queryByText('Registered as')).toBeNull()
    expect(screen.queryByTestId('derived-oci')).toBeNull()
  })

  it('shows the OCI location under the configured owner, and names the owner in the help', () => {
    mountWithOwner('krateo-blueprints/blueprints')
    openStart()
    type('Chart name', 'builder-publish')
    expect(screen.getByTestId('derived-oci').textContent).toBe('oci://ghcr.io/krateo-blueprints/charts/builder-publish')
    expect(screen.getByText(/repository name under krateo-blueprints/)).toBeTruthy()
  })

  it('refuses a name inline, as typed, and sends nothing', () => {
    const starts = listen<ChartStartDetail>(AUTOPILOT_CHART_START_EVENT)
    mount()
    openStart()
    type('Chart name', 'Builder Publish')
    act(() => { screen.getByRole('button', { name: 'Start' }).click() })
    starts.stop()
    expect(starts.seen).toHaveLength(0)
    expect(screen.getByText(/DNS-1123|lower-case/i)).toBeTruthy()
  })

  it('refuses a name whose Kind outgrows the controller container budget at this version — and says the budget', () => {
    mount()
    openStart()
    // 43 letters of Kind at 0.1.0, where the budget is 42.
    type('Chart name', `a${'b'.repeat(42)}`)
    expect(screen.getByText(/at most 42/)).toBeTruthy()
    expect(screen.getByLabelText('Chart name').getAttribute('aria-invalid')).toBe('true')
  })

  it('WARNS about the metrics Service budget without refusing — Start still starts the chart', () => {
    const starts = listen<ChartStartDetail>(AUTOPILOT_CHART_START_EVENT)
    mount()
    openStart()
    // Kind 35 at 0.1.0: over the metrics Service's 34, well inside the container's 42.
    type('Chart name', `a${'b'.repeat(34)}`)
    expect(screen.getByText(/may not fit one that runs core-provider with CDC metrics on/)).toBeTruthy()
    expect(screen.getByLabelText('Chart name').getAttribute('aria-invalid')).toBeNull()
    act(() => { screen.getByRole('button', { name: 'Start' }).click() })
    starts.stop()
    expect(starts.seen).toHaveLength(1)
  })

  it('ties each refusal to its field — invalid, described by its reason — and puts focus on the first', () => {
    // Red text under a field is not an error a screen reader hears: with no aria-invalid and no
    // aria-describedby, Start did nothing and nothing was announced.
    mount()
    openStart()
    type('Chart name', 'Builder_Publish')
    type('Version', '1.x')
    act(() => { screen.getByRole('button', { name: 'Start' }).click() })
    const described = (input: HTMLElement): string =>
      (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
    const name = screen.getByLabelText('Chart name')
    const version = screen.getByLabelText('Version')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(described(name)).toMatch(/not a valid chart name/)
    expect(version.getAttribute('aria-invalid')).toBe('true')
    expect(described(version)).toMatch(/a semantic version such as 0\.1\.0/)
    expect(document.activeElement).toBe(name)
  })

  it('a field that is fine is not marked invalid, and is still described by its help', () => {
    mount()
    openStart()
    type('Chart name', 'builder-publish')
    const name = screen.getByLabelText('Chart name')
    expect(name.getAttribute('aria-invalid')).toBeNull()
    expect(document.getElementById(name.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/Lower-case, dashes/)
  })

  it('refuses a version that is not SemVer', () => {
    mount()
    openStart()
    type('Chart name', 'builder-publish')
    type('Version', 'one')
    expect(screen.getByText(/a semantic version such as 0.1.0/)).toBeTruthy()
  })

  it('emits exactly the files startChart seeds, with a correlation id, on the chart-start bus', () => {
    const starts = listen<ChartStartDetail>(AUTOPILOT_CHART_START_EVENT)
    mount()
    openStart()
    type('Chart name', 'builder-publish')
    type('Description', 'Publishes a page set to git')
    act(() => { screen.getByRole('button', { name: 'Start' }).click() })
    starts.stop()
    expect(starts.seen).toHaveLength(1)
    expect(starts.seen[0].id).toBeTruthy()
    const expected = startChart({ description: 'Publishes a page set to git', name: 'builder-publish', version: '0.1.0' })
    expect(expected.ok && starts.seen[0].files).toEqual(expected.ok ? expected.files : null)
  })

  it('keeps a REFUSED start in the modal, in the provider\'s words — and ignores answers that are not its own', () => {
    const starts = listen<ChartStartDetail>(AUTOPILOT_CHART_START_EVENT)
    mount()
    openStart()
    type('Chart name', 'builder-publish')
    act(() => { screen.getByRole('button', { name: 'Start' }).click() })
    starts.stop()
    answer({ id: 'someone-else', message: 'not ours', outcome: 'refused' })
    expect(screen.queryByText('not ours')).toBeNull()
    answer({ id: starts.seen[0].id, message: 'A draft is already open in this thread — discard it before starting another.', outcome: 'refused' })
    expect(within(screen.getByRole('dialog')).getByText(/A draft is already open in this thread/)).toBeTruthy()
  })

  it('an accepted start: the modal closes when the chart is held, and the composer takes over', () => {
    const starts = listen<ChartStartDetail>(AUTOPILOT_CHART_START_EVENT)
    mount()
    openStart()
    type('Chart name', 'builder-publish')
    act(() => { screen.getByRole('button', { name: 'Start' }).click() })
    starts.stop()
    // The provider holds the tree FIRST (the broadcast), then renders it.
    hold(starts.seen[0].files, { previewed: false })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('builder-publish')
    // The render is still on the wire: the Preview button says so.
    expect(screen.getByRole('button', { name: /Previewing/ })).toBeTruthy()
  })

  it.each([
    ['unavailable', 'This portal has no chart render configured', /no chart render configured/],
    ['failed', 'The chart did not render, so it cannot be published yet.', /did not render.*The render error is in Source/],
  ] as const)('reports a %s first render in the composer, not the modal', (outcome, message, shown) => {
    const starts = listen<ChartStartDetail>(AUTOPILOT_CHART_START_EVENT)
    mount()
    openStart()
    type('Chart name', 'builder-publish')
    act(() => { screen.getByRole('button', { name: 'Start' }).click() })
    starts.stop()
    const [{ files, id }] = starts.seen
    hold(files, { previewed: false })
    answer({ id, message, outcome, ...(outcome === 'failed' ? { payload: renderedPayload(files, [], 'template: x: bad') } : {}) })
    expect(screen.getByText(shown)).toBeTruthy()
  })

  it('a rendered first render fills Source and says how many objects', () => {
    const starts = listen<ChartStartDetail>(AUTOPILOT_CHART_START_EVENT)
    mount()
    openStart()
    type('Chart name', 'builder-publish')
    act(() => { screen.getByRole('button', { name: 'Start' }).click() })
    starts.stop()
    const [{ files, id }] = starts.seen
    hold(files, { previewed: true })
    answer({ id, message: null, outcome: 'rendered', payload: renderedPayload(files, [{ kind: 'ConfigMap', name: 'builder-publish-architecture', yaml: 'kind: ConfigMap\n' }]) })
    expect(screen.getByText(/Rendered 1 object — read them in Source/)).toBeTruthy()
    act(() => { screen.getByRole('tab', { name: 'Source' }).click() })
    expect(screen.getByText('builder-publish-architecture')).toBeTruthy()
  })

  it('opens NO drawer along the way — the answer comes on the result bus, never the preview bus', () => {
    const previews = listen(AUTOPILOT_PREVIEW_EVENT)
    const starts = listen<ChartStartDetail>(AUTOPILOT_CHART_START_EVENT)
    mount()
    openStart()
    type('Chart name', 'builder-publish')
    act(() => { screen.getByRole('button', { name: 'Start' }).click() })
    starts.stop()
    hold(seededChart(), { previewed: false })
    act(() => { screen.getByRole('button', { name: /Preview/ }).click() })
    previews.stop()
    expect(previews.seen).toHaveLength(0)
  })
})
