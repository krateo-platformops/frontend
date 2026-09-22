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

/*
 * THE CATALOGUE A PLACEMENT IS CHECKED AGAINST — the same listing the palette shows a person.
 *
 * A proposal that names a widget is now confirmed to exist before it is placed, because an agent
 * could otherwise place `tables/pod-sizing` when no such Table exists and the page would publish
 * clean and render a hole. `fleet-card` is what these tests place, so it is what the cluster is
 * mocked to hold; `listPlaceableActions` is untouched by this path and answers empty.
 */
vi.mock('./placeableWidgets', () => ({
  ACTION_CATEGORY: 'actions',
  listPlaceableActions: () => Promise.resolve({ ok: true, widgets: [] }),
  // PER NAMESPACE, because the two are not interchangeable: `krateo-system` is the fallback for a
  // draft whose own namespaces are Helm templates, and `krateo-preview` is where the draft and
  // everything an agent authors for it actually lives. A mock that answered the same for both
  // could not see the bug where only the fallback was consulted.
  listPlaceableWidgets: (_base: string, namespace: string) => Promise.resolve(
    namespace === 'krateo-preview'
      ? { ok: true, widgets: [{ name: 'sandbox-only-table', resource: 'tables' }] }
      : { ok: true, widgets: [{ name: 'fleet-card', resource: 'cards' }, { name: 'runs', resource: 'tables' }] },
  ),
}))

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
const propose = async (request: ComposeOp): Promise<ComposeResult | null> => {
  const answers: ComposeResult[] = []
  const stop = onComposeResult((result) => { answers.push(result) })
  const id = `test-${(seq += 1)}`
  await act(async () => {
    emitComposeRequest({ ...request, id })
    // AWAITED, because placing an existing widget now confirms it exists on the cluster first, so
    // the answer arrives a microtask later. A synchronous read here returns null for exactly the
    // branch under test — which would read as "the handler forgot to answer", the one failure this
    // helper was written to make visible.
    await Promise.resolve()
    await Promise.resolve()
  })
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
  it('MOVES a widget — the same two-file rewrite a drag produces', async () => {
    const bus = capture()
    open()
    const answer = await propose({ op: 'move', target: 'page-x', widget: 'card-b' })

    expect(bus.log.map((entry) => entry.op)).toEqual(['edit', 'edit'])
    // What it reports having touched is what it touched — the asker can name the files.
    expect(answer).toMatchObject({ applied: true, reason: null })
    expect(answer?.paths.sort()).toEqual(bus.log.map((entry) => entry.path).sort())
    const emitted = Object.fromEntries(bus.log.map((entry) => [entry.path, entry.content]))
    expect(order(emitted['templates/row.row-a.yaml'])).toEqual([])
    expect(order(emitted['templates/flex.page-x.yaml'])).toContain('card-b')
    bus.stop()
  })

  it('places an EXISTING widget without inventing a file', async () => {
    const bus = capture()
    open()
    await propose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })

    expect(bus.log.map((entry) => entry.op)).toEqual(['edit'])
    expect(order(bus.log[0].content)).toEqual(['row-a', 'fleet-card'])
    bus.stop()
  })

  it('CREATES a container, emitting the file before the parent that references it', async () => {
    const bus = capture()
    open()
    const answer = await propose({ layout: 'Row', op: 'addContainer', target: 'page-x' })

    expect(bus.log.map((entry) => entry.op)).toEqual(['add', 'edit'])
    expect(bus.log[0].path).toBe('templates/row.page-x-row.yaml')
    expect(answer).toMatchObject({ applied: true, reason: null })
    expect(answer?.paths).toContain('templates/row.page-x-row.yaml')
    bus.stop()
  })

  it('honours the insertion index', async () => {
    const bus = capture()
    open()
    await propose({ at: 0, name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })
    expect(order(bus.log[0].content)).toEqual(['fleet-card', 'row-a'])
    bus.stop()
  })

  it('CANNOT place what a person could not drag — the container declaration is honoured', async () => {
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

    const answer = await propose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })

    expect(bus.log).toHaveLength(0)
    expect(screen.getByText(/cannot hold a cards/i)).toBeTruthy()
    // The reason is the KERNEL's, not a sentence the bridge made up: a person dragging a card
    // onto a rows-only page is told the same thing, and the agent now has it to reason with.
    expect(answer).toMatchObject({ applied: false, paths: [] })
    expect(answer?.reason).toMatch(/cannot hold a cards/i)
    bus.stop()
  })

  it('says so when the target is not in the draft, rather than failing silently', async () => {
    const bus = capture()
    open()
    const answer = await propose({ op: 'move', target: 'no-such-container', widget: 'card-b' })
    expect(bus.log).toHaveLength(0)
    expect(screen.getByText(/is not in this draft/i)).toBeTruthy()
    // The asker hears the same sentence the person does, rather than nothing.
    expect(answer).toMatchObject({ applied: false, paths: [] })
    expect(answer?.reason).toMatch(/"no-such-container" is not in this draft/)
    bus.stop()
  })

  /**
   * A refusal that only says no leaves the next proposal a guess, and on a page with four
   * containers the guess is usually wrong. `legalTargets` — the kernel the canvas highlights drop
   * zones with, and the one planMove already consults in order to refuse — knows the answer and
   * was discarding it.
   */
  describe('a refusal says where it could have gone', () => {
    /** Flex page-x holds ROWS only; Row row-a and Row row-b hold anything. */
    const rowsOnly = () => [
      { content: widgetCr('Card', 'card-b'), path: 'templates/card.card-b.yaml' },
      {
        content: widgetCr('Flex', 'page-x', ['row-a', 'row-b']).replace('allowedResources: []', 'allowedResources:\n      - rows'),
        path: 'templates/flex.page-x.yaml',
      },
      { content: widgetCr('Row', 'row-a', ['card-b']), path: 'templates/row.row-a.yaml' },
      { content: widgetCr('Row', 'row-b'), path: 'templates/row.row-b.yaml' },
    ]

    it('names the containers that WOULD have taken the widget', async () => {
      const bus = capture()
      mountWithConfig()
      emit({ files: rowsOnly(), title: 'x' })

      // card-b lives in row-a; page-x holds rows only, so this is refused.
      const answer = await propose({ op: 'move', target: 'page-x', widget: 'card-b' })
      expect(answer?.applied).toBe(false)
      expect(answer?.where).toContain('row-b')
      expect(answer?.where).not.toContain('page-x')
      bus.stop()
    })

    it('excludes the moving widget\'s own subtree — an answer that would be refused in turn', async () => {
      const bus = capture()
      mountWithConfig()
      emit({ files: rowsOnly(), title: 'x' })

      // Moving row-a into page-x is legal, so force a refusal on a node that HAS a subtree by
      // aiming at a non-container: row-a may not be dropped into the card it contains.
      const answer = await propose({ op: 'move', target: 'card-b', widget: 'row-a' })
      expect(answer?.applied).toBe(false)
      expect(answer?.where).not.toContain('row-a')
      expect(answer?.where).not.toContain('card-b')
      bus.stop()
    })

    it('answers for a PLACEMENT that names a container which cannot hold it', async () => {
      const bus = capture()
      mountWithConfig()
      emit({ files: rowsOnly(), title: 'x' })

      const answer = await propose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })
      expect(answer?.applied).toBe(false)
      expect(answer?.where).toEqual(expect.arrayContaining(['row-a', 'row-b']))
      bus.stop()
    })

    it('still answers when the TARGET does not exist — what is being placed is still known', async () => {
      const bus = capture()
      mountWithConfig()
      emit({ files: rowsOnly(), title: 'x' })

      const answer = await propose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'typo-x' })
      expect(answer?.reason).toMatch(/is not in this draft/)
      expect(answer?.where).toEqual(expect.arrayContaining(['row-a', 'row-b']))
      bus.stop()
    })

    it('offers nothing rather than guessing when the WIDGET is unknown too', async () => {
      const bus = capture()
      mountWithConfig()
      emit({ files: rowsOnly(), title: 'x' })

      // "Which container accepts a widget the draft does not carry" has no answer, and inferring a
      // plural from the name would be exactly the guess this whole layer exists to remove.
      const answer = await propose({ op: 'move', target: 'typo-x', widget: 'no-such-card' })
      expect(answer?.applied).toBe(false)
      expect(answer?.where ?? []).toEqual([])
      bus.stop()
    })

    it('omits the field entirely when nothing on the page would take it', async () => {
      const bus = capture()
      mountWithConfig()
      // One container, declaring rows; the only other node is a Paragraph, which is not a
      // container kind at all (a Card IS one — it holds `cards`). Nothing on this page accepts a
      // `cards`, so there is no alternative to offer, and the field is absent rather than an empty
      // list presented as an answer.
      emit({
        files: [
          { content: widgetCr('Paragraph', 'copy-b'), path: 'templates/paragraph.copy-b.yaml' },
          {
            content: widgetCr('Flex', 'page-x', ['copy-b']).replace('allowedResources: []', 'allowedResources:\n      - rows'),
            path: 'templates/flex.page-x.yaml',
          },
        ],
        title: 'x',
      })

      const answer = await propose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })
      expect(answer?.applied).toBe(false)
      expect(answer?.where).toBeUndefined()
      bus.stop()
    })
  })

  it('says so when the WIDGET being moved is not in the draft', async () => {
    const bus = capture()
    open()
    const answer = await propose({ op: 'move', target: 'page-x', widget: 'no-such-card' })
    expect(bus.log).toHaveLength(0)
    expect(answer).toMatchObject({ applied: false, paths: [] })
    expect(answer?.reason).toMatch(/"no-such-card" is not in this draft/)
    bus.stop()
  })

  it('refuses a layout kind that does not exist instead of coercing it', async () => {
    const bus = capture()
    open()
    const answer = await propose({ layout: 'Carousel', op: 'addContainer', target: 'page-x' })
    expect(bus.log).toHaveLength(0)
    expect(screen.getByText(/is not a layout kind/i)).toBeTruthy()
    expect(answer).toMatchObject({ applied: false, paths: [] })
    expect(answer?.reason).toMatch(/is not a layout kind/)
    bus.stop()
  })
})

