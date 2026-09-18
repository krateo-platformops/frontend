// @vitest-environment jsdom
/**
 * The canvas is a PROJECTION. These tests exist to catch the one failure that would make every
 * later stage unsafe: the canvas and the draft's bytes disagreeing.
 *
 * So the central case is not "does it render a box" — it is that a file edited BEHIND the canvas
 * (which the Files tab allows at any moment) changes what the canvas shows, because nothing is
 * cached beside the files.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CanvasPanel from './CanvasPanel'
import type { TreeNode } from './objectTree'

const cr = (kind: string, name: string, children: readonly [string, string][] = [], apiRef = false, allowed?: readonly string[]) => {
  const lines: string[] = [
    `kind: ${kind}`,
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    'metadata:',
    `  name: ${name}`,
    '  namespace: krateo-system',
    'spec:',
  ]
  if (apiRef) {
    lines.push('  apiRef:', '    name: some-restaction', '    namespace: krateo-system')
  }
  lines.push('  widgetData:')
  if (allowed?.length) {
    lines.push('    allowedResources:')
    allowed.forEach((entry) => lines.push(`      - ${entry}`))
  }
  lines.push(children.length ? '    items:' : '    items: []')
  children.forEach(([refId]) => lines.push(`      - resourceRefId: ${refId}`))
  lines.push('  resourcesRefs:')
  lines.push(children.length ? '    items:' : '    items: []')
  children.forEach(([refId, crName]) => {
    lines.push(`      - id: ${refId}`)
    lines.push(`        name: ${crName}`)
    lines.push('        namespace: krateo-system')
    lines.push('        resource: cards')
    lines.push('        verb: GET')
  })
  return lines.join('\n')
}

/** root Flex > [ Row > [ Card ], Paragraph ] */
const draft = () => ({
  'templates/card.inner.yaml': cr('Card', 'inner'),
  'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['r', 'row-one'], ['p', 'para-one']]),
  'templates/paragraph.para-one.yaml': cr('Paragraph', 'para-one'),
  'templates/row.row-one.yaml': cr('Row', 'row-one', [['c', 'inner']]),
})

afterEach(cleanup)

