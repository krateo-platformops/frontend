// @vitest-environment jsdom
/**
 * An item's `href` makes its value a link: a page of this app through the router (same tab), anything
 * else in a new tab (components/AppLink, the rule Markdown already applied). Without `href`, plain text.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import Descriptions from './Descriptions'

// antd Descriptions reads matchMedia for its responsive columns; jsdom has none.
beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
})
afterEach(() => { cleanup() })

const view = (items: Array<{ label: string; value: string; href?: string }>, variant?: 'form') => render(
  <MemoryRouter>
    <Descriptions resourcesRefs={{ items: [] }} uid='d1' widgetData={{ items, ...(variant ? { variant } : {}) }} />
  </MemoryRouter>,
)

describe('Descriptions item href', () => {
  it('a page of this app: a same-tab link through the router', () => {
    view([{ href: '/blueprints/krateo-system/owner', label: 'Inputs', value: 'Defined by blueprint krateo-system/owner' }])
    const link = screen.getByRole('link', { name: 'Defined by blueprint krateo-system/owner' })
    expect(link.getAttribute('href')).toBe('/blueprints/krateo-system/owner')
    expect(link.getAttribute('target')).toBeNull()
  })

  it('anything else: a new tab, without the opener', () => {
    view([{ href: 'https://example.com/docs', label: 'Docs', value: 'Read more' }])
    const link = screen.getByRole('link', { name: 'Read more' })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('no href: plain text, as before; the form variant links too', () => {
    view([{ label: 'Version', value: '1.0.0' }, { href: '/blueprints/a/b', label: 'Owner', value: 'a/b' }], 'form')
    expect(screen.getByText('1.0.0').closest('a')).toBeNull()
    expect(screen.getByRole('link', { name: 'a/b' }).getAttribute('href')).toBe('/blueprints/a/b')
  })
})