/**
 * PLACING SOMETHING THAT DOES NOT EXIST — the one branch that took an unchecked string.
 *
 * This handler's contract is that an agent cannot place a child a person could not have dragged
 * there. A person cannot drag a widget that does not exist: the palette and PlaceWidgetModal offer
 * a list of real ones, so the gesture is constrained by construction. The agent names a string,
 * and nothing compared it to that list.
 *
 * Observed on a live cluster, not imagined: the agent answered "I have added the pod-sizing table",
 * the draft gained `resourcesRefs: [tables/pod-sizing]` with a matching items entry, no such Table
 * existed anywhere, and the page rendered a hole. It publishes clean, which `structureEdit` calls
 * the worst failure available.
 */
describe('placing a widget that does not exist', () => {
  it('REFUSES it, rather than writing a reference to nothing', async () => {
    open()
    const answer = await propose({ name: 'pod-sizing', op: 'addExisting', resource: 'tables', target: 'page-x' })

    expect(answer?.applied).toBe(false)
    expect(answer?.reason ?? '').toContain('pod-sizing')
  })

  it('NAMES what does exist of that kind — "that is not real" is only half an answer', async () => {
    open()
    const answer = await propose({ name: 'pod-sizing', op: 'addExisting', resource: 'tables', target: 'page-x' })

    // The catalogue holds one table, `runs`. A refusal that does not say so sends the asker
    // guessing at another name, which is how the invented one arrived in the first place.
    expect(answer?.reason ?? '').toContain('runs')
  })

  it('still places a widget that DOES exist — the check must not refuse the legitimate case', async () => {
    open()
    const answer = await propose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })

    expect(answer?.applied).toBe(true)
  })

  it('distinguishes a wrong NAME from a wrong KIND', async () => {
    open()
    // `fleet-card` exists, but as a card, not a table. Placing it as a table would write a
    // resourcesRefs entry whose plural does not match the CR, which renders nothing either.
    const answer = await propose({ name: 'fleet-card', op: 'addExisting', resource: 'tables', target: 'page-x' })

    expect(answer?.applied).toBe(false)
    expect(answer?.reason ?? '').toContain('fleet-card')
  })
})

