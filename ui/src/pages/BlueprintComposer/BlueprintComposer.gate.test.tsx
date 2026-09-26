// @vitest-environment jsdom
/**
 * Screen 7 — the generated gate: Accept writes the descriptor AND the dependent's template in one
 * batch, answered by the provider's REAL draft hooks; the canvas says what happened, Chart files opens
 * the template with its gate lit, and — like every write to a chart — Publish is off until Preview.
 * Every other change to an edge goes through the same kernel, one batch and one Undo step each.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { lintBlueprintDraft } from '../../components/Autopilot/blueprintDraft'
import { draftHistory } from '../../components/Autopilot/draftHistory'
import { AUTOPILOT_PREVIEW_FILES_BATCH_EVENT, type FilesBatchDetail } from '../../components/Autopilot/previewFilesBatch'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'
import { invalidateAccessTokenCache } from '../../utils/getAccessToken'

import { CRDS, PALETTE_STATUS } from './__fixtures__/s4a'
import { applyPlan, edgeChart, gatedGolden, nodeIn } from './__fixtures__/s4b'
import { ARCHITECTURE_TEMPLATE_PATH } from './architecture'
import { GATE_CAPTION } from './BlueprintComposer'
import { installAntdShims, installScrollShim, listen, mountWithProvider, routeFetch, scrolled, type HeldProvider } from './blueprintTestHarness'
import { GATE_BEGIN, GATE_END } from './gateGen'
import { planEdge } from './planEdge'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

beforeAll(() => {
  installAntdShims()
  installScrollShim()
})
beforeEach(() => {
  graphDouble.reset()
  draftHistory.clear()
  scrolled.mockClear()
  invalidateAccessTokenCache()
  localStorage.setItem('K_user', JSON.stringify({ accessToken: 'tok-admin' }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  invalidateAccessTokenCache()
  draftHistory.clear()
})

const start = async (files: Record<string, string> = edgeChart()): Promise<HeldProvider> => {
  routeFetch({
    'name=blueprint-palette': { body: { status: PALETTE_STATUS }, status: 200 },
    ...Object.fromEntries(Object.entries(CRDS).map(([name, crd]) => [`name=${name}`, { body: crd, status: 200 }])),
  })
  const provider = mountWithProvider()
  act(() => { provider.store.set(files, 'blueprint') })
  act(() => { provider.gate.recordPreview('orders') })
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Add' })).getByText('72 kinds · 4 groups')).toBeTruthy())
  return provider
}

/** Let every pending promise, the pointerup microtask, and the renders they cause land. */
const settle = () => act(async () => {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
})
const held = (provider: HeldProvider): Record<string, string> => provider.store.get()?.files ?? {}
const inspector = () => screen.getByLabelText('Inspector')
const card = (id: string) => screen.getByTestId(`node-card-${id}`)
const publish = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Publish' })

/** Screen 6 to 7: the drag, the pending edge (default_branch preselected once the CRD is read), Accept. */
const acceptScreen07 = async () => {
  act(() => { graphDouble.drawEdge('localresource', 'repository') })
  await settle()
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>('radio', { name: /\.status\.default_branch/ }).checked).toBe(true))
  act(() => { screen.getByRole('button', { name: 'Accept edge' }).click() })
  await settle()
}

/** The drag and the pending edge, without accepting — for a chart where Accept is refused. */
const acceptScreenAttempt = async () => {
  act(() => { graphDouble.drawEdge('localresource', 'repository') })
  await settle()
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>('radio', { name: /\.status\.default_branch/ }).checked).toBe(true))
}

