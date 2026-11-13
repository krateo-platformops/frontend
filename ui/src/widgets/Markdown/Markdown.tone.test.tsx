// @vitest-environment jsdom
/**
 * `tone: secondary`: the muted line under a card (mockup v3's "Already have an account? Sign in",
 * the sign-in card's .requestAccount) — the secondary text colour at the small size, from the
 * design tokens. Absent, a Markdown keeps its class list (Markdown.alignUnchanged).
 *
 * jsdom applies no stylesheet, so the colour and size are read from the module's rule.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import Markdown from './Markdown'

afterEach(() => { cleanup() })

const css = readFileSync(join(__dirname, 'Markdown.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('Markdown tone: secondary', () => {
  it('carries the secondary class', () => {
    const root = render(<Markdown resourcesRefs={{ items: [] }} uid='m1' widget={{} as never} widgetData={{ markdown: 'Already have an account? [Sign in](/login)', tone: 'secondary' }} />).container.firstElementChild as HTMLElement
    expect([...root.classList].some((name) => /^_secondary_/.test(name))).toBe(true)
    expect([...root.classList].some((name) => /^_markdown_/.test(name))).toBe(true)
  })

  it('is the secondary text colour at the small size, on the tokens the sign-in line uses', () => {
    const rule = css.match(/\.markdown\.secondary\s*\{([^{}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/color:\s*var\(--gray-color\);/)
    expect(rule).toMatch(/font-size:\s*var\(--krateo-text-body-sm\);/)
  })
})
