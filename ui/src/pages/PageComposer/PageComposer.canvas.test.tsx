// @vitest-environment jsdom
/**
 * The canvas, mounted.
 *
 * Stages 1–4 built the pieces and tested them in isolation; nothing rendered them. These tests
 * exist for the one thing isolation cannot show: that a drop on the real page reaches the draft.
 *
 * They assert on the WRITE BUS rather than on rendered YAML, because that is the actual contract —
 * the composer never writes files itself. It emits on the same bus the Files tab uses, so a move
 * passes through the draft's byte cap and re-arms the publish gate exactly like a hand edit.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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

const openCanvas = () => {
  fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }))
}

describe('PageComposer — the canvas is wired to the draft', () => {
  it('is offered, but the STRUCTURE tree is still what opens', () => {
    // Mounting a new surface must not silently replace the proven one. The canvas is a tab away.
    mountWithConfig()
    emit({ files: nested(), title: 'x' })
    expect(screen.getByRole('tab', { name: 'Canvas' })).toBeTruthy()
    expect(screen.queryByTestId('canvas-panel')).toBeNull()
  })

  it('A DROP REACHES THE DRAFT — both parents are rewritten on the file-edit bus', () => {
    const bus = capture()
    mountWithConfig()
    emit({ files: nested(), title: 'x' })
    openCanvas()

    fireEvent.dragStart(screen.getByTestId('canvas-frame-card-b'))
    fireEvent.drop(screen.getByTestId('canvas-well-page-x'))

    // Two edits, no adds: a move rewrites the two parents and invents no file.
    expect(bus.log.map((entry) => entry.op)).toEqual(['edit', 'edit'])
    expect(bus.log.map((entry) => entry.path).sort())
      .toEqual(['templates/flex.page-x.yaml', 'templates/row.row-a.yaml'])

    // The card left the row and joined the page — asserted on the bytes that were actually emitted.
    const emitted = Object.fromEntries(bus.log.map((entry) => [entry.path, entry.content]))
    expect(emitted['templates/row.row-a.yaml']).not.toContain('card-b')
    expect(emitted['templates/flex.page-x.yaml']).toContain('card-b')
    bus.stop()
  })

  it('AN UNOFFERED TARGET IS NEVER WRITTEN TO — and never lights up in the first place', () => {
    // A page that declares it holds rows only. Dropping a card on it must not quietly widen that
    // declaration.
    //
    // NOTE ON WHAT THIS DOES *NOT* SHOW. No error message appears here, and that is correct rather
    // than a gap: an unoffered container carries no drop handler at all, so `applyMove` never runs
    // and there is nothing to explain — the absent highlight IS the explanation. The composer's
    // `moveError` Alert covers the other case, where the canvas offered a drop and `planMove` then
    // refused it because the render-time snapshot had gone stale.
    const rowsOnly = [
      'kind: Flex',
      'apiVersion: widgets.templates.krateo.io/v1beta1',
      'metadata:\n  name: page-x\n  namespace: krateo-system',
      'spec:\n  widgetData:',
      '    allowedResources:\n      - rows',
      '    items:\n      - resourceRefId: row-a\n      - resourceRefId: card-b',
      '  resourcesRefs:',
      '    items:\n      - id: row-a\n        name: row-a\n        resource: rows\n        namespace: krateo-system'
        + '\n      - id: card-b\n        name: card-b\n        resource: cards\n        namespace: krateo-system',
    ].join('\n')

    const bus = capture()
    mountWithConfig()
    emit({
      files: [
        { content: widgetCr('Card', 'card-b'), path: 'templates/card.card-b.yaml' },
        { content: rowsOnly, path: 'templates/flex.page-x.yaml' },
        { content: widgetCr('Row', 'row-a'), path: 'templates/row.row-a.yaml' },
      ],
      title: 'x',
    })
    openCanvas()

    // row-a accepts anything (it declares []), so dragging the card there is legal and would write.
    // The page is the one that refuses. Drag onto the page's own well.
    fireEvent.dragStart(screen.getByTestId('canvas-frame-card-b'))
    fireEvent.drop(screen.getByTestId('canvas-well-page-x'))

    // Never offered…
    expect(screen.getByTestId('canvas-frame-page-x').getAttribute('data-accepts')).toBeNull()
    // …so nothing was written, and nothing needed saying.
    expect(bus.log).toHaveLength(0)
    expect(screen.queryByRole('alert')).toBeNull()
    bus.stop()
  })
})

afterAll(cleanup)
