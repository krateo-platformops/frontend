// @vitest-environment jsdom
/**
 * Reparenting from the tree — the keyboard route.
 *
 * The property under test is not "a modal opens": it is that the tree offers EXACTLY what the
 * canvas would accept, because both ask `legalTargets`. A tree that offered a destination the
 * canvas refuses (or refused one it accepts) would be two rules pretending to be one.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { legalTargets } from './dropTargets'
import MoveIntoModal, { reparentTargets } from './MoveIntoModal'
import { buildObjectTree } from './objectTree'
import type { TreeNode } from './objectTree'

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }))
  globalThis.ResizeObserver = class {
    disconnect() { /* jsdom never resizes */ }
    observe() { /* jsdom never resizes */ }
    unobserve() { /* nothing to stop observing */ }
  }
})
afterEach(cleanup)

const cr = (kind: string, name: string, children: readonly [string, string][] = []) => {
  const lines = [
    `kind: ${kind}`, 'apiVersion: widgets.templates.krateo.io/v1beta1',
    'metadata:', `  name: ${name}`, '  namespace: krateo-system', 'spec:', '  widgetData:',
  ]
  lines.push(children.length ? '    items:' : '    items: []')
  children.forEach(([refId]) => lines.push(`      - resourceRefId: ${refId}`))
  lines.push('  resourcesRefs:')
  lines.push(children.length ? '    items:' : '    items: []')
  children.forEach(([refId, crName]) => {
    lines.push(`      - id: ${refId}`, `        name: ${crName}`, '        namespace: krateo-system', '        resource: cards', '        verb: GET')
  })
  return lines.join('\n')
}

/** Flex page > [ Row outer > [ Card inner ], Paragraph para ], plus a spare Row */
const files = () => ({
  'templates/card.inner.yaml': cr('Card', 'inner'),
  'templates/flex.page.yaml': cr('Flex', 'page', [['o', 'outer'], ['p', 'para']]),
  'templates/paragraph.para.yaml': cr('Paragraph', 'para'),
  'templates/row.outer.yaml': cr('Row', 'outer', [['c', 'inner']]),
})

const find = (roots: readonly TreeNode[], name: string): TreeNode => {
  const walk = (nodes: readonly TreeNode[]): TreeNode | undefined => {
    for (const candidate of nodes) {
      if (candidate.name === name) { return candidate }
      const hit = walk(candidate.children)
      if (hit) { return hit }
    }
    return undefined
  }
  const found = walk(roots)
  if (!found) { throw new Error(`no node ${name}`) }
  return found
}

describe('reparentTargets — the tree offers exactly what the canvas accepts', () => {
  const names = (roots: readonly TreeNode[], from: string) =>
    reparentTargets(roots, find(roots, from)).map((node) => node.name).sort()

  it('offers other containers and never a leaf', () => {
    const roots = buildObjectTree(files())
    // `para` is a Paragraph — never a container, whoever asks.
    expect(names(roots, 'inner')).toEqual(['page'])
  })

  it('leaves out the container it is already in — that is what up and down are for', () => {
    const roots = buildObjectTree(files())
    expect(names(roots, 'inner')).not.toContain('outer')
  })

  it('never offers its own subtree — the cycle rule, same function as the canvas', () => {
    const roots = buildObjectTree(files())
    // `inner` sits inside `outer`; moving outer into it would detach the branch from the page.
    expect(names(roots, 'outer')).not.toContain('inner')
  })

  it('offers nothing when the reference declares no resource', () => {
    const roots = buildObjectTree(files())
    const mystery = { ...find(roots, 'inner'), resource: null }
    expect(reparentTargets(roots, mystery)).toEqual([])
  })

  it('agrees with legalTargets — it only ever REMOVES from it, never adds', () => {
    // The guarantee that keeps the two surfaces honest: anything the tree offers, the canvas would
    // have accepted too.
    const roots = buildObjectTree(files())
    const moving = find(roots, 'inner')
    const canvas = legalTargets(roots, { node: moving, plural: moving.resource! })
    for (const target of reparentTargets(roots, moving)) {
      expect(canvas).toContain(target)
    }
  })
})

describe('MoveIntoModal', () => {
  it('says so when the reference declares no resource, instead of offering nothing unexplained', () => {
    const roots = buildObjectTree(files())
    const orphan = { ...find(roots, 'inner'), resource: null }
    render(<MoveIntoModal moving={orphan} onCancel={vi.fn()} onMove={vi.fn()} open roots={roots} />)
    expect(screen.getByText(/no resource declared/i)).toBeTruthy()
  })

  it('says so when nothing on the page will take it', () => {
    const roots = buildObjectTree({ 'templates/card.only.yaml': cr('Card', 'only'), 'templates/flex.page.yaml': cr('Flex', 'page', [['c', 'only']]) })
    const moving = find(roots, 'only')
    render(<MoveIntoModal moving={moving} onCancel={vi.fn()} onMove={vi.fn()} open roots={roots} />)
    expect(screen.getByText(/No other container on this page will take it/i)).toBeTruthy()
  })
})
