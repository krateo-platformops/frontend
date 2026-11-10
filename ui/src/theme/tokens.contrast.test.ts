/**
 * WCAG AA contrast regression tests for the design tokens (T7) — Agentiko style (T11).
 *
 * The first block pins the primary's own pairs: the light primary (brand violet #9E00FF) under a
 * white label, the dark primary (the tint #C27AFF) failing under white and passing under dark ink —
 * the reason the dark Button flips `colorTextLightSolid`. The wash block below pins the pair the
 * portal actually DRAWS for a primary button (ui/index.css): a label over a 14–28% tint of the
 * primary on the panel and the page ground. Pinning primary-on-white alone let that pair ship at
 * 3.6–4.2:1 (audit 2026-11, C2).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { theme as antdTheme } from 'antd'
import { describe, expect, it } from 'vitest'

import { agentikoAntdTheme, agentikoBrand, color, colorDark, lightTheme, darkTheme } from './tokens'

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

describe('Primary button — the primary\'s own label pairs', () => {
  it('light primary (brand violet) + white label passes AA ≥ 4.5:1', () => {
    const ratio = contrastRatio(color.primary, '#FFFFFF')
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('dark primary (the tint) + white label FAILS AA (documents the flip)', () => {
    const ratio = contrastRatio(colorDark.primary, '#FFFFFF')
    expect(ratio).toBeLessThan(4.5)
  })

  it('dark primary (the tint) + dark ink (surface) passes AA ≥ 4.5:1', () => {
    const ratio = contrastRatio(colorDark.primary, colorDark.panelbg)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('lightTheme.components.Button does NOT override colorTextLightSolid (keeps white on the violet)', () => {
    const btn = lightTheme.components?.Button
    expect(btn?.colorTextLightSolid).toBeUndefined()
  })

  it('darkTheme.components.Button sets colorTextLightSolid = dark ink (surface #141414)', () => {
    const btn = darkTheme.components?.Button
    expect(btn?.colorTextLightSolid).toBe(colorDark.panelbg)
  })

  it('the two modes use different primaries (violet light vs tint dark)', () => {
    expect(colorDark.primary).not.toBe(color.primary)
    // The dark primary is the brighter tint (higher luminance) for visibility on the dark ground.
    expect(relativeLuminance(colorDark.primary)).toBeGreaterThan(relativeLuminance(color.primary))
  })
})

/**
 * The primary WASH (ui/index.css): what a primary button actually draws — its label over the
 * primary mixed into the ground at 14% (rest), 22% (hover / focus) and 28% (active). The label is
 * the primary mixed by the mode's `--primary-wash-label-mix` toward its `--primary-wash-label-ink`
 * (72% toward black in light, 85% toward white in dark).
 * Both percentages are read from the stylesheet, so a change there is measured here.
 */
const indexCss = readFileSync(join(__dirname, '..', '..', 'index.css'), 'utf8')

const toRgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (rgb: number[]): string => `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
/** `color-mix(in srgb, a p, b)` — p of a, the rest of b. */
const mix = (first: string, second: string, share: number): string => {
  const [from, to] = [toRgb(first), toRgb(second)]
  return toHex(from.map((channel, index) => channel * share + to[index] * (1 - share)))
}

const labelScope = (mode: 'light' | 'dark'): string => {
  const found = indexCss.match(mode === 'dark' ? /\n\[data-theme="dark"\]\s*\{([^}]*)\}/ : /\n:root\s*\{([^}]*)\}/)
  if (!found) { throw new Error(`index.css has no ${mode} scope for the wash label`) }
  return found[1]
}
const labelMix = (mode: 'light' | 'dark'): number => {
  const found = labelScope(mode).match(/--primary-wash-label-mix:\s*(\d+)%/)
  if (!found) { throw new Error(`index.css declares no --primary-wash-label-mix for ${mode}`) }
  return Number(found[1]) / 100
}
const labelInk = (mode: 'light' | 'dark'): string => {
  const found = labelScope(mode).match(/--primary-wash-label-ink:\s*(black|white)/)
  if (!found) { throw new Error(`index.css declares no --primary-wash-label-ink for ${mode}`) }
  return found[1] === 'white' ? '#FFFFFF' : '#000000'
}
const washLabel = (mode: 'light' | 'dark'): string =>
  mix(mode === 'dark' ? colorDark.primary : color.primary, labelInk(mode), labelMix(mode))

const washSteps = [...indexCss.matchAll(/background:\s*color-mix\(in srgb, var\(--primary-color\) (\d+)%, transparent\)/g)].map((match) => Number(match[1]) / 100)

describe('Primary wash — the label AA on the composited wash it is drawn on', () => {
  it('finds the wash steps and the label mix in index.css (the regexes did not silently match nothing)', () => {
    expect(washSteps).toEqual([0.14, 0.22, 0.28])
    expect(labelMix('light')).toBeLessThan(1)
    expect(labelMix('dark')).toBeLessThan(1)
  })

  it('light: the label is the brand\'s accentActive (#7200B8) for the Agentiko violet', () => {
    expect(washLabel('light').toUpperCase()).toBe(agentikoBrand.light.accentActive.toUpperCase())
  })

  it('dark: the label is the tint lightened toward white (#CB8EFF)', () => {
    expect(labelInk('dark')).toBe('#FFFFFF')
    expect(washLabel('dark').toUpperCase()).toBe('#CB8EFF')
  })

  ;(['light', 'dark'] as const).forEach((mode) => {
    const palette = mode === 'dark' ? colorDark : color
    const label = washLabel(mode)
    ;[['panel', palette.panelbg], ['page ground', palette.background]].forEach(([groundName, ground]) => {
      washSteps.forEach((step) => {
        it(`${mode}: label on the ${Math.round(step * 100)}% wash over the ${groundName} passes AA >= 4.5:1`, () => {
          expect(contrastRatio(label, mix(palette.primary, ground, step))).toBeGreaterThanOrEqual(4.5)
        })
      })
    })
  })

  it('the bare primary FAILS on its own wash in both modes (documents why the label is mixed)', () => {
    expect(contrastRatio(color.primary, mix(color.primary, color.panelbg, 0.22))).toBeLessThan(4.5)
    expect(contrastRatio(colorDark.primary, mix(colorDark.primary, colorDark.panelbg, 0.28))).toBeLessThan(4.5)
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

/**
 * Preset Tag ink on its own fill — the blue ramps in the dark theme.
 *
 * A preset Tag (`<Tag color='blue'>`) paints antd's `<color>7` on `<color>1`. Under the dark
 * algorithm those come from the seed, and antd's stock `geekblue` seed gave #5273E0 on #131629:
 * 4.16:1, below AA for the 12px tags the composer uses ("Publishes to", "data", "1 data"). The dark
 * theme now seeds the blue ramps from colorDark; the light theme keeps antd's stock ramps untouched.
 */
describe('Preset blue Tags — WCAG AA ink on fill', () => {
  const PRESETS = ['blue', 'geekblue', 'cyan'] as const
  const ink = (map: Record<string, unknown>, preset: string) => String(map[`${preset}7`])
  const fill = (map: Record<string, unknown>, preset: string) => String(map[`${preset}1`])

  PRESETS.forEach((preset) => {
    it(`dark: ${preset} tag ink on its fill passes AA >= 4.5:1`, () => {
      const tokens = antdTheme.getDesignToken(darkTheme) as unknown as Record<string, unknown>
      expect(contrastRatio(ink(tokens, preset), fill(tokens, preset))).toBeGreaterThanOrEqual(4.5)
      // And on the surface it sits on, for a tag whose fill is barely distinct from it.
      expect(contrastRatio(ink(tokens, preset), colorDark.panelbg)).toBeGreaterThanOrEqual(4.5)
    })
  })

  it('dark: the blue ramps are seeded from the dark palette', () => {
    expect(darkTheme.token?.blue).toBe(colorDark.blue)
    // Seeded from Krateo Blue's dark value, not the (now violet) primary: geekblue stays blue.
    expect(darkTheme.token?.geekblue).toBe('#2FBFE6')
  })

  it('light: the preset ramps are antd\'s own — unchanged', () => {
    expect(lightTheme.token?.blue).toBeUndefined()
    expect(lightTheme.token?.geekblue).toBeUndefined()
    const tokens = antdTheme.getDesignToken(lightTheme) as unknown as Record<string, unknown>
    expect(ink(tokens, 'blue').toLowerCase()).toBe('#0958d9')
    expect(ink(tokens, 'geekblue').toLowerCase()).toBe('#1d39c4')
  })
})

/**
 * T11: the whole portal wears Agentiko. The agent's accent IS the primary (the brand violet on light
 * ground, the tint #C27AFF on dark ground, where #9E00FF is only 3.6:1 — pinned so nobody
 * "restores" the pure violet in dark mode). The agent's filled controls use the brand gradient
 * under WHITE in both modes, the brand manual's pairing, never dark ink.
 */
describe('Agentiko — WCAG AA for the primary and the agent\'s surfaces', () => {
  it('light accent is the Agentiko brand violet and the gradient is the brand pair', () => {
    expect(agentikoBrand.light.accent).toBe('#9E00FF')
    expect(agentikoBrand.light.gradientStart).toBe('#9E00FF')
    expect(agentikoBrand.light.gradientEnd).toBe('#2213CF')
  })

  ;(['light', 'dark'] as const).forEach((mode) => {
    const ap = agentikoBrand[mode]
    const panel = mode === 'dark' ? colorDark.panelbg : color.panelbg
    const ground = mode === 'dark' ? colorDark.background : color.background

    it(`${mode}: the primary is the agent's accent`, () => {
      expect(mode === 'dark' ? colorDark.primary : color.primary).toBe(ap.accent)
      expect((mode === 'dark' ? darkTheme : lightTheme).token?.colorPrimary).toBe(ap.accent)
    })

    it(`${mode}: accent text on the panel and the page ground passes AA >= 4.5:1`, () => {
      expect(contrastRatio(ap.accent, panel)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(ap.accent, ground)).toBeGreaterThanOrEqual(4.5)
    })

    it(`${mode}: the agent's filled controls are the brand gradient under white, AA at both ends`, () => {
      expect(ap.fillStart).toBe('#9E00FF')
      expect(ap.fillEnd).toBe('#2213CF')
      expect(ap.onFill).toBe('#FFFFFF')
      ;[ap.fillStart, ap.fillEnd].forEach((fill) => {
        expect(contrastRatio(ap.onFill, fill)).toBeGreaterThanOrEqual(4.5)
      })
    })

    it(`${mode}: the nested antd theme carries the same accent and the white label`, () => {
      const nested = agentikoAntdTheme(mode)
      expect(nested.token?.colorPrimary).toBe(ap.accent)
      expect(nested.components?.Button?.primaryColor).toBe(ap.onFill)
    })
  })

  it('the pure brand violet FAILS AA on the dark panel (documents the dark tint)', () => {
    expect(contrastRatio('#9E00FF', colorDark.panelbg)).toBeLessThan(4.5)
    expect(agentikoBrand.dark.accent).not.toBe('#9E00FF')
  })

  it('the selected sidebar item is the brand violet under white (the rail is black in both modes)', () => {
    expect(color.menuitembg).toBe('#9E00FF')
    expect(colorDark.menuitembg).toBe('#9E00FF')
    expect(contrastRatio('#FFFFFF', '#9E00FF')).toBeGreaterThanOrEqual(4.5)
  })
})

