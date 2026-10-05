// @vitest-environment jsdom
/**
 * The scales, pinned — including the steps that exist BECAUSE the code kept reaching past them.
 *
 * Both additions came from measuring, not taste. Before them, 162 of 211 spacing declarations and
 * 76 of 92 font-sizes were off-scale; the commonest off-scale values were exactly the gaps a
 * doubling scale leaves (6, 12) and a tier sitting beneath the type scale's floor (9.5–11px).
 *
 * These tests exist so a later "tidy-up" that removes a step has to argue with the measurement
 * rather than just delete it.
 */
import { describe, expect, it } from 'vitest'

import { cssVariables, darkTheme, lightTheme, spacing } from './tokens'

describe('spacing scale', () => {
  it('carries the half-steps a doubling scale skips', () => {
    // 6 and 12 sit between 4→8 and 8→16. 39 declarations were reaching for them.
    expect(spacing.xsm).toBe(6)
    expect(spacing.smd).toBe(12)
  })

  it('carries a sub-4 step', () => {
    // Ten declarations used 2px; rounding them to 4 would double some very fine gaps.
    expect(spacing.xxs).toBe(2)
  })

  it('ascends with no duplicate values', () => {
    const values = Object.values(spacing)
    expect([...values].sort((left, right) => left - right)).toEqual(values)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('type scale — the micro-label tier', () => {
  it('reaches below text-caption, because the UI does', () => {
    // The scale's floor was 12px while 52 declarations across twelve files sat at 9.5–11px —
    // column headers, card eyebrows, status captions. Not drift from the scale: beneath it.
    const root = document.documentElement
    cssVariables('light')
    expect(root.style.getPropertyValue('--krateo-text-label-sm')).toBe('11px')
    expect(root.style.getPropertyValue('--krateo-text-label-xs')).toBe('10px')
  })

  it('emits the new spacing steps as CSS variables', () => {
    const root = document.documentElement
    cssVariables('light')
    expect(root.style.getPropertyValue('--spacing-xxs')).toBe('2px')
    expect(root.style.getPropertyValue('--spacing-xsm')).toBe('6px')
    expect(root.style.getPropertyValue('--spacing-smd')).toBe('12px')
  })
})

describe('Form density comes from the theme (T2)', () => {
  it('spaces items and labels on the spacing scale, in both modes', () => {
    for (const { components } of [lightTheme, darkTheme]) {
      expect(components?.Form?.itemMarginBottom).toBe(spacing.md)
      expect(components?.Form?.verticalLabelPadding).toBe(`0 0 ${spacing.xsm}px`)
    }
  })
})

describe('form controls share one height (T2)', () => {
  it('pins every input-like control to 32px, not the compact algorithm’s 28', () => {
    // compactAlgorithm turns our controlHeight 32 into 28. Any control without its own override
    // inherits the 28 — that is how InputNumber and button-style Radios ended up 4px short.
    for (const { components } of [lightTheme, darkTheme]) {
      for (const kind of ['Button', 'DatePicker', 'Input', 'InputNumber', 'Radio', 'Select'] as const) {
        expect(components?.[kind]?.controlHeight, kind).toBe(32)
      }
    }
  })
})