describe('CanvasPanel — the projection', () => {
  it('renders every node of the draft, nested', () => {
    render(<CanvasPanel files={draft()} />)
    for (const name of ['page-demo', 'row-one', 'inner', 'para-one']) {
      expect(screen.getByTestId(`canvas-frame-${name}`)).toBeTruthy()
    }
    // containment, not just presence: the Card frame lives INSIDE the Row's well
    const well = screen.getByTestId('canvas-well-row-one')
    expect(well.contains(screen.getByTestId('canvas-frame-inner'))).toBe(true)
  })

  it('CHANGES when a file changes behind it — nothing is cached beside the bytes', () => {
    // The property the whole stage exists to prove. A person can rewrite any file from the Files
    // tab; if the canvas held its own structure it would go stale silently.
    const files = draft()
    const { rerender } = render(<CanvasPanel files={files} />)
    expect(screen.getByTestId('canvas-well-row-one').contains(screen.getByTestId('canvas-frame-inner'))).toBe(true)

    // Drop the Card's REFERENCE from the Row, as a hand-edit would. The Card's own file still
    // exists, so it does not disappear — it becomes unparented, which is exactly what the draft now
    // says and precisely the kind of thing a cached structure would hide.
    rerender(<CanvasPanel files={{ ...files, 'templates/row.row-one.yaml': cr('Row', 'row-one') }} />)
    expect(screen.getByTestId('canvas-well-row-one').contains(screen.queryByTestId('canvas-frame-inner'))).toBe(false)
    expect(screen.getByTestId('canvas-frame-inner')).toBeTruthy()
    expect(screen.getByTestId('canvas-frame-row-one')).toBeTruthy()
  })

  it('gives containers a well and leaves leaves without one', () => {
    render(<CanvasPanel files={draft()} />)
    expect(screen.getByTestId('canvas-well-page-demo')).toBeTruthy()
    // Paragraph holds nothing and can never take a child — no drop well is offered
    expect(screen.queryByTestId('canvas-well-para-one')).toBeNull()
  })

  it('marks a child the draft does not carry as external', () => {
    // Referenced but no file defines it: an existing cluster widget. It renders, but it has no file
    // to rewrite — which is why canAccept refuses it as a drop target.
    render(<CanvasPanel files={{ 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['g', 'ghost']]) }} />)
    expect(screen.getByTestId('canvas-frame-ghost')).toBeTruthy()
    expect(screen.getByText('external')).toBeTruthy()
  })

  it('marks a data-bound widget', () => {
    render(<CanvasPanel files={{ 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo'), 'templates/table.t.yaml': cr('Table', 'bound-table', [], true) }} />)
    expect(screen.getByText('data')).toBeTruthy()
  })

  it('says so plainly when there is no page root', () => {
    render(<CanvasPanel files={{}} />)
    expect(screen.getByText(/no page root/i)).toBeTruthy()
    expect(screen.queryByTestId('canvas-panel')).toBeNull()
  })

  it('shows an empty container as empty rather than omitting it', () => {
    render(<CanvasPanel files={{ 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo') }} />)
    expect(screen.getByTestId('canvas-well-page-demo')).toBeTruthy()
    expect(screen.getByText('empty')).toBeTruthy()
  })
})

describe('CanvasPanel — dragging', () => {
  const frame = (name: string) => screen.getByTestId(`canvas-frame-${name}`)
  const well = (name: string) => screen.getByTestId(`canvas-well-${name}`)
  const accepts = (name: string) => frame(name).getAttribute('data-accepts') === 'yes'

  it('offers only the containers that will actually take what is in the air', () => {
    render(<CanvasPanel files={draft()} />)
    fireEvent.dragStart(frame('inner'))
    // Flex and Row are containers that accept cards…
    expect(accepts('page-demo')).toBe(true)
    expect(accepts('row-one')).toBe(true)
    // …a Paragraph is a leaf and never lights up.
    expect(accepts('para-one')).toBe(false)
  })

  it('never offers a container its own subtree — the cycle rule, honoured in the highlight', () => {
    render(<CanvasPanel files={draft()} />)
    fireEvent.dragStart(frame('row-one'))
    // Dropping row-one into the card it contains would detach the branch from the page.
    expect(accepts('inner')).toBe(false)
    expect(accepts('row-one')).toBe(false)
    // Its ancestor is still a legitimate destination.
    expect(accepts('page-demo')).toBe(true)
  })

  it('honours what each container declares — a rows-only page does not light up for a card', () => {
    const files = { ...draft(), 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['r', 'row-one'], ['p', 'para-one']], false, ['rows']) }
    render(<CanvasPanel files={files} />)
    fireEvent.dragStart(frame('inner'))
    expect(accepts('row-one')).toBe(true)
    expect(accepts('page-demo')).toBe(false)
  })

  it('reports the completed gesture — which node onto which container', () => {
    const onMove = vi.fn()
    render(<CanvasPanel files={draft()} onMove={onMove} />)
    fireEvent.dragStart(frame('inner'))
    fireEvent.drop(well('page-demo'))
    expect(onMove).toHaveBeenCalledTimes(1)
    const [moving, target] = onMove.mock.calls[0] as [TreeNode, TreeNode]
    expect(moving.name).toBe('inner')
    expect(target.name).toBe('page-demo')
  })

  it('DOES NOT report a drop on a container that cannot accept it', () => {
    // The well carries no drop handler at all when it does not accept, so the browser refuses the
    // gesture before anyone lets go. Asserting the callback is what a consumer actually relies on.
    const onMove = vi.fn()
    const files = { ...draft(), 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['r', 'row-one'], ['p', 'para-one']], false, ['rows']) }
    render(<CanvasPanel files={files} onMove={onMove} />)
    fireEvent.dragStart(frame('inner'))
    fireEvent.drop(well('page-demo'))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('a page root is not draggable — nothing places it, so there is no reference to move', () => {
    render(<CanvasPanel files={draft()} />)
    expect(frame('page-demo').getAttribute('draggable')).toBe('false')
    expect(frame('inner').getAttribute('draggable')).toBe('true')
  })

  it('a widget the draft does not carry is not draggable — there is no file to rewrite', () => {
    render(<CanvasPanel files={{ 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['g', 'ghost']]) }} />)
    expect(frame('ghost').getAttribute('draggable')).toBe('false')
  })

  it('clears the drag when it ends, so nothing stays highlighted', () => {
    render(<CanvasPanel files={draft()} />)
    fireEvent.dragStart(frame('inner'))
    expect(accepts('page-demo')).toBe(true)
    fireEvent.dragEnd(frame('inner'))
    expect(accepts('page-demo')).toBe(false)
  })
})

