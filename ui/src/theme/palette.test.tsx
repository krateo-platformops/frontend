// @vitest-environment jsdom
/**
 * The ONE reading of the colour mode. Everything that paints outside CSS — getColorCode's inline
 * styles, the chart palette, the dependency graph's canvas — resolves the mode through
 * `activeThemeMode`, so no two of them can disagree about which mode is on. What it reads, that
 * the readers follow it, and that the move onto it changed no colour.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { graphPalette } from '../components/DependencyGraph/graphConfig'

import { getChartCatPalette } from './chart-utils'
import { activeThemeMode, getColorCode, themeColors, useDocumentThemeMode } from './palette'
import { color, colorDark } from './tokens'

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
})

describe('activeThemeMode — data-theme on <html>, as ThemeModeProvider sets it', () => {
  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    ['Dark', 'light'],
    ['dim', 'light'],
  ])('data-theme=%j is %s', (attribute, mode) => {
    document.documentElement.dataset.theme = attribute
    expect(activeThemeMode()).toBe(mode)
  })

  it('no attribute is light', () => {
    expect(activeThemeMode()).toBe('light')
  })
})

describe('the readers agree, and no colour moved', () => {
  it.each(['light', 'dark'] as const)('%s: getColorCode, the graph palette and the chart palette all resolve this mode', (mode) => {
    document.documentElement.dataset.theme = mode
    const tokens = mode === 'dark' ? colorDark : color
    expect(themeColors(activeThemeMode())).toBe(tokens)
    for (const name of Object.keys(color)) {
      expect(getColorCode(name)).toBe(tokens[name as keyof typeof color])
    }
    expect(getColorCode('not-a-colour')).toBe(tokens.dark)
    expect(graphPalette(activeThemeMode())).toEqual({ edge: tokens.faint, label: tokens.gray, labelBackground: tokens.panelbg })
    expect(getChartCatPalette()[0]).toBe(mode === 'dark' ? '#11B2E2' : '#0E93BB')
  })
})

describe('useDocumentThemeMode — the mode as a value a canvas re-renders on', () => {
  it('follows a data-theme flip without a provider', async () => {
    const Mode = () => <output>{`mode ${useDocumentThemeMode()}`}</output>
    render(<Mode />)
    expect(screen.getByText('mode light')).toBeTruthy()
    act(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    expect(await screen.findByText('mode dark')).toBeTruthy()
  })
})
