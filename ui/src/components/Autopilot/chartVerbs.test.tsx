// @vitest-environment jsdom
/**
 * S5: the agent edits a chart already open in the composer — one file, or one edge — through the
 * same batch bus and edge kernel a person's edits take. Every accepted write disarms publish; every
 * refusal is the chip's text, with the reason a person would get.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { applyPlan, edgeChart } from '../../pages/BlueprintComposer/__fixtures__/s4b'
import { GATE_BEGIN } from '../../pages/BlueprintComposer/gateGen'
import { planEdge } from '../../pages/BlueprintComposer/planEdge'

import { createBlueprintDraftStore, type BlueprintDraftStore } from './blueprintDraftStore'
import { createBlueprintGate } from './blueprintGate'
import { applyChartVerb, readHeldDraft } from './chartVerbs'
import { clearComposeRefusals, getComposeRefusals } from './composeRequest'
import { draftHistory } from './draftHistory'
import { heldDraftIdentity } from './publishCompile'
import { useDraftFileBuses } from './useDraftFileBuses'

afterEach(() => {
  cleanup()
  draftHistory.clear()
  clearComposeRefusals()
})

const LR = 'templates/localresource.yaml'
const PR = 'templates/pullrequest.yaml'
const ARCH = 'templates/architecture.yaml'

/** The provider's buses over a store holding `files`, armed as if Preview had rendered it. */
const mount = (files: Record<string, string> | null, kind: 'blueprint' | 'page' = 'blueprint') => {
  const store: BlueprintDraftStore = createBlueprintDraftStore()
  const gate = createBlueprintGate()
  const Hosted = () => {
    useDraftFileBuses(store, gate, heldDraftIdentity)
    return null
  }
  render(<Hosted />)
  if (files) {
    act(() => { store.set(files, kind) })
    gate.recordPreview(heldDraftIdentity(store.get()))
  }
  return { gate, store }
}

const run = (proposal: Record<string, unknown>) => {
  let label = ''
  act(() => { label = applyChartVerb({ verb: '', ...proposal })?.label ?? '' })
  return label
}

describe('chartPut', () => {
  it('rewrites one file against the bytes held now, and publish needs Preview again', () => {
    const { gate, store } = mount(edgeChart())
    const label = run({ content: 'files: []\n', path: 'values.yaml', verb: 'chartPut' })
    expect(label).toBe('Rewrote values.yaml — Preview needed before it can be published')
    expect(store.get()?.files['values.yaml']).toBe('files: []\n')
    expect(gate.isArmed(heldDraftIdentity(store.get()))).toBe(false)
  })

  it('adds a new file, and says nothing changed when the bytes are the same', () => {
    const { store } = mount(edgeChart())
    expect(run({ content: 'x: 1\n', path: 'templates/extra.yaml', verb: 'chartPut' })).toMatch(/^Added templates\/extra\.yaml/)
    expect(store.get()?.files['templates/extra.yaml']).toBe('x: 1\n')
    expect(run({ content: 'x: 1\n', path: 'templates/extra.yaml', verb: 'chartPut' })).toMatch(/already exactly that/)
  })

  it('keeps a declared edge\'s gate when the agent rewrites the gated template without one', () => {
    const gated = edgeChart()
    const ungated = applyPlan(gated, planEdge(gated, { from: 'pullrequest', op: 'remove', to: 'localresource' }))[PR]
    expect(ungated).not.toContain(GATE_BEGIN)
    const { store } = mount(gated)
    const label = run({ content: `${ungated}# changed by the agent\n`, path: PR, verb: 'chartPut' })
    expect(label).toMatch(/^Rewrote templates\/pullrequest\.yaml/)
    const held = store.get()?.files[PR] ?? ''
    expect(held).toContain(GATE_BEGIN)
    expect(held).toContain('# changed by the agent')
  })

  it('gates an edge declared by rewriting the descriptor, byte for byte as drawing it', () => {
    const gated = edgeChart()
    const bare = applyPlan(gated, planEdge(gated, { from: 'pullrequest', op: 'remove', to: 'localresource' }))
    const { store } = mount(bare)
    const label = run({ content: gated[ARCH], path: ARCH, verb: 'chartPut' })
    expect(label).toBe(`Rewrote ${ARCH} (gates regenerated in ${PR}) — Preview needed before it can be published`)
    expect(store.get()?.files[PR]).toBe(gated[PR])
  })

  it('refuses a path the composer would not key, and the file the portal writes at publish', () => {
    mount(edgeChart())
    expect(run({ content: 'x', path: '../etc/passwd', verb: 'chartPut' })).toMatch(/not a chart-relative path/)
    expect(run({ content: 'x', path: './values.yaml', verb: 'chartPut' })).toMatch(/not a chart-relative path/)
    expect(run({ content: 'x', path: 'compositiondefinition.yaml', verb: 'chartPut' })).toMatch(/the portal writes the registration file/)
    expect(run({ path: 'values.yaml', verb: 'chartPut' })).toMatch(/content must be the whole file/)
  })
})