describe('BlueprintComposer — the generated gate (screen 7)', () => {
  it('1. Accept emits ONE batch: the descriptor (ready: true; the target\'s readyWhen) and the dependent\'s template, golden', async () => {
    const provider = await start()
    const before = held(provider)
    const batches = listen<FilesBatchDetail>(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT)
    await acceptScreen07()
    batches.stop()
    expect(batches.seen).toHaveLength(1)
    expect(batches.seen[0].kind).toBe('blueprint')
    expect(Object.keys(batches.seen[0].edit ?? {}).sort()).toEqual([ARCHITECTURE_TEMPLATE_PATH, 'templates/localresource.yaml'])
    expect(batches.seen[0].expect).toEqual({ [ARCHITECTURE_TEMPLATE_PATH]: before[ARCHITECTURE_TEMPLATE_PATH], 'templates/localresource.yaml': before['templates/localresource.yaml'] })
    const after = held(provider)
    expect(after['templates/localresource.yaml']).toBe(gatedGolden('localresource'))
    expect(nodeIn(after, 'localresource').dependsOn).toEqual([{ ready: true, ref: 'repository' }])
    expect(nodeIn(after, 'repository').readyWhen).toBe('.status.default_branch')
    // The chart the provider holds is clean under every rule: the graph block the store regenerated
    // carries the edge, and every node is still named as its template names its object (S11).
    expect(lintBlueprintDraft(after, 'blueprint')).toEqual([])
  })

  it('2. the canvas says "Edge accepted", and a NEUTRAL count of what was rewritten', async () => {
    await start()
    await acceptScreen07()
    const head = within(screen.getByLabelText('Architecture'))
    expect(head.getByText('Edge accepted')).toBeTruthy()
    const pill = head.getByText('2 files rewritten')
    // A count pill, not a status: no success colour (exception-only indicators, D7).
    expect(pill.className).toMatch(/countPill/)
    expect(head.queryByText(/^Drawing: /)).toBeNull()
  })

  it('3. What just happened: the dependent\'s entry as it is now, a sentence per template, the note on hand-written gates', async () => {
    await start()
    await acceptScreen07()
    const pane = screen.getByTestId('what-just-happened')
    expect(pane.querySelector('pre')?.textContent).toBe([
      '- id: localresource',
      '  class: custom',
      '  apiVersion: git.krateo.io/v1alpha1',
      '  kind: LocalResource',
      '  template: templates/localresource.yaml',
      '  name: printf "%s-i%d" (printf "%s-localresource" $.Release.Name | trunc 55 | trimSuffix "-") (int $i)',
      '  forEach: .Values.files',
      '  dependsOn:',
      '    - ref: repository',
      '      ready: true',
      '',
    ].join('\n'))
    expect(within(pane).getByText('templates/localresource.yaml')).toBeTruthy()
    expect(within(pane).getByText('Wrapped in a krateo:gate block: a lookup on the Repository, guarded on status.default_branch. Regenerated whenever the edge changes; deleted when the edge is.')).toBeTruthy()
    expect(pane.textContent).toContain('A hand-written lookup outside a marked block is left alone and flagged in the Source tab as an unmanaged gate')
  })

  it('4. Chart files opens the dependent\'s template with its gate lit, and says whose the block is', async () => {
    await start()
    scrolled.mockClear()
    await acceptScreen07()
    await waitFor(() => expect(scrolled).toHaveBeenCalled())
    expect(screen.getByTestId('gate-caption').textContent).toBe('Generated from templates/architecture.yaml — edit the descriptor, not this block.')
    expect(GATE_CAPTION).toBe(screen.getByTestId('gate-caption').textContent)
    const lit = [...document.querySelectorAll('[data-gate="true"]')].map((line) => line.textContent?.replace(/^\d+/, '').trimEnd())
    expect(lit[0]).toBe(GATE_BEGIN)
    expect(lit).toContain('{{- if $gate }}')
    expect(lit.slice(-2)).toEqual(['{{- end }}', GATE_END])
    expect(lit.some((line) => line?.includes('kind: LocalResource'))).toBe(false)
  })

  it('5. Publish is off and Preview is needed — the chart changed (S3 decision 2)', async () => {
    await start()
    expect(publish().disabled).toBe(false)
    await acceptScreen07()
    expect(screen.getByText('Preview needed')).toBeTruthy()
    expect(publish().disabled).toBe(true)
  })

  it('6. switching readiness off in the inspector: one batch, and the gate checks only that it exists', async () => {
    const provider = await start()
    await acceptScreen07()
    act(() => { card('localresource').click() })
    const batches = listen<FilesBatchDetail>(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT)
    act(() => { fireEvent.click(within(inspector()).getByRole('switch', { name: 'Wait for repository to be ready' })) })
    batches.stop()
    expect(batches.seen).toHaveLength(1)
    const after = held(provider)
    expect(nodeIn(after, 'localresource').dependsOn).toEqual([{ ref: 'repository' }])
    expect(after['templates/localresource.yaml']).toContain('{{- if not $dep0 -}}{{- $gate = false -}}{{- end -}}')
    expect(after['templates/localresource.yaml']).not.toContain('default_branch')
  })

  it('7. removing the dependency gives back the template, byte for byte', async () => {
    const provider = await start()
    const before = held(provider)['templates/localresource.yaml']
    await acceptScreen07()
    act(() => { card('localresource').click() })
    act(() => { within(inspector()).getByRole('button', { name: 'Remove the dependency on repository' }).click() })
    expect(held(provider)['templates/localresource.yaml']).toBe(before)
    expect(nodeIn(held(provider), 'localresource').dependsOn).toBeUndefined()
  })

  it('8. on builder-publish\'s own hand-written gates: the edge is refused, and the Source tab lists them', async () => {
    const fixture = readFileSync(join(__dirname, '__fixtures__', 'builder-publish', 'templates', 'localresources.yaml'), 'utf8')
    const provider = await start({ ...edgeChart(), 'templates/localresource.yaml': fixture })
    const before = held(provider)
    await acceptScreenAttempt()
    const box = within(screen.getByTestId('edge-inspector')).getByRole('alert')
    expect(box.textContent).toBe('templates/localresource.yaml already gates itself with a hand-written lookup (line 41), so the composer will not add a second gate there. Nothing was written.')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Accept edge' }).disabled).toBe(true)
    expect(held(provider)).toBe(before)
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Source' })) })
    const notes = [...screen.getByText('Unmanaged gates').closest('.ant-alert')?.querySelectorAll('li') ?? []].map((item) => item.textContent)
    expect(notes).toEqual([41, 58, 86, 139, 167, 168].map((line) =>
      `Unmanaged gate — templates/localresource.yaml:${line}: a lookup outside a krateo:gate block. The composer leaves it alone; describe it in templates/architecture.yaml to manage it.`))
  })

  it('9. ONE Undo restores both files', async () => {
    const provider = await start()
    const before = held(provider)
    await acceptScreen07()
    expect(draftHistory.depth()).toBe(1)
    act(() => { screen.getByRole('button', { name: 'Undo' }).click() })
    await settle()
    expect(held(provider)[ARCHITECTURE_TEMPLATE_PATH]).toBe(before[ARCHITECTURE_TEMPLATE_PATH])
    expect(held(provider)['templates/localresource.yaml']).toBe(before['templates/localresource.yaml'])
    // …and the account of the edge goes with it.
    expect(screen.queryByTestId('what-just-happened')).toBeNull()
  })

  it('a node\'s own Ready when (the inspector): picked from its CRD, and every dependent waiting on it re-gated in one batch', async () => {
    const files = edgeChart()
    const provider = await start(applyPlan(files, planEdge(files, { from: 'localresource', op: 'add', ready: true, readyWhen: '.status.default_branch', to: 'repository' })))
    act(() => { card('repository').click() })
    const select = within(inspector()).getByLabelText('Ready when').closest('.ant-select') as HTMLElement
    await waitFor(() => expect(select.textContent).toBe('.status.default_branch'))
    await act(async () => {
      fireEvent.mouseDown(select.querySelector('.ant-select-content') as HTMLElement)
      await Promise.resolve()
    })
    const batches = listen<FilesBatchDetail>(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT)
    act(() => { fireEvent.click([...document.querySelectorAll<HTMLElement>('.ant-select-item-option')].find((option) => option.textContent === '.status.html_url') as HTMLElement) })
    batches.stop()
    expect(batches.seen).toHaveLength(1)
    expect(Object.keys(batches.seen[0].edit ?? {}).sort()).toEqual([ARCHITECTURE_TEMPLATE_PATH, 'templates/localresource.yaml'])
    expect(nodeIn(held(provider), 'repository').readyWhen).toBe('.status.html_url')
    expect(held(provider)['templates/localresource.yaml']).toContain('dig "status" "html_url" "" $dep0')
  })

  it('Remove from chart (D19): the node, its template and every edge onto it — its dependent ungated — in one batch', async () => {
    const files = edgeChart()
    const waited = applyPlan(files, planEdge(files, { from: 'localresource', op: 'add', ready: true, readyWhen: '.status.default_branch', to: 'repository' }))
    const provider = await start(waited)
    act(() => { card('repository').click() })
    act(() => { within(inspector()).getByRole('button', { name: 'Remove from chart' }).click() })
    const batches = listen<FilesBatchDetail>(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT)
    act(() => { screen.getByRole('button', { name: 'Remove' }).click() })
    batches.stop()
    expect(batches.seen).toHaveLength(1)
    expect(batches.seen[0].remove).toEqual(['templates/repository.yaml'])
    const after = held(provider)
    expect(after['templates/repository.yaml']).toBeUndefined()
    expect(after['templates/localresource.yaml']).toBe(files['templates/localresource.yaml'])
    expect(screen.queryByTestId('node-card-repository')).toBeNull()
    expect(lintBlueprintDraft(after, 'blueprint')).toEqual([])
  })
})
