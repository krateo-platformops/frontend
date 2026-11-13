// @vitest-environment jsdom
/**
 * How a Markdown link behaves. RECORDED ON MAIN (the Markdown widget is unchanged on this branch
 * so far), before same-origin path links went through the app router:
 *
 * - an external link (another origin) opens in a new tab, rel="noopener noreferrer";
 * - a `mailto:` link likewise;
 * - a `#anchor` link stays in the tab and scrolls to its target, syncing the hash;
 * - TODAY a same-origin PATH link (`/login`) also opens in a new tab. The commit that routes path
 *   links in the same tab changes THIS ONE assertion, on purpose; the three above must hold.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Markdown from './Markdown'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderMarkdown = (markdown: string) => render(
  <MemoryRouter>
    <Markdown resourcesRefs={{ items: [] }} uid='m1' widget={{} as never} widgetData={{ markdown }} />
  </MemoryRouter>,
)

const link = (name: string) => screen.getByRole('link', { name }) as HTMLAnchorElement

describe('Markdown links, as today', () => {
  it('an external link opens in a new tab, rel noopener noreferrer', () => {
    renderMarkdown('[Docs](https://docs.example.com/guide)')
    expect([link('Docs').getAttribute('href'), link('Docs').target, link('Docs').rel]).toEqual(['https://docs.example.com/guide', '_blank', 'noopener noreferrer'])
  })

  it('a mailto link opens in a new tab, rel noopener noreferrer', () => {
    renderMarkdown('[Write to us](mailto:team@example.com)')
    expect([link('Write to us').getAttribute('href'), link('Write to us').target, link('Write to us').rel]).toEqual(['mailto:team@example.com', '_blank', 'noopener noreferrer'])
  })

  it('a #anchor link stays in the tab, scrolls to its target and syncs the hash', () => {
    const target = document.createElement('div')
    target.id = 'details'
    target.scrollIntoView = vi.fn()
    document.body.appendChild(target)
    const replaceState = vi.spyOn(window.history, 'replaceState')
    renderMarkdown('[See details](#details)')
    const anchor = link('See details')
    expect([anchor.getAttribute('href'), anchor.hasAttribute('target'), anchor.hasAttribute('rel')]).toEqual(['#details', false, false])
    fireEvent.click(anchor)
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    expect(replaceState).toHaveBeenCalledWith(null, '', '#details')
    target.remove()
  })

  it('TODAY: a same-origin path link opens in a new tab', () => {
    renderMarkdown('Already have an account? [Sign in](/login)')
    expect([link('Sign in').getAttribute('href'), link('Sign in').target]).toEqual(['/login', '_blank'])
  })
})