describe('chartDelete', () => {
  it('deletes a template, and refuses the files a chart cannot do without', () => {
    const files = { ...edgeChart(), 'templates/extra.yaml': 'x: 1\n' }
    const { store } = mount(files)
    expect(run({ path: 'templates/extra.yaml', verb: 'chartDelete' })).toMatch(/^Deleted templates\/extra\.yaml/)
    expect(store.get()?.files['templates/extra.yaml']).toBeUndefined()
    for (const path of ['Chart.yaml', 'values.schema.json', 'templates/architecture.yaml']) {
      expect(run({ path, verb: 'chartDelete' })).toMatch(/cannot be deleted/)
    }
    expect(run({ path: 'templates/nope.yaml', verb: 'chartDelete' })).toMatch(/is not in the chart/)
  })
})

describe('chartLink', () => {
  it('declares an edge exactly as drawing it would — the same descriptor and the same gate', () => {
    const drawn = planEdge(edgeChart(), { from: 'localresource', op: 'add', ready: false, to: 'repository' })
    if (!drawn.ok) { throw new Error(drawn.reason) }
    const expected = applyPlan(edgeChart(), drawn)
    const { store } = mount(edgeChart())
    expect(run({ from: 'localresource', to: 'repository', verb: 'chartLink' })).toMatch(/^localresource now waits for repository to exist/)
    const held = store.get()?.files ?? {}
    expect(held[LR]).toContain(GATE_BEGIN)
    expect(held[LR]).toBe(expected[LR])
  })

  it('refuses an edge a person could not draw, with the kernel\'s reason — a cycle', () => {
    const { store } = mount(edgeChart())
    const before = store.get()
    const label = run({ from: 'localresource', to: 'pullrequest', verb: 'chartLink' })
    expect(label).toMatch(/this portal did not run it/)
    expect(label).toMatch(/cycle/)
    expect(store.get()).toBe(before)
  })

  it('removes an edge with unlink', () => {
    const { store } = mount(edgeChart())
    expect(run({ from: 'pullrequest', to: 'localresource', unlink: true, verb: 'chartLink' })).toMatch(/^Removed pullrequest → localresource/)
    expect(store.get()?.files['templates/architecture.yaml']).not.toMatch(/ref: localresource/)
  })

  it('needs both ends', () => {
    mount(edgeChart())
    expect(run({ from: 'localresource', verb: 'chartLink' })).toMatch(/needs `from`/)
  })
})

describe('what is open', () => {
  it('refuses when no chart is open, and when the open draft is a page', () => {
    mount(null)
    expect(run({ content: 'x', path: 'values.yaml', verb: 'chartPut' })).toMatch(/no chart is open/)
    cleanup()
    mount({ 'Chart.yaml': 'apiVersion: v2\nname: page-x\n', 'templates/flex.page-x.yaml': 'kind: Flex\n' }, 'page')
    expect(run({ content: 'x', path: 'values.yaml', verb: 'chartPut' })).toMatch(/a portal page, not a chart/)
  })

  it('reads the held draft synchronously', () => {
    mount(edgeChart())
    expect(readHeldDraft()?.kind).toBe('blueprint')
  })

  it('is not a chart verb → null', () => {
    expect(applyChartVerb({ verb: 'navigate' })).toBeNull()
  })
})

describe('the model hears how it went — a chip never leaves the browser', () => {
  it('records a refusal for the next turn, and a write that lands clears it', () => {
    mount(edgeChart())
    run({ from: 'localresource', to: 'pullrequest', verb: 'chartLink' })
    expect(getComposeRefusals()).toEqual([{ reason: expect.stringMatching(/cycle/) as string, tried: 'link localresource → pullrequest' }])
    run({ content: 'files: []\n', path: 'values.yaml', verb: 'chartPut' })
    expect(getComposeRefusals()).toBeNull()
  })

  it('refuses content copied from a redacted view, and says why', () => {
    const { store } = mount(edgeChart())
    const before = store.get()
    expect(run({ content: 'token: [redacted-jwt]\n', path: 'values.yaml', verb: 'chartPut' })).toMatch(/"\[redacted\]" marker/)
    expect(store.get()).toBe(before)
    expect(getComposeRefusals()?.[0].tried).toBe('write values.yaml')
  })
})

describe('a reply of chart verbs', () => {
  it('runs every one of them, in order — authoring, like a compose run, not one capped action', async () => {
    const { selectProposalsToRun } = await import('./actionBridge')
    const put = { content: 'x: 1\n', path: 'values.yaml', verb: 'chartPut' }
    const link = { from: 'a', to: 'b', verb: 'chartLink' }
    expect(selectProposalsToRun([], [put, link, { route: '/x', verb: 'navigate' }] as never)).toEqual([put, link])
  })
})