describe('CanvasPanel — where a drop lands', () => {
  const frame = (name: string) => screen.getByTestId(`canvas-frame-${name}`)
  const gap = (container: string, at: number) => screen.getByTestId(`canvas-gap-${container}-${at}`)

  it('reports the INDEX of the gap it was dropped in, not just the container', () => {
    // Without this a drop can only mean "into this container", which appends — so every move ends
    // up last and reordering is impossible.
    const onMove = vi.fn()
    render(<CanvasPanel files={draft()} onMove={onMove} />)
    fireEvent.dragStart(frame('inner'))
    fireEvent.drop(gap('page-demo', 1))
    expect(onMove).toHaveBeenCalledTimes(1)
    const [moving, target, , at] = onMove.mock.calls[0] as [TreeNode, TreeNode, unknown, number]
    expect(moving.name).toBe('inner')
    expect(target.name).toBe('page-demo')
    expect(at).toBe(1)
  })

  it('offers a gap before the first child and after every one — n children means n+1 seams', () => {
    render(<CanvasPanel files={draft()} />)
    fireEvent.dragStart(frame('inner'))
    // page-demo holds row-one and para-one
    expect(gap('page-demo', 0)).toBeTruthy()
    expect(gap('page-demo', 1)).toBeTruthy()
    expect(gap('page-demo', 2)).toBeTruthy()
    expect(screen.queryByTestId('canvas-gap-page-demo-3')).toBeNull()
  })

  it('a gap in a container that cannot accept the drag does NOT take the drop', () => {
    const onMove = vi.fn()
    const files = { ...draft(), 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['r', 'row-one'], ['p', 'para-one']], false, ['rows']) }
    render(<CanvasPanel files={files} onMove={onMove} />)
    fireEvent.dragStart(frame('inner'))
    fireEvent.drop(gap('page-demo', 1))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('dropping on the WELL still means the end — unchanged', () => {
    const onMove = vi.fn()
    render(<CanvasPanel files={draft()} onMove={onMove} />)
    fireEvent.dragStart(frame('inner'))
    fireEvent.drop(screen.getByTestId('canvas-well-page-demo'))
    const [, , , at] = onMove.mock.calls[0] as [TreeNode, TreeNode, unknown, number | undefined]
    expect(at).toBeUndefined()
  })
})

describe('CanvasPanel — a palette pick', () => {
  const frame = (name: string) => screen.getByTestId(`canvas-frame-${name}`)
  const well = (name: string) => screen.getByTestId(`canvas-well-${name}`)
  const cardPick = { kind: 'existing' as const, name: 'fleet-card', resource: 'cards' }

  it('lights up the containers that will take it, with nothing being dragged', () => {
    render(<CanvasPanel files={draft()} pick={cardPick} />)
    expect(frame('page-demo').getAttribute('data-accepts')).toBe('yes')
    expect(frame('para-one').getAttribute('data-accepts')).toBeNull()
  })

  it('reports an ADD, not a move — they are different operations', () => {
    const onAdd = vi.fn()
    const onMove = vi.fn()
    render(<CanvasPanel files={draft()} onAdd={onAdd} onMove={onMove} pick={cardPick} />)
    fireEvent.drop(well('page-demo'))
    expect(onMove).not.toHaveBeenCalled()
    expect(onAdd).toHaveBeenCalledTimes(1)
    const [target, at, picked] = onAdd.mock.calls[0] as [TreeNode, number | undefined, typeof cardPick]
    expect(target.name).toBe('page-demo')
    expect(at).toBeUndefined()
    expect(picked).toEqual(cardPick)
  })

  it('lands in the gap it was dropped in', () => {
    const onAdd = vi.fn()
    render(<CanvasPanel files={draft()} onAdd={onAdd} pick={cardPick} />)
    fireEvent.drop(screen.getByTestId('canvas-gap-page-demo-1'))
    expect(onAdd.mock.calls[0][1]).toBe(1)
  })

  it('honours the container declaration for a pick too', () => {
    const onAdd = vi.fn()
    const files = { ...draft(), 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['r', 'row-one'], ['p', 'para-one']], false, ['rows']) }
    render(<CanvasPanel files={files} onAdd={onAdd} pick={cardPick} />)
    fireEvent.drop(well('page-demo'))
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('a dragged NODE still wins over a stale pick — a move is not an add', () => {
    const onAdd = vi.fn()
    const onMove = vi.fn()
    render(<CanvasPanel files={draft()} onAdd={onAdd} onMove={onMove} pick={cardPick} />)
    fireEvent.dragStart(frame('inner'))
    fireEvent.drop(well('page-demo'))
    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onAdd).not.toHaveBeenCalled()
  })
})
