// @vitest-environment jsdom
/**
 * The agent restructuring the held draft — through the SAME kernel as a drag.
 *
 * The property worth pinning is not that a proposal works; it is that a proposal cannot do
 * something a person could not have done by dragging. Both go through planMove/planAdd, so an
 * illegal placement is refused identically and for the same reason.
 */
import { act, cleanup, screen } from '@testing-library/react'
import { load } from 'js-yaml'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { emitComposeRequest, onComposeResult } from '../../components/Autopilot/composeRequest'
import type { ComposeOp, ComposeResult } from '../../components/Autopilot/composeRequest'

import { capture, emit, installAntdShims, mountWithConfig, widgetCr } from './composerTestHarness'

afterEach(cleanup)
beforeAll(installAntdShims)
afterEach(() => {
  vi.unstubAllGlobals()
  installAntdShims()
})

/** Flex page-x > [ Row row-a > [ Card card-b ] ] */
const nested = () => [
  { content: widgetCr('Card', 'card-b'), path: 'templates/card.card-b.yaml' },
  { content: widgetCr('Flex', 'page-x', ['row-a']), path: 'templates/flex.page-x.yaml' },
  { content: widgetCr('Row', 'row-a', ['card-b']), path: 'templates/row.row-a.yaml' },
]

const order = (yaml: string): string[] => {
  const doc = load(yaml) as { spec?: { widgetData?: { items?: { resourceRefId?: string }[] } } }
  return (doc.spec?.widgetData?.items ?? []).map((item) => item.resourceRefId ?? '')
}

let seq = 0

/**
 * Dispatched inside act: the handler sets state, and an unflushed refusal renders nothing.
 *
 * Returns what the composer ANSWERED. The dispatch is synchronous, so a handler that forgets to
 * answer returns null here — which is what every test in this file would have looked like before
 * the result channel existed, and is exactly the silence the agent used to read as success.
 */
const propose = (request: ComposeOp): ComposeResult | null => {
  const answers: ComposeResult[] = []
  const stop = onComposeResult((result) => { answers.push(result) })
  const id = `test-${(seq += 1)}`
  act(() => emitComposeRequest({ ...request, id }))
  stop()
  expect(answers.length, 'the composer answered more than once').toBeLessThan(2)
  if (answers.length === 1) { expect(answers[0].id).toBe(id) }
  return answers[0] ?? null
}

const open = () => {
  mountWithConfig()
  emit({ files: nested(), title: 'x' })
}

describe('the agent restructures the draft through the composer', () => {
  it('MOVES a widget — the same two-file rewrite a drag produces', () => {
    const bus = capture()
    open()
    const answer = propose({ op: 'move', target: 'page-x', widget: 'card-b' })

    expect(bus.log.map((entry) => entry.op)).toEqual(['edit', 'edit'])
    // What it reports having touched is what it touched — the asker can name the files.
    expect(answer).toMatchObject({ applied: true, reason: null })
    expect(answer?.paths.sort()).toEqual(bus.log.map((entry) => entry.path).sort())
    const emitted = Object.fromEntries(bus.log.map((entry) => [entry.path, entry.content]))
    expect(order(emitted['templates/row.row-a.yaml'])).toEqual([])
    expect(order(emitted['templates/flex.page-x.yaml'])).toContain('card-b')
    bus.stop()
  })

  it('places an EXISTING widget without inventing a file', () => {
    const bus = capture()
    open()
    propose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })

    expect(bus.log.map((entry) => entry.op)).toEqual(['edit'])
    expect(order(bus.log[0].content)).toEqual(['row-a', 'fleet-card'])
    bus.stop()
  })

  it('CREATES a container, emitting the file before the parent that references it', () => {
    const bus = capture()
    open()
    const answer = propose({ layout: 'Row', op: 'addContainer', target: 'page-x' })

    expect(bus.log.map((entry) => entry.op)).toEqual(['add', 'edit'])
    expect(bus.log[0].path).toBe('templates/row.page-x-row.yaml')
    expect(answer).toMatchObject({ applied: true, reason: null })
    expect(answer?.paths).toContain('templates/row.page-x-row.yaml')
    bus.stop()
  })

  it('honours the insertion index', () => {
    const bus = capture()
    open()
    propose({ at: 0, name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })
    expect(order(bus.log[0].content)).toEqual(['fleet-card', 'row-a'])
    bus.stop()
  })

  it('CANNOT place what a person could not drag — the container declaration is honoured', () => {
    const bus = capture()
    mountWithConfig()
    // A page that says it holds rows only.
    const rowsOnly = [
      'kind: Flex', 'apiVersion: widgets.templates.krateo.io/v1beta1',
      'metadata:\n  name: page-x\n  namespace: krateo-system',
      'spec:\n  widgetData:', '    allowedResources:\n      - rows',
      '    items: []', '  resourcesRefs:', '    items: []',
    ].join('\n')
    emit({ files: [{ content: rowsOnly, path: 'templates/flex.page-x.yaml' }], title: 'x' })

    const answer = propose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })

    expect(bus.log).toHaveLength(0)
    expect(screen.getByText(/cannot hold a cards/i)).toBeTruthy()
    // The reason is the KERNEL's, not a sentence the bridge made up: a person dragging a card
    // onto a rows-only page is told the same thing, and the agent now has it to reason with.
    expect(answer).toMatchObject({ applied: false, paths: [] })
    expect(answer?.reason).toMatch(/cannot hold a cards/i)
    bus.stop()
  })

  it('says so when the target is not in the draft, rather than failing silently', () => {
    const bus = capture()
    open()
    const answer = propose({ op: 'move', target: 'no-such-container', widget: 'card-b' })
    expect(bus.log).toHaveLength(0)
    expect(screen.getByText(/is not in this draft/i)).toBeTruthy()
    // The asker hears the same sentence the person does, rather than nothing.
    expect(answer).toMatchObject({ applied: false, paths: [] })
    expect(answer?.reason).toMatch(/"no-such-container" is not in this draft/)
    bus.stop()
  })

  it('says so when the WIDGET being moved is not in the draft', () => {
    const bus = capture()
    open()
    const answer = propose({ op: 'move', target: 'page-x', widget: 'no-such-card' })
    expect(bus.log).toHaveLength(0)
    expect(answer).toMatchObject({ applied: false, paths: [] })
    expect(answer?.reason).toMatch(/"no-such-card" is not in this draft/)
    bus.stop()
  })

  it('refuses a layout kind that does not exist instead of coercing it', () => {
    const bus = capture()
    open()
    const answer = propose({ layout: 'Carousel', op: 'addContainer', target: 'page-x' })
    expect(bus.log).toHaveLength(0)
    expect(screen.getByText(/is not a layout kind/i)).toBeTruthy()
    expect(answer).toMatchObject({ applied: false, paths: [] })
    expect(answer?.reason).toMatch(/is not a layout kind/)
    bus.stop()
  })
})
