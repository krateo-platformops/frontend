// @vitest-environment jsdom
/**
 * The canvas is a PROJECTION. These tests exist to catch the one failure that would make every
 * later stage unsafe: the canvas and the draft's bytes disagreeing.
 *
 * So the central case is not "does it render a box" — it is that a file edited BEHIND the canvas
 * (which the Files tab allows at any moment) changes what the canvas shows, because nothing is
 * cached beside the files.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import CanvasPanel from './CanvasPanel'
import { buildObjectTree, flattenTree } from './objectTree'

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
  /**
   * Put a node in the air by PROP, not by faking a gesture.
   *
   * The old tests called `fireEvent.dragStart` because the canvas owned that state. dnd-kit's
   * gestures are pointer sequences jsdom does not meaningfully reproduce, and a simulation good
   * enough to pass would prove the simulation. What these cases are actually about is the
   * highlight — a pure function of "what is in the air" and the legality kernel — so that is what
   * they now supply directly.
   *
   * `roots` is shared with the component deliberately: `legalTargets` compares nodes by REFERENCE,
   * so passing the same tree is the contract, and a test that rebuilt it would silently light
   * nothing up.
   */
  const withAirborne = (files: Record<string, string>, name: string) => {
    const roots = buildObjectTree(files)
    const node = flattenTree(roots).find((candidate) => candidate.name === name)!
    return { airborne: { from: 'canvas' as const, node }, node, roots }
  }

  const frame = (name: string) => screen.getByTestId(`canvas-frame-${name}`)
  const accepts = (name: string) => frame(name).getAttribute('data-accepts') === 'yes'

  it('offers only the containers that will actually take what is in the air', () => {
    const files = draft()
    const { airborne, roots } = withAirborne(files, 'inner')
    render(<CanvasPanel airborne={airborne} files={files} roots={roots} />)
    // Flex and Row are containers that accept cards…
    expect(accepts('page-demo')).toBe(true)
    expect(accepts('row-one')).toBe(true)
    // …a Paragraph is a leaf and never lights up.
    expect(accepts('para-one')).toBe(false)
  })

  it('never offers a container its own subtree — the cycle rule, honoured in the highlight', () => {
    const files = draft()
    const { airborne, roots } = withAirborne(files, 'row-one')
    render(<CanvasPanel airborne={airborne} files={files} roots={roots} />)
    // Dropping row-one into the card it contains would detach the branch from the page.
    expect(accepts('inner')).toBe(false)
    expect(accepts('row-one')).toBe(false)
    // Its ancestor is still a legitimate destination.
    expect(accepts('page-demo')).toBe(true)
  })

  it('honours what each container declares — a rows-only page does not light up for a card', () => {
    const files = { ...draft(), 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['r', 'row-one'], ['p', 'para-one']], false, ['rows']) }
    const { airborne, roots } = withAirborne(files, 'inner')
    render(<CanvasPanel airborne={airborne} files={files} roots={roots} />)
    expect(accepts('row-one')).toBe(true)
    expect(accepts('page-demo')).toBe(false)
  })

  it('says AT REST what a container will hold, not only during a drag', () => {
    // Whether a container is constrained used to be visible only mid-gesture, so "why did that not
    // drop" had no answer you could look up.
    const files = { ...draft(), 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['r', 'row-one'], ['p', 'para-one']], false, ['rows']) }
    render(<CanvasPanel files={files} />)
    expect(frame('page-demo').textContent).toContain('rows only')
    expect(frame('row-one').textContent).not.toContain('only')
  })

  /*
   * MOVABILITY IS NOW READ OFF THE HANDLE, not off a `draggable` attribute.
   *
   * dnd-kit does not use the native attribute at all; it attaches listeners and a set of ARIA
   * attributes to whatever element it is given. That is the point — a bare `draggable` div had
   * role:null and tabindex:null and could not be tabbed to, whereas the handle is a real control.
   * So the assertion moves from "the browser thinks this is draggable" to "this has a grab handle",
   * which is the property a person actually has.
   */
  const handle = (name: string) => screen.getByTestId(`canvas-handle-${name}`)

  it('a page root has no grab handle — nothing places it, so there is no reference to move', () => {
    render(<CanvasPanel files={draft()} />)
    expect(handle('page-demo').getAttribute('aria-roledescription')).toBeNull()
    expect(handle('inner').getAttribute('aria-roledescription')).toBe('draggable')
  })

  it('a widget the draft does not carry has no grab handle — there is no file to rewrite', () => {
    render(<CanvasPanel files={{ 'templates/flex.page-demo.yaml': cr('Flex', 'page-demo', [['g', 'ghost']]) }} />)
    expect(handle('ghost').getAttribute('aria-roledescription')).toBeNull()
  })

  it('the grab handle is KEYBOARD-REACHABLE — the property the old canvas had nowhere', () => {
    // Not one of 80 tab stops used to land in the canvas: every frame was a bare div with
    // role:null, tabindex:null, aria-label:null.
    render(<CanvasPanel files={draft()} />)
    expect(handle('inner').getAttribute('tabindex')).toBe('0')
    expect(handle('inner').getAttribute('role')).toBe('button')
  })
})
