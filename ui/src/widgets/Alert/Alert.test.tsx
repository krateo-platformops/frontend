// @vitest-environment jsdom
/**
 * Alert's two optional fields: `tag`, the reason beside the title in the alert's own type colour,
 * and `details`, the full message folded under a collapsed "Details" disclosure inside the box.
 * Without either, the widget is antd's Alert and nothing else: same markup, byte for byte.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Alert as AntdAlert } from 'antd'
import { afterEach, describe, expect, it } from 'vitest'

import { getTagStyle } from '../../theme/palette'

import Alert, { type AlertWidgetData } from './Alert'

const renderAlert = (widgetData: AlertWidgetData) =>
  render(<Alert resourcesRefs={{ items: [] }} uid='a' widgetData={widgetData} />)

/** The colour as jsdom reports it back from an inline style (`rgb(…)`). */
const toRgb = (hex: string): string => {
  const probe = document.createElement('i')
  probe.style.color = hex
  return probe.style.color
}

describe('Alert — tag and details', () => {
  afterEach(() => { cleanup() })

  it('draws the tag beside the title, in the alert type colour', () => {
    const { container } = renderAlert({ tag: 'ProgressDeadlineExceeded', title: 'This part cannot be served', type: 'error' })

    const title = container.querySelector('.ant-alert-title')
    const tag = title?.querySelector('.ant-tag')
    expect(title?.textContent).toContain('This part cannot be served')
    expect(tag?.textContent).toBe('ProgressDeadlineExceeded')
    expect((tag as HTMLElement).style.color).toBe(toRgb(String(getTagStyle('error').color)))
  })

  it("colours the tag by the type antd paints when none is named: a banner's warning, else info", () => {
    const banner = renderAlert({ banner: true, tag: 'Degraded', title: 'Banner' })
    expect((banner.container.querySelector('.ant-tag') as HTMLElement).style.color).toBe(toRgb(String(getTagStyle('warning').color)))
    cleanup()
    const plain = renderAlert({ tag: 'Pending', title: 'Plain' })
    expect((plain.container.querySelector('.ant-tag') as HTMLElement).style.color).toBe(toRgb(String(getTagStyle('info').color)))
  })

  it('folds details under a collapsed "Details" disclosure that a keyboard opens and closes', async () => {
    const details = 'Deployment "web" exceeded its progress deadline.\nReplicaSet "web-7d9c" has 0 of 3 replicas available.'
    const { container } = renderAlert({ details, title: 'This part cannot be served', type: 'error' })

    const toggle = screen.getByRole('button', { name: 'Details' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(panel).not.toBeNull()
    expect(panel?.hidden).toBe(true)
    // Inside the alert's body (its description), not after the box.
    expect(container.querySelector('.ant-alert-description')?.contains(toggle)).toBe(true)

    const user = userEvent.setup()
    await user.tab()
    expect(document.activeElement).toBe(toggle)
    await user.keyboard('{Enter}')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(panel?.hidden).toBe(false)
    // Plain text, line breaks kept as written.
    expect(panel?.textContent).toBe(details)

    await user.keyboard(' ')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(panel?.hidden).toBe(true)
  })

  it('keeps the description above the disclosure when both are set', () => {
    const { container } = renderAlert({ description: 'Short summary.', details: 'Long message.', title: 'T', type: 'warning' })

    const body = container.querySelector('.ant-alert-description')
    expect(body?.textContent?.startsWith('Short summary.')).toBe(true)
    expect(body?.querySelector('button')?.textContent).toBe('Details')
  })

  it('separates the disclosure from the description: the description is an element, so the gap below it applies', () => {
    const { container } = renderAlert({ description: 'Short summary.', details: 'Long message.', title: 'T', type: 'warning' })

    const body = container.querySelector('.ant-alert-description') as HTMLElement
    const [first, second] = Array.from(body.children)
    expect(first.textContent).toBe('Short summary.')
    expect(first.querySelector('button')).toBeNull()
    expect(second.querySelector('button')?.textContent).toBe('Details')
  })

  it('renders no disclosure and no tag when neither field is set', () => {
    const { container } = renderAlert({ description: 'd', title: 't', type: 'error' })

    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull()
    expect(container.querySelector('.ant-tag')).toBeNull()
  })

  it.each<AlertWidgetData>([
    { description: 'Your composition is being reconciled.', showIcon: true, title: 'Heads up', type: 'info' },
    { banner: true, title: 'Reconciliation failed', type: 'error' },
    { closable: true, title: 'Dismiss me', type: 'success' },
  ])('without tag or details the markup is antd Alert unchanged: %o', (widgetData) => {
    const widget = renderAlert(widgetData).container.innerHTML
    cleanup()
    const antd = render(<AntdAlert {...widgetData} />).container.innerHTML

    expect(widget).toBe(antd)
  })
})
