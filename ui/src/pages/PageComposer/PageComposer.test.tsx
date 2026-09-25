// @vitest-environment jsdom
/**
 * The DRAFT LIFECYCLE: opening one, starting one, owning it, publishing it, closing it.
 *
 * The point of these is the UN-COUPLING, not the markup. Before this change the preview surface —
 * live render, per-file editor, RestDefinition editor — was the body of `AutopilotPreviewDrawer`,
 * which `AutopilotProvider` renders, and was therefore reachable ONLY through the Autopilot rail as
 * something the agent opens. What is asserted here is that the same surface now renders outside the
 * provider, from the same bus, with no rail present — and that a PERSON can start and ship a draft.
 *
 * The tree and what it does to a draft live in PageComposer.tree.test.tsx.
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AUTOPILOT_PREVIEW_EVENT } from '../../components/Autopilot/previewBus'
import { emitDraftChanged, previewSurfaceClaimed } from '../../components/Autopilot/previewDraftChanged'
import { emitDraftClose, onDraftClose } from '../../components/Autopilot/previewDraftClose'
import { AUTOPILOT_DRAFT_START_EVENT } from '../../components/Autopilot/previewDraftStart'
import type { DraftStartDetail } from '../../components/Autopilot/previewDraftStart'
import { AUTOPILOT_PUBLISH_REQUEST_EVENT, emitPublishResult } from '../../components/Autopilot/previewPublishRequest'
import type { PublishRequestDetail } from '../../components/Autopilot/previewPublishRequest'

import { emit, installAntdShims, mount, widgetCr } from './composerTestHarness'

afterEach(cleanup)
beforeAll(installAntdShims)

describe('PageComposer — the preview surface, outside the rail', () => {
  it('renders with NO AutopilotProvider around it', () => {
    // The whole un-coupling in one assertion: this component is mounted bare. Before the split it
    // could not be — the surface lived inside the provider's subtree.
    expect(() => mount()).not.toThrow()
  })

  it('says nothing is open rather than rendering an empty canvas', () => {
    mount()

    // An empty page that looks like a failed load is the failure mode being avoided here.
    expect(screen.getByText(/No draft open/i)).toBeTruthy()
  })

  it('PARKS a blueprint draft instead of drawing a chart as a page', () => {
    // With a chart held — previewed in the rail, then a navigation here — this composer used to run
    // its object tree over Chart.yaml and templates and draw nonsense. The broadcast says who holds
    // the draft; a blueprint gets an honest empty state and no canvas.
    mount()
    emit({ files: [{ content: 'apiVersion: v2\nname: nginx-demo\n', path: 'Chart.yaml' }], title: 'nginx-demo' })
    act(() => emitDraftChanged({ files: { 'Chart.yaml': 'apiVersion: v2\nname: nginx-demo\n' }, kind: 'blueprint' }))

    expect(screen.getByText(/A blueprint draft is open in this thread/i)).toBeTruthy()
    expect(screen.queryByText('Objects')).toBeNull()
    expect(screen.queryByRole('button', { name: /Start a page/i })).toBeNull()
  })

  it('hides the page controls while parked — Publish here would publish the chart as a page', () => {
    mount()
    emit({ files: [{ content: widgetCr('Flex', 'page-x'), path: 'flex.page-x.yaml' }], title: 'x' })
    expect(screen.getByText('Publish')).toBeTruthy()
    act(() => emitDraftChanged({ files: { 'Chart.yaml': 'x' }, kind: 'blueprint' }))
    expect(screen.queryByText('Publish')).toBeNull()
    expect(screen.queryByText('Undo')).toBeNull()
    expect(screen.queryByText('Close draft')).toBeNull()
  })

  it('offers a REAL discard of the parked chart — the provider drops it, not just this view', () => {
    const closes = vi.fn()
    const stop = onDraftClose(closes)
    mount()
    act(() => emitDraftChanged({ files: { 'Chart.yaml': 'x' }, kind: 'blueprint' }))
    act(() => { screen.getByText('Discard blueprint draft').click() })
    act(() => { screen.getByText('Discard').click() })
    stop()
    expect(closes).toHaveBeenCalledTimes(1)
  })

  it('does not adopt a chart, RestDefinition or inspection preview — the drawer shows those', () => {
    mount()
    act(() => {
      window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_EVENT, { detail: { builder: 'blueprint', summary: ['nginx-demo-rendered'], title: 'Blueprint preview — nginx-demo' } }))
    })
    expect(screen.queryByText('nginx-demo-rendered')).toBeNull()
    expect(screen.getByText(/No draft open/i)).toBeTruthy()
  })

  it('SHOWS a page draft held from before it mounted, instead of "No draft open" over it', () => {
    // The draft reaches a late-mounted composer by replay — files, no payload. It used to say "No
    // draft open" and offer a Start the provider silently refused, with no way to discard.
    mount()
    act(() => emitDraftChanged({ files: { 'templates/flex.page-x.yaml': widgetCr('Flex', 'page-x') }, kind: 'page' }))
    expect(screen.queryByText(/No draft open/i)).toBeNull()
    expect(screen.getByText(/The held draft, shown from its files/i)).toBeTruthy()
    const closes = vi.fn()
    const stop = onDraftClose(closes)
    act(() => { screen.getByText('Close draft').click() })
    act(() => { screen.getByText('Discard').click() })
    stop()
    expect(closes).toHaveBeenCalledTimes(1)
  })

  it('drops its render when the draft is discarded ELSEWHERE — a re-apply landing late re-announces it', () => {
    const onClose = vi.fn()
    mount()
    emit({ files: [{ content: widgetCr('Flex', 'page-x'), path: 'flex.page-x.yaml' }], onClose, title: 'x' })
    act(() => { emitDraftClose() })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/No draft open/i)).toBeTruthy()
  })

  it('drops a render it adopted in the SAME tick as the discard — before it was ever drawn', () => {
    const onClose = vi.fn()
    mount()
    act(() => {
      window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_EVENT, { detail: { onClose, summary: ['flex.page-x'], title: 'x' } }))
      emitDraftClose()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/No draft open/i)).toBeTruthy()
  })

  it('un-parks when the held draft becomes a page again', () => {
    mount()
    act(() => emitDraftChanged({ files: { 'Chart.yaml': 'x' }, kind: 'blueprint' }))
    expect(screen.getByText(/A blueprint draft is open/i)).toBeTruthy()
    act(() => emitDraftChanged({ files: {}, kind: null }))
    expect(screen.queryByText(/A blueprint draft is open/i)).toBeNull()
    expect(screen.getByText(/No draft open/i)).toBeTruthy()
  })

  it('picks up a draft from the SAME bus Autopilot proposes on', () => {
    mount()
    emit({ summary: ['flex.page-fleet-health', 'table.fleet-failing'], title: 'Fleet health' })

    // One draft, two doors: a preview the agent proposes while this page is open lands here too.
    // A second bus would be a second source of truth about what is being authored.
    expect(screen.queryByText(/No draft open/i)).toBeNull()
    expect(screen.getByText('flex.page-fleet-health')).toBeTruthy()
  })

  it('shows the files a publish would commit, each under its repo path', () => {
    mount()
    // The SURFACE renders the payload, which carries repo DESTINATIONS — that is what a reviewer
    // needs to see before approving a change request. The tree, below, speaks held keys instead;
    // the two vocabularies are separate on purpose and `updateDisplayedFile` bridges them.
    emit({
      files: [{ content: 'kind: Flex\n', path: 'helm/portal/templates/flex.page-x.yaml' }],
      title: 'x',
    })

    expect(screen.getByText('helm/portal/templates/flex.page-x.yaml')).toBeTruthy()
  })

  it('surfaces validation problems rather than letting a bad draft look publishable', () => {
    mount()
    emit({ problems: ['spec.widgetData.actions: unknown field'], title: 'x' })

    expect(screen.getByText(/publishing this draft would be rejected/i)).toBeTruthy()
  })

  it('replaces the draft when a new preview arrives, and drops the previous verdicts', () => {
    mount()
    emit({ problems: ['first draft was broken'], title: 'first' })
    expect(screen.getByText('first draft was broken')).toBeTruthy()

    emit({ summary: ['second draft'], title: 'second' })
    // Carrying the old verdicts forward would report the PREVIOUS draft's errors against the
    // current one — the under-reporting shape that made the Autopilot review mark wrong.
    expect(screen.queryByText('first draft was broken')).toBeNull()
    expect(screen.getByText('second draft')).toBeTruthy()
  })
})

describe('PageComposer — a person starts the draft', () => {
  it('states the publish guarantee ONCE, not in two paragraphs that say the same thing', () => {
    // It used to read "...you review every file before it is published" in the description and
    // "...nothing is published until you submit the change request yourself" in a second paragraph
    // under the button — the same promise, restated, in an empty state whose whole job is to be
    // short. Design rule P16: say what to do next, do not fill space.
    mount()
    const published = screen.getAllByText(/before anything is published|until you submit/i)
    expect(published).toHaveLength(1)
  })

  it('routes the empty state through the SHARED empty treatment (C14), not a hand-rolled one', () => {
    // The page hand-rolled its own <Empty> because the shared component had no action slot and
    // this state needs a "Start a page" button. The slot was added instead, so a future change to
    // the empty treatment reaches this page too — which is the whole point of the rule.
    mount()
    const empty = document.querySelector('.ant-empty')
    expect(empty).toBeTruthy()
    // The CTA lives INSIDE the empty state, not stranded beside it.
    expect(empty?.querySelector('button')?.textContent).toContain('Start a page')
  })

  it('offers Start a page rather than only waiting for the agent', () => {
    mount()

    // The button shipped DISABLED, with a note saying start-a-page landed next. Until it did, the
    // surface built to let a human author a page could only ever receive Autopilot's — which
    // inverts the parity rule it was built to satisfy.
    const button = screen.getByText('Start a page').closest('button')
    expect(button).toBeTruthy()
    expect(button?.disabled).toBe(false)
  })

  it('emits the seed on the start bus, root first', () => {
    const seen: DraftStartDetail[] = []
    const listener = (event: Event) => { seen.push((event as CustomEvent<DraftStartDetail>).detail) }
    window.addEventListener(AUTOPILOT_DRAFT_START_EVENT, listener)

    mount()
    act(() => { screen.getByText('Start a page').click() })
    act(() => {
      fireEvent.change(screen.getByPlaceholderText('fleet-health'), { target: { value: 'fleet-health' } })
    })
    act(() => { screen.getByText('Start').click() })
    window.removeEventListener(AUTOPILOT_DRAFT_START_EVENT, listener)

    // Raw CRs, not YAML: the provider routes them through `recordPagePreview`, the SAME entry an
    // agent-proposed page takes, so the two are indistinguishable downstream.
    expect(seen).toHaveLength(1)
    const [root, header] = seen[0].widgets as { kind: string; metadata: { name: string } }[]
    expect(root.kind).toBe('Flex')
    expect(root.metadata.name).toBe('page-fleet-health')
    expect(header.kind).toBe('PageHeader')
  })

  it('refuses a bad slug in the form rather than seeding an unpublishable draft', () => {
    const seen: unknown[] = []
    const listener = (event: Event) => { seen.push(event) }
    window.addEventListener(AUTOPILOT_DRAFT_START_EVENT, listener)

    mount()
    act(() => { screen.getByText('Start a page').click() })
    act(() => {
      fireEvent.change(screen.getByPlaceholderText('fleet-health'), { target: { value: 'Fleet Health' } })
    })
    act(() => { screen.getByText('Start').click() })
    window.removeEventListener(AUTOPILOT_DRAFT_START_EVENT, listener)

    expect(seen).toHaveLength(0)
    // Scoped to the Alert: the field's own help text also says "lower-case", and matching that
    // would pass whether or not the form actually refused anything.
    expect(screen.getByText(/the slug must be lower-case/i)).toBeTruthy()
  })
})

describe('PageComposer — publishing without leaving the page', () => {
  const openDraft = () => {
    mount()
    emit({ files: [{ content: widgetCr('Flex', 'page-x'), path: 'flex.page-x.yaml' }], title: 'x' })
  }

  it('asks the provider to publish, rather than sending the author to the chat rail', () => {
    const seen: PublishRequestDetail[] = []
    const listener = (event: Event) => { seen.push((event as CustomEvent<PublishRequestDetail>).detail) }
    window.addEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)

    openDraft()
    act(() => { screen.getByText('Publish').click() })
    window.removeEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)

    // The provider runs the SAME runDraftPublish the agent's verb takes — one destination form,
    // one gate, one cap. Until now the only way to ship a draft authored here was to ask the agent.
    expect(seen).toHaveLength(1)
    expect(seen[0].verb).toBe('publishPage')
    expect(seen[0].id).toBeTruthy()
  })

  it('offers no Publish with no draft — there is nothing to ship', () => {
    mount()

    expect(screen.queryByText('Publish')).toBeNull()
  })

  it('shows the change request on its own page when the publish lands', () => {
    let id = ''
    const listener = (event: Event) => { id = (event as CustomEvent<PublishRequestDetail>).detail.id }
    window.addEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)
    openDraft()
    act(() => { screen.getByText('Publish').click() })
    window.removeEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)

    act(() => { emitPublishResult({ deepLink: 'https://example.invalid/compare/x', denial: null, id }) })

    expect(screen.getByText(/change request is open/i)).toBeTruthy()
    expect(screen.getByText('Open change request').closest('a')?.href).toContain('example.invalid')
  })

  it('shows a refusal as a refusal, not as success', () => {
    let id = ''
    const listener = (event: Event) => { id = (event as CustomEvent<PublishRequestDetail>).detail.id }
    window.addEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)
    openDraft()
    act(() => { screen.getByText('Publish').click() })
    window.removeEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)

    act(() => { emitPublishResult({ deepLink: null, denial: 'publish cancelled — destination not confirmed', id }) })

    expect(screen.getByText(/destination not confirmed/i)).toBeTruthy()
  })

  it('ignores another surface’s publish result', () => {
    openDraft()
    act(() => { screen.getByText('Publish').click() })

    act(() => { emitPublishResult({ deepLink: null, denial: 'not ours', id: 'someone-else' }) })

    // Two surfaces can be open on one draft; answering to a correlation id is what keeps a drawer's
    // outcome from being reported as this page's.
    expect(screen.queryByText('not ours')).toBeNull()
    expect(screen.getByText('Publishing…')).toBeTruthy()
  })
})

describe('PageComposer — one surface owns the draft', () => {
  it('claims the preview while mounted, so the drawer does not open over it', () => {
    expect(previewSurfaceClaimed('page')).toBe(false)
    const view = mount()

    // Both listen on the same bus. Two surfaces on one draft is not merely redundant: the drawer's
    // close fires the sandbox teardown, which DELETEs the draft CRs this page is still rendering.
    expect(previewSurfaceClaimed('page')).toBe(true)
    view.unmount()
    expect(previewSurfaceClaimed('page')).toBe(false)
  })

  it('fires the sandbox teardown on close — the lifecycle the drawer used to own', () => {
    const onClose = vi.fn()
    const closes = vi.fn()
    const stop = onDraftClose(closes)
    mount()
    emit({ files: [{ content: widgetCr('Flex', 'page-x'), path: 'flex.page-x.yaml' }], onClose, title: 'x' })

    act(() => { screen.getByText('Close draft').click() })
    act(() => { screen.getByText('Discard').click() })

    // Without this the sandbox CRs outlive every surface that could render them.
    expect(onClose).toHaveBeenCalledTimes(1)
    // …and the held draft itself is dropped, or every later "Start a page" is refused.
    expect(closes).toHaveBeenCalledTimes(1)
    stop()
    expect(screen.getByText(/No draft open/i)).toBeTruthy()
  })
})
