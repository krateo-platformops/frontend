// @vitest-environment jsdom
/**
 * Paragraph: what `variant: eyebrow` renders.
 *
 * The schema says the eyebrow is a small uppercase mono section caption. For a while the widget
 * returned null for it instead, a hide meant for page-header eyebrows that outlived them, and the
 * body labels still using the variant (the /audit and Observability chip-group labels) rendered as
 * nothing. These tests pin the caption, and pin that a plain Paragraph did not change with it.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import Paragraph from './Paragraph'
import type { ParagraphWidgetData } from './Paragraph'
import styles from './Paragraph.module.css'

const renderParagraph = (widgetData: ParagraphWidgetData) =>
  render(<Paragraph resourcesRefs={{ items: [] }} uid='p' widgetData={widgetData} />)

describe('Paragraph', () => {
  afterEach(() => { cleanup() })

  it('renders an eyebrow as a visible caption carrying the eyebrow class', () => {
    renderParagraph({ text: 'Namespace', variant: 'eyebrow' })

    const caption = screen.getByText('Namespace').closest('.ant-typography')
    expect(caption).not.toBeNull()
    expect(caption?.classList.contains(styles.paragraph)).toBe(true)
    expect(caption?.classList.contains(styles.eyebrow)).toBe(true)
  })

  it('renders a paragraph without a variant as before, with no eyebrow class', () => {
    const { container } = renderParagraph({ text: 'Plain body text' })

    expect(container.querySelector(`.${styles.eyebrow}`)).toBeNull()
    expect(container.firstChild).toMatchSnapshot()
  })
})