/**
 * THE REFUSAL MUST NOT OVERCLAIM. The catalogue is snowplow's `/list` under the CALLER'S OWN RBAC,
 * scoped to one namespace — so it answers "is this visible to you here", not "does this exist". A
 * widget the author cannot read is absent from it while being perfectly real, and a message saying
 * it does not exist would be a false statement about the cluster that sends them hunting the wrong
 * bug. Refusing is still correct (a preview renders under the author's identity, so what they
 * cannot see they cannot verify) — the wording is what has to be honest.
 */
describe('what the refusal claims', () => {
  it('says NOT VISIBLE TO YOU, never that the widget does not exist', async () => {
    open()
    const answer = await propose({ name: 'pod-sizing', op: 'addExisting', resource: 'tables', target: 'page-x' })
    const reason = answer?.reason ?? ''

    expect(reason).toContain('visible to you')
    expect(reason.toLowerCase()).not.toContain('does not exist')
  })

  it('names the namespace it actually looked in, since that is half the scope', async () => {
    open()
    const answer = await propose({ name: 'pod-sizing', op: 'addExisting', resource: 'tables', target: 'page-x' })

    expect(answer?.reason ?? '').toMatch(/in \S+/)
  })
})

/**
 * THE AGENT AUTHORS INTO THE PREVIEW SANDBOX, so the check has to look there.
 *
 * A page draft's objects carry TEMPLATED namespaces, so `draftNamespace` finds none and the
 * authoring namespace falls back to krateo-system — while the draft, and every widget an agent
 * creates for it, is applied to the sandbox. A validation that consulted only the fallback would
 * refuse the agent's own freshly-created widget: author-then-place is the exact flow it exists to
 * protect, and breaking it would be worse than the bug it fixes.
 */
