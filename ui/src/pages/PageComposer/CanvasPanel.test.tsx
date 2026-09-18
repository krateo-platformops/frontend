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

const cr = (kind: string, name: string, children: readonly [string, string][] = [], apiRef = false) => {
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
