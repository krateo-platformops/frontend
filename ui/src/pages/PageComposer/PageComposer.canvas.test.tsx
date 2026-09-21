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
import { cleanup, screen } from '@testing-library/react'
import { load } from 'js-yaml'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { capture, emit, installAntdShims, mountWithConfig, widgetCr } from './composerTestHarness'
import { dragOnto, stubLayout } from './dndTestDriver'

afterEach(cleanup)

// The gestures below are real dnd-kit gestures, and dnd-kit decides what you are over by geometry.
// jsdom measures everything as 0x0, so without this every drop would land on nothing and every
// assertion here would pass for the wrong reason.
let restoreLayout: () => void
beforeEach(() => { restoreLayout = stubLayout() })
afterEach(() => restoreLayout())
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

describe('PageComposer — the canvas is wired to the draft', () => {
  it('PALETTE, CANVAS AND TREE ARE ALL MOUNTED AT ONCE — none of them is behind a tab', () => {
    // This replaces an assertion that the canvas sat behind a 'Canvas' tab, opposite a second tab
    // bar. That arrangement was the layout defect. Two reasons none of these three may be a tab:
    // a drag cannot cross a tab boundary, so the palette must share a screen with what it feeds;
    // and the tree is not a view of the canvas but the KEYBOARD route to the same edits, so hiding
    // it would take move/wrap/add/remove away from anyone not using a pointer.
    mountWithConfig()
    emit({ files: nested(), title: 'x' })
    expect(screen.getByTestId('canvas-panel')).toBeTruthy()
    expect(screen.getByTestId('palette-item-Row')).toBeTruthy()
    expect(screen.getByLabelText('Add inside page-x')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Canvas' })).toBeNull()
    // Exactly one tab bar remains on the page — the preview's views of the result.
    expect(document.querySelectorAll('.ant-tabs-nav')).toHaveLength(1)
  })

  it('A DROP REACHES THE DRAFT — both parents are rewritten on the file-edit bus', () => {
    const bus = capture()
    mountWithConfig()
    emit({ files: nested(), title: 'x' })

    dragOnto(screen.getByTestId('canvas-handle-card-b'), screen.getByTestId('canvas-well-page-x'))

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

    // row-a accepts anything (it declares []), so dragging the card there is legal and would write.
    // The page is the one that refuses. Drag onto the page's own well.
    dragOnto(screen.getByTestId('canvas-handle-card-b'), screen.getByTestId('canvas-well-page-x'))

    // Never offered — the highlight still tells the truth before the gesture ends…
    expect(screen.getByTestId('canvas-frame-page-x').getAttribute('data-accepts')).toBeNull()
    // …and nothing is written.
    expect(bus.log).toHaveLength(0)
    // BUT IT IS NO LONGER SILENT, and that is the point of the migration.
    //
    // This assertion used to read `expect(screen.queryByRole('alert')).toBeNull()` — "nothing
    // needed saying". It was describing a limitation as an intention. Under native HTML5 drag the
    // refusal could not be said: `preventDefault` on dragover is what makes an element a drop
    // target, so declining to call it meant `drop` never fired, and the precise reason planAdd and
    // planMove compute died at the browser boundary. The person got an absent highlight among
    // several present ones and no way to ask why.
    //
    // dnd-kit has no such coupling: every container is a droppable, the KERNEL refuses, and the
    // reason it already computed reaches the surface that shows every other outcome.
    const refusal = screen.getByRole('alert')
    expect(refusal.textContent).toContain('page-x')
    expect(refusal.textContent).toMatch(/cannot hold a cards/i)
    bus.stop()
  })
})

afterAll(cleanup)

describe('PageComposer — a drop lands where it was aimed', () => {
  /** Flex page-x > [ row-a, card-b ] — two children, so order is observable. */
  const two = () => [
    { content: widgetCr('Card', 'card-b'), path: 'templates/card.card-b.yaml' },
    { content: widgetCr('Flex', 'page-x', ['row-a', 'card-b']), path: 'templates/flex.page-x.yaml' },
    { content: widgetCr('Row', 'row-a'), path: 'templates/row.row-a.yaml' },
  ]

  const order = (yaml: string): string[] => {
    const doc = load(yaml) as { spec?: { widgetData?: { items?: { resourceRefId?: string }[] } } }
    return (doc.spec?.widgetData?.items ?? []).map((item) => item.resourceRefId ?? '')
  }

  it('REORDERS within one parent — the whole point of the seams', () => {
    // card-b is second. Dropping it in the gap BEFORE row-a must make it first, which is only
    // correct if the index survives the round trip AND the same-parent off-by-one is corrected.
    const bus = capture()
    mountWithConfig()
    emit({ files: two(), title: 'x' })

    dragOnto(screen.getByTestId('canvas-handle-card-b'), screen.getByTestId('canvas-gap-page-x-0'))

    const edited = bus.log.filter((entry) => entry.path === 'templates/flex.page-x.yaml')
    expect(edited).toHaveLength(1)
    expect(order(edited[0].content)).toEqual(['card-b', 'row-a'])
    bus.stop()
  })
})

describe('PageComposer — adding from the palette', () => {
  const nested = () => [
    { content: widgetCr('Card', 'card-b'), path: 'templates/card.card-b.yaml' },
    { content: widgetCr('Flex', 'page-x', ['card-b']), path: 'templates/flex.page-x.yaml' },
  ]

  it('a CONTAINER drop adds the file BEFORE the parent that references it', () => {
    // Order is the property: a parent emitted first momentarily names a file the draft does not
    // carry. planAdd returns the created file separately so this cannot be got backwards.
    const bus = capture()
    mountWithConfig()
    emit({ files: nested(), title: 'x' })

    dragOnto(screen.getByTestId('palette-item-Row'), screen.getByTestId('canvas-well-page-x'))

    expect(bus.log.map((entry) => entry.op)).toEqual(['add', 'edit'])
    expect(bus.log[0].path).toBe('templates/row.page-x-row.yaml')
    expect(bus.log[0].content).toContain('kind: Row')
    expect(bus.log[1].path).toBe('templates/flex.page-x.yaml')
    expect(bus.log[1].content).toContain('page-x-row')
    bus.stop()
  })
})
