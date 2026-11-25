/**
 * v2 categorical chart palette (Brand v2, issue #49 §1.5 / §6.1 — CVD-audited, DO NOT reorder).
 * Reads the canonical `--krateo-chart-cat-NN` CSS custom properties (emitted mode-aware by
 * cssVariables), so a tenant Theme override or a theme toggle is honoured with no code change.
 * The inlined arrays are the fallback when getComputedStyle can't resolve the var (SSR / a var
 * not yet emitted). Chart series are non-text FILLS (WCAG 3:1), so they stay vibrant in light
 * mode even though the status TEXT tokens use the darker AA `-text` variants.
 *
 * Used for AUTO-assigned chart series (no operator colour). Operator-specified colours still go
 * through getColorCode(name) — intentional control, not overridden.
 */
import { activeThemeMode, getColorCode } from './palette'

const CHART_CAT_DARK = [
  '#11B2E2', '#FFAA00', '#00D690', '#9350DB', '#F84C4C',
  '#2CC5B9', '#E060A8', '#AEC000', '#8496AD', '#A0A0A0',
] as const

const CHART_CAT_LIGHT = [
  '#0E93BB', '#DB9200', '#009765', '#722ED1', '#DE3B3B',
  '#0E9488', '#C13B7E', '#879500', '#5F7285', '#7A7A7A',
] as const

/** Read one `--krateo-chart-cat-NN` CSS var (1-based, zero-padded); '' if unavailable. */
const readChartCatVar = (index: number): string => {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') { return '' }
  const nn = String(index + 1).padStart(2, '0')
  return getComputedStyle(document.documentElement).getPropertyValue(`--krateo-chart-cat-${nn}`).trim()
}

/** The full 10-colour categorical palette for the active theme (G2 `scale.color.range`). */
export const getChartCatPalette = (): string[] => {
  const fallback: readonly string[] = activeThemeMode() === 'dark' ? CHART_CAT_DARK : CHART_CAT_LIGHT
  return fallback.map((hex, i) => readChartCatVar(i) || hex)
}

/** One categorical colour by series index (wraps at 10). */
export const getChartCatColor = (index: number): string => {
  const palette = getChartCatPalette()
  return palette[((index % palette.length) + palette.length) % palette.length]
}

/**
 * A chart's G2 `scale` from its CR (LineChart and BarChart, one mapping for both). SERIES colours: each
 * `colorMap` category maps to a Krateo palette colour (read for the active mode), merged into the CR's own
 * `scale`, as PieChart's colorMap does. Without a colorMap, auto-assigned series take the v2 categorical
 * chart palette instead of G2's default palette, and a CR-supplied `scale.color` still wins.
 */
export const chartScale = (colorMap: Record<string, string> | undefined, scale: Record<string, unknown> | undefined): Record<string, unknown> => (colorMap
  ? { ...scale, color: { domain: Object.keys(colorMap), range: Object.keys(colorMap).map((key) => getColorCode(colorMap[key])) } }
  : { color: { range: getChartCatPalette() }, ...scale })

type ChartAxis = Record<string, unknown> & { x: Record<string, unknown>; y: Record<string, unknown> }

/**
 * Default axis tick/title fill = theme ink (G2's near-black default is invisible on the Petrol void). Merged
 * UNDER the CR's own `axis.x`/`axis.y`, so any explicit per-axis config still wins; preserves any other axis
 * keys the CR set. LineChart and BarChart, one mapping for both.
 */
export const axisWithInk = (axis: Record<string, unknown> | undefined): ChartAxis => {
  const ink = getColorCode('gray')
  const axisObj = axis ?? {}
  const merge = (key: 'x' | 'y') => ({ labelFill: ink, titleFill: ink, ...((axisObj[key] as Record<string, unknown> | undefined) ?? {}) })
  return { ...axisObj, x: merge('x'), y: merge('y') }
}
