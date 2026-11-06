// @vitest-environment jsdom
/**
 * A4: `intent: autopilot` is a role, not a skin — the widget draws every agent entry point the
 * same way (filled with the Agentiko gradient, white label, the Agentiko mark) whatever `type`,
 * `color`, `variant`, `danger`, `ghost` or `icon` the CR carries. Unlicensed it is outlined, neutral
 * and locked, but still live. Without the intent a Button keeps the CR's own look.
 */

import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AutopilotLicenceContext } from '../../components/Autopilot/licence'

import type { ButtonWidgetData } from './Button'
import Button from './Button'

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }),
}))

afterEach(() => {
  cleanup()
})

const AGENTIKO_VIEWBOX = '0 0 1119.43 1155.03'

const renderButton = (data: Partial<ButtonWidgetData>, licensed: boolean | null = null) => {
  const widgetData: ButtonWidgetData = {
    actions: { navigate: [{ id: 'ask', path: '/x?ask=help', type: 'navigate' }] },
    clickActionId: 'ask',
    label: 'Ask Agentiko →',
    ...data,
  }
  const { container } = render(
    <AutopilotLicenceContext.Provider value={licensed}>
      <MemoryRouter>
        <App>
          <Button resourcesRefs={{ items: [] }} uid='btn-test' widget={{} as never} widgetData={widgetData} />
        </App>
      </MemoryRouter>
    </AutopilotLicenceContext.Provider>,
  )
  return container.querySelector('button')!
}

describe('Button widget — intent: autopilot (A4)', () => {
  it('is filled and carries the Agentiko mark', () => {
    const btn = renderButton({ intent: 'autopilot' })
    expect(btn.className).toMatch(/ant-btn-color-primary/)
    expect(btn.className).toMatch(/ant-btn-variant-solid/)
    expect(btn.querySelector(`svg[viewBox="${AGENTIKO_VIEWBOX}"]`)).not.toBeNull()
  })

  it('ignores the CR\'s type, colour, variant, danger, ghost and icon', () => {
    const btn = renderButton({ color: 'green', danger: true, ghost: true, icon: 'fa-wand-magic-sparkles', intent: 'autopilot', type: 'link', variant: 'outlined' })
    expect(btn.className).toMatch(/ant-btn-color-primary/)
    expect(btn.className).toMatch(/ant-btn-variant-solid/)
    expect(btn.className).not.toMatch(/ant-btn-dangerous|ant-btn-background-ghost/)
    expect(btn.querySelector('svg.svg-inline--fa')).toBeNull()
    expect(btn.querySelector(`svg[viewBox="${AGENTIKO_VIEWBOX}"]`)).not.toBeNull()
  })

  it('the mark is decorative: the visible label stays the accessible name', () => {
    const btn = renderButton({ intent: 'autopilot' })
    expect(btn.hasAttribute('aria-label')).toBe(false)
    expect(btn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(btn.textContent).toContain('Ask Agentiko →')
  })

  it('unlicensed, it is outlined and neutral with a lock — and still clickable', () => {
    const btn = renderButton({ intent: 'autopilot' }, false)
    expect(btn.className).not.toMatch(/ant-btn-color-primary/)
    expect(btn.querySelector(`svg[viewBox="${AGENTIKO_VIEWBOX}"]`)).toBeNull()
    expect(btn.querySelector('svg rect')).not.toBeNull()
    expect(btn.disabled).toBe(false)
    expect(btn.textContent).toContain('Ask Agentiko →')
  })

  it('without the intent a Button keeps its own look and no Agentiko mark', () => {
    const btn = renderButton({ type: 'default' })
    expect(btn.className).not.toMatch(/ant-btn-color-primary/)
    expect(btn.querySelector(`svg[viewBox="${AGENTIKO_VIEWBOX}"]`)).toBeNull()
  })
})