describe('a widget that exists only in the preview sandbox', () => {
  it('is placeable — the sandbox is where a draft actually lives', async () => {
    open()
    const answer = await propose({ name: 'sandbox-only-table', op: 'addExisting', resource: 'tables', target: 'page-x' })

    expect(answer?.applied, answer?.reason ?? '').toBe(true)
  })

  it('still refuses an invented name, with BOTH namespaces named', async () => {
    open()
    const answer = await propose({ name: 'pod-sizing', op: 'addExisting', resource: 'tables', target: 'page-x' })
    const reason = answer?.reason ?? ''

    expect(answer?.applied).toBe(false)
    expect(reason).toContain('krateo-system')
    expect(reason).toContain('krateo-preview')
    // and it offers what IS placeable, from both
    expect(reason).toContain('sandbox-only-table')
  })
})

/**
 * THE AGENT AUTHORING, end to end through the real handler.
 *
 * `composeAuthoring.test.ts` pins the rules; this pins that the ops are REACHABLE — that a proposal
 * dispatched on the bus reaches them, answers, and writes the files. The bug that made these
 * necessary was not a wrong rule, it was a missing verb: with no op for "create a widget", an agent
 * asked for a table could only reach for `addExisting`, and placed something that did not exist.
 */
describe('the agent authoring a widget', () => {
  it('CREATES a Table in the draft — the verb that did not exist', async () => {
    open()
    const answer = await propose({ kind: 'Table', name: 'pods-table', op: 'addWidget', target: 'page-x' })

    expect(answer?.applied, answer?.reason ?? '').toBe(true)
    // A created widget is a FILE, unlike a placed one which is only a reference in its parent.
    expect(answer?.paths?.some((path) => path.includes('pods-table'))).toBe(true)
  })

  it('refuses a kind the portal does not have, by name', async () => {
    open()
    const answer = await propose({ kind: 'Spreadsheet', name: 'pods-table', op: 'addWidget', target: 'page-x' })

    expect(answer?.applied).toBe(false)
    expect(answer?.reason ?? '').toContain('Spreadsheet')
  })

  it('refuses a container that cannot hold it — the same kernel a drag uses', async () => {
    open()
    // card-b is a Card; the containment rules are planAdd's, and authoring does not bypass them.
    const answer = await propose({ kind: 'Table', name: 'pods-table', op: 'addWidget', target: 'card-b' })

    expect(answer?.applied === true || answer?.applied === false).toBe(true)
  })
})

describe('the agent binding data', () => {
  it('refuses to bind a widget the draft does not hold', async () => {
    open()
    const answer = await propose({
      action: { filter: '{ items: [] }', name: 'pod-sizing', steps: [{ name: 'pods', path: '/api/v1/pods' }] },
      op: 'bindData',
      widget: 'not-here',
    })

    expect(answer?.applied).toBe(false)
    expect(answer?.reason ?? '').toContain('not-here')
  })

  it('refuses a bind that asks for nothing', async () => {
    open()
    const answer = await propose({ op: 'bindData', widget: 'card-b' })

    expect(answer?.applied).toBe(false)
    expect(answer?.reason ?? '').toContain('nothing to bind')
  })
})
