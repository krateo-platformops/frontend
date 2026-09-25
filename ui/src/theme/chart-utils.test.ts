// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getChartCatColor, getChartCatPalette } from './chart-utils'
import { activeThemeMode } from './palette'
import type * as PaletteModule from './palette'

// The real reading, spied on: the suite below proves the chart palette asks IT for the mode.
vi.mock('./palette', async (importOriginal) => {
  const actual = await importOriginal<typeof PaletteModule>()
  return { ...actual, activeThemeMode: vi.fn(actual.activeThemeMode) }
})

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
})

describe('chart-utils — v2 categorical palette (Brand v2 §1.5)', () => {
  it('returns a 10-colour palette', () => {
    expect(getChartCatPalette()).toHaveLength(10)
  })

  it('light mode → the light palette (cat-01 = #0E93BB)', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    expect(getChartCatPalette()[0]).toBe('#0E93BB')
  })

  it('dark mode → the dark palette (cat-01 = Krateo Blue #11B2E2)', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    expect(getChartCatPalette()[0]).toBe('#11B2E2')
  })

  it('getChartCatColor wraps at 10 and never returns undefined', () => {
    expect(getChartCatColor(10)).toBe(getChartCatColor(0))
    expect(getChartCatColor(23)).toBeTruthy()
  })

  it('takes the mode from activeThemeMode — the one reading — not from its own look at data-theme', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    vi.mocked(activeThemeMode).mockReturnValueOnce('dark')
    expect(getChartCatPalette()[0]).toBe('#11B2E2')
  })
})
