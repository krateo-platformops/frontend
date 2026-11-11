import { useSyncExternalStore, type CSSProperties } from 'react'

import { contrastRatio, opaqueOver } from './contrast'
import { color, colorDark, type ThemeMode } from './tokens'

/**
 * Color palette. The canonical values live in `tokens.ts`; this module is kept
 * for backwards-compatible imports (`PALETTE`, `getColorCode`).
 */
const PALETTE = color

type PaletteColor = keyof typeof PALETTE

/**
 * The active color mode, as everything that paints outside CSS must read it: `data-theme` on
 * <html>, which `ThemeModeProvider` sets synchronously during its render. THE one reading of it —
 * getColorCode, the chart palette (chart-utils) and the dependency graph all resolve through here,
 * so no two canvases can disagree about which mode is on, and a change to how the mode is stored
 * is made once. Read from the attribute rather than the context so a caller needs no provider (a
 * widget mounted in a test, a G6 node's own React root). No document (a node test): light.
 */
export const activeThemeMode = (): ThemeMode =>
  (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

/** The token colours for a mode — the light `color` table or its dark counterpart. */
export const themeColors = (mode: ThemeMode): Record<PaletteColor, string> => (mode === 'dark' ? colorDark : color)

const subscribeThemeMode = (onChange: () => void): (() => void) => {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => undefined
  }
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributeFilter: ['data-theme'], attributes: true })
  return () => observer.disconnect()
}

/**
 * `activeThemeMode()` as a value a component re-renders on: for a canvas that must repaint when
 * the mode flips but has no antd `ConfigProvider` change to ride on (a G6 graph's colours).
 */
export const useDocumentThemeMode = (): ThemeMode => useSyncExternalStore(subscribeThemeMode, activeThemeMode, () => 'light')

/**
 * Resolve a brand/semantic color name to a hex code for the active color mode
 * (`activeThemeMode`), so inline-style/canvas callers follow the light/dark toggle.
 * Components re-render on toggle (the antd `ConfigProvider` theme changes), so this
 * re-evaluates with the new mode.
 */
export const getColorCode = (colorName: string | undefined) => {
  const palette = themeColors(activeThemeMode())

  if (colorName && colorName in palette) {
    return palette[colorName as PaletteColor]
  }

  return palette.dark
}

/** The two inks a glyph on a solid colour fill is drawn in: antd's white, and the theme's dark ink
 * (the dark palette's surface, which the dark theme also gives Button, Steps and Avatar). */
export const ON_FILL_INKS = { dark: colorDark.panelbg, white: '#FFFFFF' } as const

/**
 * The ink for a glyph on a solid disc of `fill` (a List row's icon avatar, whose fill is a CR's
 * colour name resolved by getColorCode): white or the dark ink, whichever contrasts more with the
 * fill as it paints. A translucent fill is composited over the mode's surface first. Chosen per
 * fill because no one ink suits every colour a CR can name: white on the dark theme's `gray` is
 * 2.61:1, the dark ink on `darkBlue` is 2.92:1. The two inks span 19:1, so the better of them
 * always clears the 3:1 an icon needs (tokens.contrast.test.ts sweeps every palette colour).
 */
export const inkOnFill = (fill: string, mode: ThemeMode = activeThemeMode()): string => {
  const painted = opaqueOver(fill, themeColors(mode).panelbg)
  return contrastRatio(ON_FILL_INKS.white, painted) >= contrastRatio(ON_FILL_INKS.dark, painted) ? ON_FILL_INKS.white : ON_FILL_INKS.dark
}

/**
 * Petrol soft-tint pill style for a brand/semantic color NAME (status Tags, chips).
 * Resolves the name → the EXACT Petrol hex via `getColorCode` (NOT antd's built-in
 * preset palette, which renders an off-brand green/red/gold), then returns the
 * mockup's pill: coloured ink on a low-alpha tint with a mid-alpha border. Theme-aware
 * (the hex follows the light/dark toggle). Apply to an uncoloured `<Tag style={…}>`.
 */
/**
 * A CR's text colour, for an inline `style.color`: a palette NAME resolves for the active mode
 * (`gray` is the AA-pinned grey of light or dark, not CSS's own `gray`), anything else — a CSS
 * keyword, a `var(--…)`, a legacy hex — passes through as written, so a chart can move from hex to
 * names before and after the frontend that resolves them. Unlike getColorCode, a miss is NOT
 * near-black: an unknown value is the author's CSS, and no value is no colour.
 */
export const resolveTextColor = (colorName: string | undefined): string | undefined => {
  if (!colorName) { return undefined }
  const palette = themeColors(activeThemeMode())
  return colorName in palette ? palette[colorName as PaletteColor] : colorName
}

export const getTagStyle = (colorName: string | undefined): CSSProperties => {
  const hex = getColorCode(colorName)
  return {
    backgroundColor: `color-mix(in srgb, ${hex} 15%, transparent)`,
    borderColor: `color-mix(in srgb, ${hex} 38%, transparent)`,
    color: hex,
  }
}

export default PALETTE
