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

import ArchitectureStateNode from './ArchitectureStateNode'

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
})

describe('the card\'s stylesheet: how the name line is set', () => {
  const css = readFileSync(join(__dirname, 'ArchitectureStateNode.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selectors, body]) => ({
    body: Object.fromEntries(body.split(';').map((each) => each.trim()).filter(Boolean).map((each) => {
      const at = each.indexOf(':')
      return [each.slice(0, at).trim(), each.slice(at + 1).trim()]
    })),
    selectors: selectors.split(',').map((each) => each.trim()),
  }))
  /** Every declaration of the rules that name `selector`, in source order (later wins). */
  const declared = (...selectors: string[]): Record<string, string> =>
    Object.assign({}, ...rules.filter((rule) => selectors.some((selector) => rule.selectors.includes(selector))).map((rule) => rule.body))

  it('regular .card: 240px wide, 84px tall', () => {
    const card = declared('.card')
    expect([card.width, card.height, card['min-height']]).toEqual(['240px', '84px', undefined])
  })

  it('compact .card: 180×56', () => {
    const card = declared(".card[data-density='compact']")
    expect([card.width, card.height]).toEqual(['180px', '56px'])
  })

  it('regular .name: one line, cut with an ellipsis', () => {
    const name = declared('.name')
    expect(name).toMatchObject({ overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' })
    expect(name['overflow-wrap']).toBeUndefined()
  })

  it('compact .name: two lines, then the clamp', () => {
    const name = declared('.name', ".card[data-density='compact'] .name")
    expect(name).toMatchObject({ '-webkit-line-clamp': '2', overflow: 'hidden', 'overflow-wrap': 'anywhere', 'white-space': 'normal' })
  })
})
