// @vitest-environment jsdom
/**
 * The current step's number on its painted primary fill, as antd renders it under each theme.
 * Dark mode paints the primary #A86BDC (antd's dark algorithm moves the #C27AFF seed), where a
 * white number measured 3.62:1; the theme gives Steps the dark ink instead (5.26:1, pinned in
 * tokens.contrast.test.ts). Light keeps antd's white on the violet. The upcoming steps keep their
 * own ink.
 */
import { cleanup, render } from '@testing-library/react'
import { ConfigProvider, theme } from 'antd'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { paintedFill, paintedInk, toHex } from '../../test/paintedColour'
import { colorDark, darkTheme, lightTheme } from '../../theme/tokens'

import Steps from './Steps'

const items = [{ title: 'Blueprint' }, { title: 'Configure' }, { title: 'Review' }]

const renderSteps = (mode: 'dark' | 'light') => render(
  <ConfigProvider theme={mode === 'dark' ? darkTheme : lightTheme}>
    <Steps resourcesRefs={{ items: [] }} uid={`steps-${mode}`} widget={{} as never} widgetData={{ current: 1, items }} />
  </ConfigProvider>,
)

const icon = (container: HTMLElement, state: 'process' | 'wait') => {
  const found = container.querySelector<HTMLElement>(`.ant-steps-item-${state} .ant-steps-item-icon`)
  if (!found) { throw new Error(`no ${state} step icon rendered`) }
  return found
}

describe('Steps — the current step number takes the dark ink in dark mode only', () => {
  // antd's responsive observer reads matchMedia, which jsdom does not implement.
  beforeAll(() => {
    const noop = () => undefined
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
      writable: true,
    })
  })
  afterEach(cleanup)

  it('dark: the number is the dark ink on the painted primary', () => {
    const { container } = renderSteps('dark')
    const current = icon(container, 'process')
    expect(current.textContent).toBe('2')
    expect(paintedFill(current)).toBe(toHex(theme.getDesignToken(darkTheme).colorPrimary))
    expect(paintedInk(current)).toBe(toHex(colorDark.panelbg))
  })

  it('light: the number stays white on the violet', () => {
    const { container } = renderSteps('light')
    const current = icon(container, 'process')
    expect(paintedFill(current)).toBe(toHex(theme.getDesignToken(lightTheme).colorPrimary))
    expect(paintedInk(current)).toBe('#ffffff')
  })

  it('dark: an upcoming step keeps its own ink, not the dark ink', () => {
    const { container } = renderSteps('dark')
    expect(paintedInk(icon(container, 'wait'))).toBe(toHex(theme.getDesignToken(darkTheme).colorTextLabel))
  })
})
