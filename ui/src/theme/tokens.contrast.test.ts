/**
 * WCAG AA contrast regression test for the primary CTA button — Krateo Brand v2 (blue).
 *
 * The primary-button label colour is antd's `colorTextLightSolid`. Brand v2 inverts the amber-era
 * pairing:
 *   - LIGHT primary = Sovereign Blue #05629A (dark) → WHITE label ≈ 6.5:1 (antd default; NO override).
 *   - DARK  primary = Krateo Blue  #2FBFE6 (bright) → white would be only ~2.2:1, so the label flips
 *     to the DARK ink (surface #141414 = colorDark.panelbg) ≈ 8.3:1.
 *
 * This test pins: (a) light primary + white passes AA, (b) dark primary + white FAILS (the reason
 * for the flip), (c) dark primary + dark ink passes AA, (d/e) the Button token carries the correct
 * per-mode label colour.
 */

import { describe, expect, it } from 'vitest'

import { color, colorDark, lightTheme, darkTheme } from './tokens'

// ---------------------------------------------------------------------------
// WCAG helpers
// ---------------------------------------------------------------------------

function sRGBToLinear(c8bit: number): number {
  const ch = c8bit / 255
  return ch <= 0.04045 ? ch / 12.92 : Math.pow((ch + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number {
  const rr = parseInt(hex.slice(1, 3), 16)
  const gg = parseInt(hex.slice(3, 5), 16)
  const bb = parseInt(hex.slice(5, 7), 16)
  return 0.2126 * sRGBToLinear(rr) + 0.7152 * sRGBToLinear(gg) + 0.0722 * sRGBToLinear(bb)
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1)
  const l2 = relativeLuminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Primary CTA button — WCAG AA contrast (Brand v2 blue)', () => {
  it('light primary Sovereign Blue (#05629A) + white label passes AA ≥ 4.5:1', () => {
    const ratio = contrastRatio(color.primary, '#FFFFFF')
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('dark primary Krateo Blue (#2FBFE6) + white label FAILS AA (documents the flip)', () => {
    const ratio = contrastRatio(colorDark.primary, '#FFFFFF')
    expect(ratio).toBeLessThan(4.5)
  })

  it('dark primary (#2FBFE6) + dark ink (surface #141414) passes AA ≥ 4.5:1', () => {
    const ratio = contrastRatio(colorDark.primary, colorDark.panelbg)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('lightTheme.components.Button does NOT override colorTextLightSolid (keeps white on Sovereign)', () => {
    const btn = lightTheme.components?.Button as Record<string, unknown> | undefined
    expect(btn?.colorTextLightSolid).toBeUndefined()
  })

  it('darkTheme.components.Button sets colorTextLightSolid = dark ink (surface #141414)', () => {
    const btn = darkTheme.components?.Button as Record<string, unknown> | undefined
    expect(btn?.colorTextLightSolid).toBe(colorDark.panelbg)
  })

  it('the two modes use different primaries (Sovereign light vs Krateo dark)', () => {
    expect(colorDark.primary).not.toBe(color.primary)
    // The dark primary is the brighter blue (higher luminance) for visibility on black.
    expect(relativeLuminance(colorDark.primary)).toBeGreaterThan(relativeLuminance(color.primary))
  })
})

/**
 * Body-text contrast, table-driven over EVERY text-role × surface pair in both modes.
 *
 * The suite above pins exactly one pairing (the primary CTA). That left the rest unguarded, and
 * one was failing in production: `faint` shipped as #7A7A7A in BOTH modes — the only greyscale key
 * that did not shift with the theme — measuring 3.94-4.29:1 on the surfaces it is rendered on, at
 * the 12-14px sizes CommandPalette uses it at. Below the 4.5:1 AA floor for normal-size text.
 *
 * Driving the assertion from the palettes themselves means a new text role or a new surface is
 * covered the moment it is added, rather than the moment someone remembers to add a test.
 */
describe('Body text — WCAG AA contrast across every text/surface pair', () => {
  const TEXT_ROLES = ['text', 'gray', 'faint'] as const
  const SURFACES = ['light', 'panelbg', 'background', 'lightgray'] as const

  const modes = [
    { name: 'light', palette: color },
    { name: 'dark', palette: colorDark },
  ] as const

  modes.forEach(({ name, palette }) => {
    TEXT_ROLES.forEach((role) => {
      SURFACES.forEach((surface) => {
        it(`${name}: ${role} on ${surface} passes AA >= 4.5:1`, () => {
          const ratio = contrastRatio(palette[role], palette[surface])
          expect(ratio).toBeGreaterThanOrEqual(4.5)
        })
      })
    })
  })

  it('faint differs per mode — a single value cannot clear both grounds', () => {
    expect(colorDark.faint).not.toBe(color.faint)
  })

  it('faint stays subordinate to gray in both modes', () => {
    // Hierarchy, not just legibility: raising faint to pass AA must not collapse it into `gray`.
    expect(contrastRatio(color.faint, color.background))
      .toBeLessThan(contrastRatio(color.gray, color.background))
    expect(contrastRatio(colorDark.faint, colorDark.background))
      .toBeLessThan(contrastRatio(colorDark.gray, colorDark.background))
  })
})

/**
 * T8 — `info` must be legible AND must not be the interaction blue.
 *
 * Before this, `info === primary` in both modes (#05629A / #2FBFE6), so an informational Alert was
 * pixel-identical to a primary Button and colour alone could not separate "status" from
 * "interactive". `info` now carries the desaturated blue-grey (#5F7285 / #8496AD): hue ~210 but low
 * saturation, so it reads as a note rather than a control, and sits visually subordinate to a CTA —
 * which is the correct hierarchy for information.
 *
 * The separation assertion is the load-bearing one. The contrast ones would still pass if someone
 * pointed `info` back at `primary`.
 */
describe('Info status colour — distinct from the interaction blue (T8)', () => {
  it('light info on the light panel passes AA ≥ 4.5:1', () => {
    expect(contrastRatio(color.info, '#FBFBFB')).toBeGreaterThanOrEqual(4.5)
  })

  it('light info on the light page background passes AA ≥ 4.5:1', () => {
    // The thinnest margin of the candidates considered (~4.55) — pinned so a future tweak that
    // darkens the background or lightens `info` fails here rather than in someone's eyes.
    expect(contrastRatio(color.info, color.background)).toBeGreaterThanOrEqual(4.5)
  })

  it('dark info on the dark panel passes AA ≥ 4.5:1', () => {
    expect(contrastRatio(colorDark.info, colorDark.panelbg)).toBeGreaterThanOrEqual(4.5)
  })

  it('info is NOT the primary in either mode — the whole point of the rule', () => {
    expect(color.info).not.toBe(color.primary)
    expect(colorDark.info).not.toBe(colorDark.primary)
  })

  it('info is not any of the three interaction blues', () => {
    const interaction = ['#11B2E2', '#2FBFE6', '#05629A']
    expect(interaction).not.toContain(color.info)
    expect(interaction).not.toContain(colorDark.info)
  })

  it('info follows the mode, unlike the darkBlue trap', () => {
    expect(colorDark.info).not.toBe(color.info)
    expect(relativeLuminance(colorDark.info)).toBeGreaterThan(relativeLuminance(color.info))
  })
})

/**
 * NON-TEXT contrast — the 3:1 floor WCAG sets for a meaningful icon, which is a different (and
 * lower) bar than the 4.5:1 above and therefore a separate block.
 *
 * Written because the notification list failed it in exactly one theme. Its warning triangle was a
 * hardcoded `#faad14` — antd's gold, 8.97:1 on the dark ground and **1.90:1 on the light one**. The
 * one glyph on the row whose job is to say "this needs attention" was the least visible thing on it
 * in light mode, and the defect could not be seen by anyone working in dark.
 *
 * So the pairs below are pinned in BOTH modes. A token that passes in one and fails in the other is
 * the failure this block exists to catch — a single-mode check would have called `#faad14` fine.
 */
describe('Status and de-emphasised icons — WCAG non-text contrast ≥ 3:1', () => {
  const NON_TEXT_MIN = 3

  it('warning reads on the light ground — the pairing that was failing at 1.90:1', () => {
    expect(contrastRatio(color.warning, color.light)).toBeGreaterThanOrEqual(NON_TEXT_MIN)
  })

  it('warning reads on the dark ground', () => {
    expect(contrastRatio(colorDark.warning, colorDark.light)).toBeGreaterThanOrEqual(NON_TEXT_MIN)
  })

  it('faint — the de-emphasised icon tier — reads in both modes', () => {
    expect(contrastRatio(color.faint, color.light)).toBeGreaterThanOrEqual(NON_TEXT_MIN)
    expect(contrastRatio(colorDark.faint, colorDark.light)).toBeGreaterThanOrEqual(NON_TEXT_MIN)
  })

  it('antd gold (#faad14) FAILS on the light ground — documents why the token is not it', () => {
    // Kept as an assertion rather than a comment: if a future palette change made this pass, the
    // reason the notification icon uses `warning` instead would have quietly stopped being true.
    expect(contrastRatio('#faad14', color.light)).toBeLessThan(NON_TEXT_MIN)
  })

  it('warning follows the mode — a fixed literal cannot', () => {
    expect(colorDark.warning).not.toBe(color.warning)
  })
})
