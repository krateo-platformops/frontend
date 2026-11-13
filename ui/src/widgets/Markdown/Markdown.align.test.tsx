// @vitest-environment jsdom
/**
 * `align`, opt-in (Markdown.alignUnchanged holds what a Markdown without it keeps): the text's
 * alignment — a centred "Already have an account? Sign in" under a narrow card.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import Markdown from './Markdown'
import type { MarkdownWidgetData } from './Markdown'

afterEach(() => { cleanup() })

const renderMarkdown = (widgetData: MarkdownWidgetData) =>
  render(<Markdown resourcesRefs={{ items: [] }} uid='m1' widget={{} as never} widgetData={widgetData} />).container.firstElementChild as HTMLElement

describe('Markdown align', () => {
  it.each(['left', 'center', 'right'] as const)('%s', (align) => {
    const root = renderMarkdown({ align, markdown: 'Already have an account? [Sign in](/login)' })
    expect(root.style.textAlign).toBe(align)
  })
})