/**
 * C1 (X4 audit, WCAG 1.4.3): every text token antd emits for the theme, on every neutral surface.
 *
 * The theme used to set only `colorTextBase`, so antd derived secondary, tertiary and placeholder
 * text as see-through blends of it: 2.95:1 for secondary text in light mode, 1.74:1 (light) and
 * 2.19:1 (dark) for placeholders. The palette roles above all passed, and nothing checked what antd
 * actually paints. This block reads the tokens from antd itself (`getDesignToken`), so the list is
 * whatever antd derives today: a token antd adds later, or an override that brings a blend back, is
 * covered without anyone editing this file. An rgba token is composited over the surface first,
 * which is what the eye (and axe) sees.
 *
 * `colorTextLightSolid` is the one emitted text token not swept here, because antd paints it only
 * ON a solid colour fill (a primary or danger button, a badge count), never on these surfaces: on
 * white it is white. The Button's pairing is pinned by the CTA block at the top of this file; the
 * token's other fills (badge counts, solid tags) are not pinned here.
 */
describe('antd text tokens — WCAG AA on every neutral surface (C1)', () => {
  const ON_FILL_ONLY = ['colorTextLightSolid']
  const SURFACES = ['background', 'panelbg', 'lightgray'] as const

  /** `#rgb`, `#rrggbb` or `rgb[a](r, g, b[, a])` → channels 0-255 and alpha 0-1. */
  const parseColour = (value: string): { a: number; b: number; g: number; r: number } => {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
    if (hex) {
      const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1]
      return { a: 1, b: parseInt(digits.slice(4, 6), 16), g: parseInt(digits.slice(2, 4), 16), r: parseInt(digits.slice(0, 2), 16) }
    }
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value)
    if (rgb) {
      return { a: rgb[4] === undefined ? 1 : Number(rgb[4]), b: Number(rgb[3]), g: Number(rgb[2]), r: Number(rgb[1]) }
    }
    throw new Error(`unparseable colour ${value}`)
  }

  /** The opaque colour a (possibly translucent) token renders as over an opaque surface. */
  const composite = (token: string, surface: string): string => {
    const fg = parseColour(token)
    const bg = parseColour(surface)
    const mix = (top: number, under: number) => Math.round(top * fg.a + under * (1 - fg.a)).toString(16).padStart(2, '0')
    return `#${mix(fg.r, bg.r)}${mix(fg.g, bg.g)}${mix(fg.b, bg.b)}`
  }

  const modes = [
    { name: 'light', palette: color, theme: lightTheme },
    { name: 'dark', palette: colorDark, theme: darkTheme },
  ] as const

  modes.forEach(({ name, palette, theme }) => {
    const emitted = antdTheme.getDesignToken(theme) as unknown as Record<string, unknown>
    const textTokens = Object.keys(emitted).filter((key) => key.startsWith('colorText')).sort()

    it(`${name}: antd emits the text tokens this sweep expects to find`, () => {
      // Guards the sweep itself: if the filter matched nothing (a renamed token family, a broken
      // getDesignToken), every assertion below would pass vacuously.
      expect(textTokens).toEqual(expect.arrayContaining(['colorText', 'colorTextPlaceholder', 'colorTextSecondary', 'colorTextTertiary', ...ON_FILL_ONLY]))
    })

    textTokens.filter((token) => !ON_FILL_ONLY.includes(token)).forEach((token) => {
      SURFACES.forEach((surface) => {
        it(`${name}: ${token} on ${surface} passes AA >= 4.5:1`, () => {
          const value = String(emitted[token])
          const ratio = contrastRatio(composite(value, palette[surface]), palette[surface])
          expect(ratio, `${name} ${token} (${value}) on ${surface} (${palette[surface]}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
        })
      })
    })
  })

  it('the derived tiers are the palette roles, not blends — secondary is `gray`, placeholder is `faint`', () => {
    expect(lightTheme.token?.colorTextSecondary).toBe(color.gray)
    expect(lightTheme.token?.colorTextPlaceholder).toBe(color.faint)
    expect(darkTheme.token?.colorTextSecondary).toBe(colorDark.gray)
    expect(darkTheme.token?.colorTextPlaceholder).toBe(colorDark.faint)
  })
})
