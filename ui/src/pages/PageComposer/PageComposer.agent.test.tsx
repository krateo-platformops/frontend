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

import { emitComposeRequest } from '../../components/Autopilot/composeRequest'
import type { ComposeRequest } from '../../components/Autopilot/composeRequest'

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

/** Dispatched inside act: the handler sets state, and an unflushed refusal renders nothing. */
const propose = (request: ComposeRequest) => {
  act(() => emitComposeRequest(request))
}

const open = () => {
  mountWithConfig()
  emit({ files: nested(), title: 'x' })
}

describe('the agent restructures the draft through the composer', () => {
  it('MOVES a widget — the same two-file rewrite a drag produces', () => {
    const bus = capture()
    open()
    propose({ op: 'move', target: 'page-x', widget: 'card-b' })

    expect(bus.log.map((entry) => entry.op)).toEqual(['edit', 'edit'])
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
    propose({ layout: 'Row', op: 'addContainer', target: 'page-x' })

    expect(bus.log.map((entry) => entry.op)).toEqual(['add', 'edit'])
    expect(bus.log[0].path).toBe('templates/row.page-x-row.yaml')
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

    propose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })

    expect(bus.log).toHaveLength(0)
    expect(screen.getByText(/cannot hold a cards/i)).toBeTruthy()
    bus.stop()
  })

  it('says so when the target is not in the draft, rather than failing silently', () => {
    const bus = capture()
    open()
    propose({ op: 'move', target: 'no-such-container', widget: 'card-b' })
    expect(bus.log).toHaveLength(0)
    expect(screen.getByText(/is not in this draft/i)).toBeTruthy()
    bus.stop()
  })

  it('refuses a layout kind that does not exist instead of coercing it', () => {
    const bus = capture()
    open()
    propose({ layout: 'Carousel', op: 'addContainer', target: 'page-x' })
    expect(bus.log).toHaveLength(0)
    expect(screen.getByText(/is not a layout kind/i)).toBeTruthy()
    bus.stop()
  })
})
