// @vitest-environment jsdom
/**
 * `afterCard`: children of the card that render just AFTER it (a wide screen) and, on a branded,
 * centred, capped card at 480px and under, as the last row INSIDE its surface (a phone). One DOM
 * placement, so the reading order is the body, then the slot, at both widths; only the drawing
 * changes. Without it, a Card places its children as before (Card.childrenUnchanged).
 *
 * jsdom evaluates no media query, so the phone drawing is read from the module's rules.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: () => Promise.resolve(), isActionLoading: false }),
}))
vi.mock('../../components/RefChild', () => {
  const Child = ({ resourceRefId }: { resourceRefId: string }) => <span data-child={resourceRefId} />
  return { default: Child }
})

import Card from './Card'

afterEach(() => { cleanup() })

const FRAMED = { brand: true, centered: true, maxWidth: 400, variant: 'outlined' }

const renderCard = (data: Record<string, unknown>) => render(
  <MemoryRouter>
    <App>
      <Card resourcesRefs={{ items: [] }} uid='c1' widget={{} as never} widgetData={{ items: [{ resourceRefId: 'form' }, { resourceRefId: 'signin' }], ...data }} />
    </App>
  </MemoryRouter>,
).container

const childIds = (scope: Element) => [...scope.querySelectorAll('[data-child]')].map((each) => each.getAttribute('data-child'))
const hasClass = (element: Element, name: string) => [...element.classList].some((each) => each.startsWith(`_${name}_`))

describe('afterCard', () => {
  it('the named child leaves the body and renders right after the card, once', () => {
    const container = renderCard({ ...FRAMED, afterCard: [{ resourceRefId: 'signin' }] })
    const card = container.querySelector('.ant-card') as HTMLElement
    expect(childIds(card.querySelector('.ant-card-body') as HTMLElement)).toEqual(['form'])
    const slot = card.nextElementSibling as HTMLElement
    expect(hasClass(slot, 'afterCard')).toBe(true)
    expect(childIds(slot)).toEqual(['signin'])
    expect(childIds(container)).toEqual(['form', 'signin'])
  })

  it('reading order: the body, then the slot — whatever order afterCard lists', () => {
    const container = renderCard({ ...FRAMED, afterCard: [{ resourceRefId: 'signin' }, { resourceRefId: 'form' }], items: [{ resourceRefId: 'form' }, { resourceRefId: 'note' }, { resourceRefId: 'signin' }] })
    expect(childIds(container.querySelector('.ant-card-body') as HTMLElement)).toEqual(['note'])
    expect(childIds(container)).toEqual(['note', 'form', 'signin'])
  })

  it('the column takes the frame\'s column options; the card keeps its brand', () => {
    const container = renderCard({ ...FRAMED, afterCard: [{ resourceRefId: 'signin' }] })
    const card = container.querySelector('.ant-card') as HTMLElement
    const column = card.parentElement as HTMLElement
    for (const name of ['column', 'columnBranded', 'centered', 'capped']) { expect(hasClass(column, name)).toBe(true) }
    expect(column.style.getPropertyValue('--card-max-width')).toBe('400px')
    expect(hasClass(card, 'branded')).toBe(true)
    expect(hasClass(card, 'centered') || hasClass(card, 'capped')).toBe(false)
    expect(card.getAttribute('style')).toBeNull()
  })

  it('on any other card: after the card, with no branded column', () => {
    const container = renderCard({ afterCard: [{ resourceRefId: 'signin' }], title: 'Plain' })
    const card = container.querySelector('.ant-card') as HTMLElement
    expect(childIds(card)).toEqual(['form'])
    const column = card.parentElement as HTMLElement
    expect(hasClass(column, 'column')).toBe(true)
    expect(hasClass(column, 'columnBranded')).toBe(false)
    expect(childIds(card.nextElementSibling as HTMLElement)).toEqual(['signin'])
  })

  it('an entry naming no item is ignored; the named one still moves', () => {
    const container = renderCard({ ...FRAMED, afterCard: [{ resourceRefId: 'nothing' }, { resourceRefId: 'signin' }] })
    expect(childIds(container.querySelector('.ant-card-body') as HTMLElement)).toEqual(['form'])
    expect(childIds(container)).toEqual(['form', 'signin'])
  })
})

describe('afterCard on a phone (480px and under)', () => {
  const css = readFileSync(join(__dirname, 'Card.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const phone = [...css.matchAll(/@media \(width <= 480px\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((match) => match[1]).join('\n')
  const rule = (selector: string) => [...phone.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(',').map((part) => part.trim()).includes(selector))
    .map((match) => match[2])
    .join('\n')

  it('the centred, capped column is the edge-to-edge sheet, and the card in it loses its box', () => {
    expect(rule('.column.centered.capped')).toMatch(/max-width:\s*none;/)
    expect(rule('.column.centered.capped')).toMatch(/gap:\s*0;/)
    for (const declaration of [/border:\s*0;/, /border-radius:\s*0;/, /box-shadow:\s*none;/]) {
      expect(rule('.column.centered.capped > .panel')).toMatch(declaration)
    }
  })

  it('a branded column is one surface the screen\'s height, the card\'s own token; the slot is its last row, in the body\'s gutter', () => {
    expect(rule('.column.columnBranded.centered.capped')).toMatch(/background-color:\s*var\(--panelbg-color\);/)
    expect(rule('.column.columnBranded.centered.capped')).toMatch(/min-height:\s*100dvh;/)
    expect(rule('.column.columnBranded.centered.capped > .afterCard')).toMatch(/padding:\s*0 var\(--spacing-lg\) var\(--spacing-lg\);/)
  })
})
