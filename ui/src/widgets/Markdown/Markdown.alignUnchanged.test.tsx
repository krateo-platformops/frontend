// @vitest-environment jsdom
/**
 * What a Markdown without `align` draws. RECORDED ON MAIN, before `align` existed: the commit that
 * adds it has to keep every snapshot and assertion here. The text keeps the alignment it inherits
 * (no inline style on the widget), and a link keeps opening in a new tab.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import Markdown from './Markdown'
import type { MarkdownWidgetData } from './Markdown'

afterEach(() => { cleanup() })

const renderMarkdown = (widgetData: MarkdownWidgetData) =>
  render(<Markdown resourcesRefs={{ items: [] }} uid='m1' widget={{} as never} widgetData={widgetData} />).container.firstElementChild as HTMLElement

describe('a Markdown without align', () => {
  it('a line with a link, as before', () => {
    const root = renderMarkdown({ markdown: 'Already have an account? [Sign in](/login)' })
    expect(root.outerHTML).toMatchSnapshot()
  })

  it('inherits its alignment: no inline style on the widget', () => {
    const root = renderMarkdown({ markdown: '# Title\n\nSome text.' })
    expect(root.getAttribute('style')).toBeNull()
  })
})
