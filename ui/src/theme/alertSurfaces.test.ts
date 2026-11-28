// @vitest-environment jsdom
import { theme as antdTheme } from 'antd'
import { describe, expect, it } from 'vitest'

import { contrastRatio, opaqueOver } from './contrast'
import { color, cssVariables, darkTheme, lightTheme } from './tokens'

/**
 * ALRT-1 (UX audit, 2026-11-25): in the light theme antd derived an info Alert's fill as a muddy grey
 * rgb(185 192 196) and a warning Alert's as an olive, from the two dark text-grade seeds. Light now
 * sets both surfaces from tokens; dark is left to antd, unchanged.
 */
describe('Alert surfaces — the light theme\'s info and warning fills and frames', () => {
  const light = antdTheme.getDesignToken(lightTheme)
  /** The hue, degrees, of a `#rrggbb`. */
  const hue = (hex: string): number => {
    const [red, green, blue] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    const max = Math.max(red, green, blue)
    const span = max - Math.min(red, green, blue)
    if (span === 0) { return 0 }
    let sector = (red - green) / span + 4
    if (max === red) {
      sector = ((green - blue) / span) % 6
    } else if (max === green) {
      sector = (blue - red) / span + 2
    }
    return (sector * 60 + 360) % 360
  }

  it('info is the pale tint of the info slate, framed in a darker tint of the same hue', () => {
    expect(light.colorInfoBg).toBe(opaqueOver('rgba(95, 114, 133, 0.1)', color.panelbg))
    expect(light.colorInfoBorder).toBe(opaqueOver('rgba(95, 114, 133, 0.35)', color.panelbg))
    expect(light.colorInfoBg.toLowerCase()).not.toBe('#b9c0c4')
    expect(Math.abs(hue(light.colorInfoBg) - hue(color.info))).toBeLessThan(6)
    expect(Math.abs(hue(light.colorInfoBorder) - hue(color.info))).toBeLessThan(6)
    expect(contrastRatio(light.colorInfoBorder, color.panelbg)).toBeGreaterThan(contrastRatio(light.colorInfoBg, color.panelbg))
  })

  it('warning is the warning token\'s own subtle fill and border', () => {
    cssVariables('light')
    const css = (name: string) => document.documentElement.style.getPropertyValue(name).trim().toUpperCase()
    expect(light.colorWarningBg.toUpperCase()).toBe(css('--krateo-color-status-warning-subtle'))
    expect(light.colorWarningBorder.toUpperCase()).toBe(css('--krateo-color-status-warning-border'))
    expect(contrastRatio(light.colorWarningBorder, color.panelbg)).toBeGreaterThan(contrastRatio(light.colorWarningBg, color.panelbg))
  })

  it.each(['Info', 'Warning'] as const)('%s: the text an Alert sets on its fill is AA (>= 4.5:1), its icon >= 3:1', (kind) => {
    const fill = light[`color${kind}Bg`]
    expect(contrastRatio(light.colorText, fill)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light.colorTextHeading, fill)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light[`color${kind}`], fill)).toBeGreaterThanOrEqual(3)
  })

  it('the dark theme sets neither: its surfaces are antd\'s derivation, as before', () => {
    for (const key of ['colorInfoBg', 'colorInfoBorder', 'colorWarningBg', 'colorWarningBorder'] as const) {
      expect(darkTheme.token?.[key]).toBeUndefined()
    }
  })
})
