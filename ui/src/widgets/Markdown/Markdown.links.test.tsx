// @vitest-environment jsdom
/**
 * A Markdown link to a page of this app — a same-origin PATH (`/login`, `/compositions/…`) — opens
 * in the same tab, through the app's router, with no reload. Everything else keeps opening in a new
 * tab (Markdown.linksUnchanged: another origin, `mailto:`, and a `#anchor` as before).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import Markdown from './Markdown'

afterEach(() => { cleanup() })

const markdownAt = (markdown: string) => (
  <Markdown resourcesRefs={{ items: [] }} uid='m1' widget={{} as never} widgetData={{ markdown }} />
)

const renderInApp = (markdown: string) => render(
  <MemoryRouter initialEntries={['/public/request-access']}>
    <Routes>
      <Route element={markdownAt(markdown)} path='/public/request-access' />
      <Route element={<p>The sign-in page</p>} path='/login' />
      <Route element={<p>A composition</p>} path='/compositions/demo/web' />
    </Routes>
  </MemoryRouter>,
)

const link = (name: string) => screen.getByRole('link', { name })

describe('Markdown: a path of this app', () => {
  it('is a same-tab link: no target, no rel', () => {
    renderInApp('Already have an account? [Sign in](/login)')
    expect([link('Sign in').getAttribute('href'), link('Sign in').hasAttribute('target'), link('Sign in').hasAttribute('rel')]).toEqual(['/login', false, false])
  })

  it.each([
    ['/login', 'The sign-in page'],
    ['/compositions/demo/web', 'A composition'],
  ])('%s navigates through the router, in the same tab', (path, page) => {
    renderInApp(`[Go](${path})`)
    fireEvent.click(link('Go'))
    expect(screen.getByText(page)).toBeTruthy()
  })

  it.each([
    ['//evil.example.com/login'],
    ['https://cmp.example.dev/login'],
  ])('beside a path link, %s is not a path of this app: a new tab, rel noopener noreferrer', (href) => {
    renderInApp(`[Sign in](/login) or [Away](<${href}>)`)
    expect(link('Sign in').hasAttribute('target')).toBe(false)
    expect([link('Away').getAttribute('target'), link('Away').getAttribute('rel')]).toEqual(['_blank', 'noopener noreferrer'])
  })

  it('outside a router (a preview), still the same tab', () => {
    render(markdownAt('[Sign in](/login)'))
    expect([link('Sign in').getAttribute('href'), link('Sign in').hasAttribute('target')]).toEqual(['/login', false])
  })
})
