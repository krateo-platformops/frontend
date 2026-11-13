// @vitest-environment jsdom
/**
 * The architecture card's DOM and the stylesheet rules that decide how its NAME line is set, at both
 * densities. jsdom applies no CSS, so the rules are read from the module itself; what a real font
 * does with them is measured in the browser (visual/architectureCardText.spec.ts,
 * visual/architectureNames.spec.ts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { FlowChartNodeData } from '../FlowChart'

import ArchitectureStateNode, { ArchitectureCardProbe } from './ArchitectureStateNode'

afterEach(cleanup)

const NODE: FlowChartNodeData = {
  detail: 'targetCommitId · 0 of 1',
  kind: 'Repo',
  name: 'publish-bp-v2-20261002-1-source',
  parentRefs: [],
  state: 'done',
  uid: 'arch:repo',
}

/** The card's lines, by role: kind (regular only), name, detail. */
const lines = (card: HTMLElement) => [...card.children].map((child) => ({ tag: child.tagName.toLowerCase(), text: child.textContent, title: child.getAttribute('title') }))

describe('the card\'s DOM', () => {
  it('regular: a focusable group of three lines, the full name in the name line\'s title', () => {
    render(<ArchitectureStateNode data={NODE} />)
    const card = screen.getByRole('group', { name: 'Repo publish-bp-v2-20261002-1-source, done' })
    expect(card.tabIndex).toBe(0)
    expect(card.dataset.density).toBeUndefined()
    expect(lines(card)).toEqual([
      { tag: 'span', text: 'Repo', title: null },
      { tag: 'span', text: 'publish-bp-v2-20261002-1-source', title: 'publish-bp-v2-20261002-1-source' },
      { tag: 'span', text: 'targetCommitId · 0 of 1', title: 'targetCommitId · 0 of 1' },
    ])
  })

  it('compact: two lines, the kind leading the name line\'s title', () => {
    render(<ArchitectureStateNode data={NODE} density='compact' />)
    const card = screen.getByRole('group', { name: 'Repo publish-bp-v2-20261002-1-source, done' })
    expect(card.dataset.density).toBe('compact')
    expect(lines(card)).toEqual([
      { tag: 'span', text: 'publish-bp-v2-20261002-1-source', title: 'Repo\npublish-bp-v2-20261002-1-source' },
      { tag: 'span', text: 'targetCommitId · 0 of 1', title: 'targetCommitId · 0 of 1' },
    ])
  })

  it('the name line holds the name as the chart sent it, character for character', () => {
    render(<ArchitectureStateNode data={NODE} />)
    expect(screen.getByText('publish-bp-v2-20261002-1-source').textContent).toBe(NODE.name)
  })

  it('the name may break after every hyphen and dot: a <wbr> there, and no character added', () => {
    render(<ArchitectureStateNode data={{ ...NODE, name: 'a-b.c--d' }} />)
    const name = screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === 'a-b.c--d')
    expect(name.innerHTML).toBe('a-<wbr>b.<wbr>c-<wbr>-<wbr>d')
    // portal#427's names: six hyphens, six break points, `-20261002` and `-000` included.
    cleanup()
    render(<ArchitectureStateNode data={{ ...NODE, name: 'publish-bp-v2-20261002-1-000' }} />)
    expect(screen.getByText('publish-bp-v2-20261002-1-000', { normalizer: (text) => text }).querySelectorAll('wbr')).toHaveLength(5)
  })

  it('regular: drawn at the height the graph reserves; on its own, as tall as its lines need', () => {
    const { rerender } = render(<ArchitectureStateNode data={NODE} height={108} />)
    expect(screen.getByRole('group').style.height).toBe('108px')
    rerender(<ArchitectureStateNode data={NODE} />)
    expect(screen.getByRole('group').style.height).toBe('')
  })

  it('compact: its box is fixed, whatever height is handed to it', () => {
    render(<ArchitectureStateNode data={NODE} density='compact' height={108} />)
    expect(screen.getByRole('group').style.height).toBe('')
  })

  it('the probe FlowChart measures is the regular card\'s lines, and nothing a person can reach', () => {
    const exception = { label: 'NotSynced' as const, reason: 'ReconcileError' }
    const { container } = render(<ArchitectureCardProbe data={{ ...NODE, exception }} />)
    const probe = container.firstElementChild as HTMLElement
    expect(probe.getAttribute('role')).toBeNull()
    expect(probe.hasAttribute('tabindex')).toBe(false)
    expect(probe.querySelector('[data-testid]')).toBeNull()
    cleanup()
    const card = render(<ArchitectureStateNode data={{ ...NODE, exception }} />).getByRole('group')
    // The same lines, the same markup: what the probe measures is what the card draws.
    expect(probe.innerHTML).toBe(card.innerHTML.replace(' data-testid="architecture-exception"', ''))
    expect(probe.className).toBe(card.className)
  })
})

describe('the card\'s stylesheet: how the name line is set', () => {
  const css = readFileSync(join(__dirname, 'ArchitectureStateNode.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selectors, body]) => ({
    body: Object.fromEntries(body.split(';')
      .map((each) => each.trim())
      .filter(Boolean)
      .map((each) => {
        const at = each.indexOf(':')
        return [each.slice(0, at).trim(), each.slice(at + 1).trim()] as const
      })),
    selectors: selectors.split(',').map((each) => each.trim()),
  }))
  /** Every declaration of the rules that name `selector`, in source order (later wins). */
  const declared = (...selectors: string[]): Record<string, string> => rules
    .filter((rule) => selectors.some((selector) => rule.selectors.includes(selector)))
    .reduce<Record<string, string>>((all, rule) => ({ ...all, ...rule.body }), {})

  it('regular .card: 240px wide, at least 84px tall, and taller where its lines need it', () => {
    const card = declared('.card')
    expect([card.width, card.height, card['min-height']]).toEqual(['240px', undefined, '84px'])
  })

  it('compact .card: 180×56, fixed (its min-height too, or the regular 84px would win)', () => {
    const card = declared(".card[data-density='compact']")
    expect([card.width, card.height, card['min-height']]).toEqual(['180px', '56px', '56px'])
  })

  it('regular .name: in full, wrapping — never cut, never an ellipsis', () => {
    const name = declared('.name')
    expect(name).toMatchObject({ 'overflow-wrap': 'anywhere', 'white-space': 'normal' })
    expect([name.overflow, name['text-overflow'], name['-webkit-line-clamp']]).toEqual([undefined, undefined, undefined])
  })

  it('compact .name: two lines, then the clamp', () => {
    const name = declared('.name', ".card[data-density='compact'] .name")
    expect(name).toMatchObject({ '-webkit-line-clamp': '2', overflow: 'hidden', 'overflow-wrap': 'anywhere', 'white-space': 'normal' })
  })
})
