/* eslint-disable sort-keys/sort-keys-fix */
// Token scales are ordered semantically (xs → xl, token before components), not alphabetically.
import { generate } from '@ant-design/colors'
import { theme as antdAlgorithms, type ThemeConfig } from 'antd'

/**
 * Single source of truth for the design system. Everything else derives from
 * here: the antd `ThemeConfig` (`lightTheme` / `darkTheme`) and the `:root` CSS
 * custom properties (`cssVariables`) consumed by `*.module.css`.
 *
 * BRAND = "Krateo Brand Identity v2" (blue) — krateo-platformops/frontend issue #49.
 * Interaction blue: Krateo Blue #11B2E2 (dark primary #2FBFE6) / Sovereign Blue #05629A
 * (light primary + nav surface). Status is a Tier-2-locked semantic set: green #00D690,
 * amber #FFAA00, red #F84C4C, info blue. Signal Yellow #E8FF00 is RESERVED for the
 * "Autopilot/AI agent is EXECUTING" state ONLY (never a CTA/decoration/link). The sidebar rail
 * gradient is DERIVED per-mode from colorPrimary (issue #52, navGradient()); the focus ring is #2FBFE6
 * (dark) / #05629A (light). Values retargeted onto the fork's runtime emitter (this file →
 * `cssVariables` + antd bridge). `cssVariables` now ALSO emits the canonical `--krateo-*` token
 * set (issue #49 §1.2–1.5: base + mode-aware semantic + chart) alongside the legacy `--*-color`
 * aliases; migrating component CSS from the aliases to `--krateo-*` is the deferred follow-up (§2).
 * The legacy key NAMES are unchanged so the toggle, CSS vars, antd ConfigProvider and
 * `getColorCode()` keep working — only the values changed (amber Petrol → blue v2).
 */

export type ThemeMode = 'light' | 'dark'

// Light mode — designed on its own terms (NOT a dark inversion). Sovereign-blue brand on a
// cool paper canvas; AA-tuned dark text. Status keys reused by widget CRs: green=success(teal-
// green), orange/warning=warning(amber), red/error=error(crimson), blue/primary/info=brand,
// cyan/teal=healthy accent, magenta/violet=drift/chart. Chart-cat anchors (teal/olive/slate)
// added for getColorCode() parity with the v2 chart palette.
export const color = {
  accent2: '#0E9488',
  accentSoft: '#E6F7FC',
  background: '#F5F5F5',
  blue: '#11B2E2',
  border: '#E1E3E8',
  dark: '#141414',
  darkBlue: '#05629A',
  // Status keys double as widget-CR Tag INK (getTagStyle), so in light mode they use the v2
  // AA-safe `-text` variants (≥4.5:1 as text), not the brighter fill/dot base (#DE3B3B/#009765/
  // #FFAA00, which are 3:1 non-text). Dark mode keeps the bright bases (they pass on the void).
  error: '#B92F2F',
  errorSoft: '#FEECEC',
  faint: '#7A7A7A',
  gray: '#5C5C5C',
  green: '#00744E',
  info: '#05629A',
  light: '#FFFFFF',
  lightgray: '#F5F5F5',
  line: '#E1E3E8',
  // Sovereign gradient — used by the LOGIN marketing panel only (Login.module.css). The APP
  // sidebar rail no longer uses these; it derives per-mode from colorPrimary (issue #52).
  menubgend: '#002F46',
  menubgstart: '#005D8B',
  menuitem: 'rgba(255,255,255,0.50)',
  menuitembg: 'rgba(17,178,226,0.40)',
  orange: '#8A5C00',
  panelbg: '#FBFBFB',
  primary: '#05629A',
  red: '#B92F2F',
  success: '#00744E',
  successSoft: '#E3FBF2',
  text: '#141414',
  violet: '#722ED1',
  warning: '#8A5C00',
  warningSoft: '#FFF6E0',
  // v2 status/chart language (explicit aliases for widget CR `color:` refs).
  cyan: '#0E9488',
  magenta: '#C13B7E',
  amber: '#8A5C00',
  gold: '#8A5C00',
  teal: '#0E9488',
  olive: '#879500',
  slate: '#5F7285',
} as const

/**
 * Dark mode — the deep-ink canvas. `background` = true black (app), `panelbg` = surface
 * (#141414 card), `light` = elevated (#1C1C1C popover/hover), `dark` = ink (#FFFFFF strongest
 * foreground). Brand = Krateo Blue (#2FBFE6 interactive); status brighter for the void.
 */
export const colorDark: Record<keyof typeof color, string> = {
  accent2: '#2CC5B9',
  accentSoft: 'rgba(17,178,226,0.16)',
  background: '#000000',
  blue: '#11B2E2',
  border: '#414141',
  dark: '#FFFFFF',
  darkBlue: '#05629A',
  error: '#F84C4C',
  errorSoft: '#401010',
  faint: '#7A7A7A',
  gray: '#A0A0A0',
  green: '#00D690',
  info: '#2FBFE6',
  light: '#1C1C1C',
  lightgray: '#1C1C1C',
  line: '#2A2A2A',
  menubgend: '#002F46',
  menubgstart: '#005D8B',
  menuitem: 'rgba(255,255,255,0.50)',
  menuitembg: 'rgba(17,178,226,0.40)',
  orange: '#FFAA00',
  panelbg: '#141414',
  primary: '#2FBFE6',
  red: '#F84C4C',
  success: '#00D690',
  successSoft: '#003323',
  text: '#FFFFFF',
  violet: '#9350DB',
  warning: '#FFAA00',
  warningSoft: '#3D2900',
  cyan: '#2CC5B9',
  magenta: '#E060A8',
  amber: '#FFAA00',
  gold: '#FFAA00',
  teal: '#2CC5B9',
  olive: '#AEC000',
  slate: '#8496AD',
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const

// v2 radii: 2 (sm) / 4 (md, default) / 8 (lg) / 12 (xl).
export const radius = { sm: 2, md: 4, lg: 8, xl: 12 } as const

// #86 §0.10: the single source for the app-chrome header height. The main header (Layout.module.css)
// and the docked Autopilot rail header (AutopilotRail.module.css) both consumed a hardcoded `64px`
// that only COINCIDENTALLY matched; emitting `--header-h` from here links them so a future change
// moves both together.
export const layout = { headerHeight: 64 } as const

/** Light elevation — soft, low-contrast shadows on a light canvas. */
export const elevation = {
  sm: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
  md: '0 4px 10px rgba(16,24,40,0.08)',
  lg: '0 12px 28px rgba(16,24,40,0.10)',
} as const

/** Dark elevation — near-flat; depth from the base→surface tint step, not drop shadows. */
export const elevationDark = {
  sm: '0 1px 2px rgba(0,0,0,0.45)',
  md: '0 2px 6px rgba(0,0,0,0.5)',
  lg: '0 10px 28px rgba(0,0,0,0.55)',
} as const

export const typography = {
  family: 'Inter, Roboto, "Helvetica Neue", Arial, "Noto Sans", system-ui, sans-serif',
  // Display = Barlow Condensed (H1 + big numerals); mono = JetBrains Mono (all data:
  // ids/counts/durations/versions/namespaces). Loaded via the index.html font <link>.
  display: '"Barlow Condensed", Inter, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, "Courier New", monospace',
  size: { xxs: 12, xs: 14, sm: 16, md: 18, lg: 24, xl: 30 },
  weight: { lighter: 300, light: 400, medium: 500, bold: 600, bolder: 700 },
} as const

export const motion = { fast: '0.12s', mid: '0.24s', slow: '0.4s' } as const

/**
 * Brand v2 canonical `--krateo-*` design tokens (issue #49 §1.2–1.5), emitted at runtime by
 * `cssVariables()` alongside the legacy `--*-color` aliases (the component-CSS migration to
 * `--krateo-*` is a deliberate follow-up per the issue §2 note). Mode-independent base tokens +
 * mode-aware semantic + chart sets. Names/values are verbatim from the issue spec.
 */
const KRATEO_BASE: Record<string, string> = {
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-6': '24px',
  'space-8': '32px',
  'space-12': '48px',
  'space-16': '64px',
  'space-24': '96px',
  'radius-none': '0',
  'radius-sm': '2px',
  'radius-md': '4px',
  'radius-lg': '8px',
  'radius-full': '999px',
  'motion-instant': '0ms',
  'motion-fast': '120ms',
  'motion-standard': '240ms',
  'motion-deliberate': '400ms',
  'motion-ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  'font-display': '"Barlow Condensed", sans-serif',
  'font-ui': 'Inter, Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  'font-mono': '"JetBrains Mono", "Courier New", monospace',
  'text-display': '64px',
  'text-h1': '40px',
  'text-h2': '30px',
  'text-h3': '22px',
  'text-h4': '17px',
  'text-body-lg': '18px',
  'text-body': '15px',
  'text-body-sm': '13px',
  'text-label': '13px',
  'text-caption': '12px',
  'text-code': '13px',
  'text-metric': '28px',
  // Nav-item colours are mode-independent (light text on the dark rail). The rail GRADIENT is
  // NOT hardcoded here — it is derived per-mode from colorPrimary (issue #52: the sidebar default
  // must FOLLOW the active theme, not be a mode-invariant hardcode); see navGradient() + its emit
  // in cssVariables().
  'nav-item': 'rgba(255, 255, 255, 0.50)',
  'nav-item-active': '#F5F5F5',
}

/**
 * OPT-IN helper (issue #52): derive a sidebar gradient from a `colorPrimary`. This is NO LONGER the
 * default rail appearance — per the issue maintainer's clarification the default rail equals
 * colorBgContainer (see cssVariables), so the sidebar blends with the app surface and has no colour
 * of its own. This helper stays exported for a tenant who *does* want the rail to track a custom
 * `colorPrimary`: `@ant-design/colors` generate() yields a 10-shade ramp and we take a deep pair
 * (dark enough for light nav text), mode-aware. Consumed by the Theme widget only when a tenant
 * opts in; a tenant Theme CR's `custom.sidebar` remains the explicit override.
 */
export const navGradientFrom = (primary: string, mode: ThemeMode): { start: string; end: string } => {
  const ramp = generate(primary)
  return mode === 'dark' ? { start: ramp[7], end: ramp[9] } : { start: ramp[6], end: ramp[8] }
}

export const navGradient = (mode: ThemeMode): { start: string; end: string } =>
  navGradientFrom(mode === 'dark' ? colorDark.primary : color.primary, mode)

const KRATEO_SEMANTIC_DARK: Record<string, string> = {
  'color-background-base': '#000000',
  'color-background-surface': '#141414',
  'color-background-elevated': '#1C1C1C',
  'color-background-selected': 'rgba(17, 178, 226, 0.16)',
  'color-background-hover': 'rgba(255, 255, 255, 0.06)',
  'color-border-subtle': '#2A2A2A',
  'color-border-strong': '#414141',
  'color-border-focus': '#2FBFE6',
  'color-text-default': '#FFFFFF',
  'color-text-secondary': '#A0A0A0',
  'color-text-muted': '#7A7A7A',
  'color-text-inverse': '#141414',
  'color-text-link': '#5CCDEB',
  'color-text-link-hover': '#8FDDF2',
  'color-action-primary': '#2FBFE6',
  'color-action-primary-hover': '#5CCDEB',
  'color-action-primary-active': '#11B2E2',
  'color-action-on-primary': '#141414',
  'color-agent-signal': '#E8FF00',
  'color-agent-signal-fill': '#E8FF00',
  'color-agent-on-signal': '#141414',
  'color-status-success': '#00D690',
  'color-status-success-subtle': '#003323',
  'color-status-success-border': '#00744E',
  'color-status-success-text': '#3EE0A6',
  'color-status-warning': '#FFAA00',
  'color-status-warning-subtle': '#3D2900',
  'color-status-warning-border': '#8A5C00',
  'color-status-warning-text': '#FFC240',
  'color-status-error': '#F84C4C',
  'color-status-error-subtle': '#401010',
  'color-status-error-border': '#8F2424',
  'color-status-error-text': '#F97A7A',
  'color-status-info': '#2FBFE6',
  'color-status-info-subtle': '#043F5F',
  'color-status-info-border': '#0A7194',
  'color-status-info-text': '#5CCDEB',
}

const KRATEO_SEMANTIC_LIGHT: Record<string, string> = {
  'color-background-base': '#F5F5F5',
  'color-background-surface': '#FBFBFB',
  'color-background-elevated': '#FFFFFF',
  'color-background-selected': '#E6F7FC',
  'color-background-hover': 'rgba(2, 47, 74, 0.05)',
  'color-border-subtle': '#E1E3E8',
  'color-border-strong': '#C9CCD3',
  'color-border-focus': '#05629A',
  'color-text-default': '#141414',
  'color-text-secondary': '#5C5C5C',
  'color-text-muted': '#7A7A7A',
  'color-text-inverse': '#FFFFFF',
  'color-text-link': '#0A7194',
  'color-text-link-hover': '#05629A',
  'color-action-primary': '#05629A',
  'color-action-primary-hover': '#04517F',
  'color-action-primary-active': '#034064',
  'color-action-on-primary': '#FFFFFF',
  'color-agent-signal': '#879500',
  'color-agent-signal-fill': '#E8FF00',
  'color-agent-on-signal': '#141414',
  'color-status-success': '#009765',
  'color-status-success-subtle': '#E3FBF2',
  'color-status-success-border': '#7DEBC2',
  'color-status-success-text': '#00744E',
  'color-status-warning': '#FFAA00',
  'color-status-warning-subtle': '#FFF6E0',
  'color-status-warning-border': '#FFD87F',
  'color-status-warning-text': '#8A5C00',
  'color-status-error': '#DE3B3B',
  'color-status-error-subtle': '#FEECEC',
  'color-status-error-border': '#FBA6A6',
  'color-status-error-text': '#B92F2F',
  'color-status-info': '#05629A',
  'color-status-info-subtle': '#E6F7FC',
  'color-status-info-border': '#8FDDF2',
  'color-status-info-text': '#0A7194',
}

const KRATEO_CHART_DARK: Record<string, string> = {
  'chart-cat-01': '#11B2E2',
  'chart-cat-02': '#FFAA00',
  'chart-cat-03': '#00D690',
  'chart-cat-04': '#9350DB',
  'chart-cat-05': '#F84C4C',
  'chart-cat-06': '#2CC5B9',
  'chart-cat-07': '#E060A8',
  'chart-cat-08': '#AEC000',
  'chart-cat-09': '#8496AD',
  'chart-cat-10': '#A0A0A0',
  'chart-seq-1': '#043F5F',
  'chart-seq-2': '#05629A',
  'chart-seq-3': '#0A7194',
  'chart-seq-4': '#0E93BB',
  'chart-seq-5': '#2FBFE6',
  'chart-seq-6': '#5CCDEB',
  'chart-seq-7': '#8FDDF2',
  'chart-div-1': '#F84C4C',
  'chart-div-2': '#C4504B',
  'chart-div-3': '#7A4441',
  'chart-div-4': '#414141',
  'chart-div-5': '#2A6076',
  'chart-div-6': '#1A89AE',
  'chart-div-7': '#11B2E2',
}

const KRATEO_CHART_LIGHT: Record<string, string> = {
  'chart-cat-01': '#0E93BB',
  'chart-cat-02': '#DB9200',
  'chart-cat-03': '#009765',
  'chart-cat-04': '#722ED1',
  'chart-cat-05': '#DE3B3B',
  'chart-cat-06': '#0E9488',
  'chart-cat-07': '#C13B7E',
  'chart-cat-08': '#879500',
  'chart-cat-09': '#5F7285',
  'chart-cat-10': '#7A7A7A',
  'chart-seq-1': '#E6F7FC',
  'chart-seq-2': '#C2ECF8',
  'chart-seq-3': '#8FDDF2',
  'chart-seq-4': '#5CCDEB',
  'chart-seq-5': '#2FBFE6',
  'chart-seq-6': '#0E93BB',
  'chart-seq-7': '#05629A',
  'chart-div-1': '#B92F2F',
  'chart-div-2': '#DE3B3B',
  'chart-div-3': '#F97A7A',
  'chart-div-4': '#E1E3E8',
  'chart-div-5': '#5CCDEB',
  'chart-div-6': '#0E93BB',
  'chart-div-7': '#05629A',
}

export const tokens = { color, elevation, motion, radius, spacing, typography } as const

/** Per-component overrides. Tight density (32px controls), v2 radii, near-flat cards. */
const buildComponents = (palette: Record<keyof typeof color, string>, mode: ThemeMode): ThemeConfig['components'] => ({
  Button: {
    borderRadius: radius.md,
    controlHeight: 32,
    fontWeight: typography.weight.bold,
    primaryShadow: 'none',
    // WCAG AA (brand v2): the primary-button label is `colorTextLightSolid`. Light primary is
    // Sovereign #05629A — WHITE text yields ~6.5:1 (antd default, no override needed). DARK
    // primary is the bright Krateo Blue #2FBFE6 — white would be only ~2.2:1, so the label
    // flips to the DARK ink (surface #141414 = palette.panelbg) → ~8.3:1. The amber-era override
    // (dark-ink in LIGHT) is retired; the pairing is inverted for blue.
    ...(mode === 'dark' ? { colorTextLightSolid: palette.panelbg } : {}),
  },
  Card: {
    borderRadiusLG: radius.lg,
    boxShadowTertiary: mode === 'dark' ? elevationDark.sm : elevation.sm,
    paddingLG: 14,
  },
  DatePicker: { borderRadius: radius.md, controlHeight: 32 },
  Drawer: { paddingLG: spacing.lg },
  Input: { borderRadius: radius.md, controlHeight: 32 },
  List: { borderRadiusLG: radius.lg },
  // Sidebar nav density — `.nav-item` (~36px tall, bumped from 30 per issue #80 §0.5). NB: the
  // Menu.module.css item box is `height: auto`, so its 9px vertical padding is the effective lever;
  // this token is kept in sync for antd's own layout metrics (hover/selected backgrounds).
  Menu: { fontSize: 13, itemBorderRadius: radius.md, itemHeight: 36, itemMarginBlock: 0, itemPaddingInline: 9, subMenuItemBorderRadius: radius.md },
  Modal: { borderRadiusLG: radius.xl },
  Progress: { defaultColor: palette.green },
  Select: { borderRadius: radius.md, controlHeight: 32 },
  Statistic: { contentFontSize: 31, titleFontSize: 13 },
  Steps: { iconSize: 28 },
  // #72 §0.5 + #76 table cell padding: the reporters found the rows too TIGHT (Incidents + Alerts,
  // both `size: small`) and asked to INCREASE the vertical padding to the portal's spacing scale.
  // Nearly every portal Table is `size: small` → antd pads it with `cellPaddingBlockSM`, so that is
  // the effective lever; raised 6→8 (spacing.sm). `cellPaddingBlock` (default size) also raised to
  // spacing.md (16) per the issue text (shared token; the portal has no default-size table today).
  // Middle (settings) tables keep antd's cellPaddingBlockMD.
  Table: { borderColor: palette.border, borderRadiusLG: radius.lg, cellPaddingBlock: 16, cellPaddingBlockSM: 8, headerBg: palette.lightgray, headerBorderRadius: radius.lg, headerColor: palette.gray, rowHoverBg: palette.light },
  Tabs: { horizontalItemGutter: 24 },
  Tag: { borderRadiusSM: radius.sm },
})

/** Light antd theme (brand v2 blue). compactAlgorithm = the instrument-density pass. */
export const lightTheme: ThemeConfig = {
  algorithm: [antdAlgorithms.defaultAlgorithm, antdAlgorithms.compactAlgorithm],
  token: {
    borderRadius: radius.md,
    boxShadow: elevation.md,
    boxShadowSecondary: elevation.lg,
    colorBgBase: color.background,
    colorBgContainer: color.panelbg,
    colorBgElevated: color.light,
    colorBgLayout: color.background,
    colorBorder: color.border,
    colorBorderSecondary: '#C9CCD3',
    colorError: color.error,
    colorInfo: color.info,
    colorLink: '#0A7194',
    colorPrimary: color.primary,
    colorSuccess: color.success,
    colorTextBase: color.text,
    colorWarning: color.warning,
    colorWhite: color.light,
    controlHeight: 32,
    fontFamily: typography.family,
    motionDurationMid: motion.mid,
    motionDurationSlow: motion.slow,
  },
  components: buildComponents(color, 'light'),
}

/** Dark antd theme (brand v2 blue) — antd dark + compact + Krateo-blue / status overrides. */
export const darkTheme: ThemeConfig = {
  algorithm: [antdAlgorithms.darkAlgorithm, antdAlgorithms.compactAlgorithm],
  token: {
    borderRadius: radius.md,
    boxShadow: elevationDark.md,
    boxShadowSecondary: elevationDark.lg,
    colorBgBase: colorDark.background,
    colorBgContainer: colorDark.panelbg,
    colorBgElevated: colorDark.light,
    colorBgLayout: colorDark.background,
    colorBorder: colorDark.border,
    colorBorderSecondary: colorDark.line,
    colorError: colorDark.error,
    colorInfo: colorDark.info,
    colorLink: '#5CCDEB',
    colorPrimary: colorDark.primary,
    colorSuccess: colorDark.success,
    colorTextBase: colorDark.text,
    colorWarning: colorDark.warning,
    controlHeight: 32,
    fontFamily: typography.family,
    motionDurationMid: motion.mid,
    motionDurationSlow: motion.slow,
  },
  components: buildComponents(colorDark, 'dark'),
}

/** Back-compat alias (was the single light theme). */
export const antdTheme = lightTheme

/** Resolve the antd theme for a mode. */
export const getAntdTheme = (mode: ThemeMode): ThemeConfig => (mode === 'dark' ? darkTheme : lightTheme)

/** Inject every token as a CSS custom property on `:root` for the given mode. */
export const cssVariables = (mode: ThemeMode = 'light') => {
  const root = document.documentElement
  const palette = mode === 'dark' ? colorDark : color
  const elevationSet = mode === 'dark' ? elevationDark : elevation

  // Legacy `--*-color` / `--spacing-*` / … aliases (kept so existing component CSS works; the
  // migration of component CSS to `--krateo-*` is a follow-up per issue #49 §2).
  Object.entries(palette).forEach(([key, value]) => root.style.setProperty(`--${key}-color`, value))
  Object.entries(spacing).forEach(([key, value]) => root.style.setProperty(`--spacing-${key}`, `${value}px`))
  Object.entries(radius).forEach(([key, value]) => root.style.setProperty(`--radius-${key}`, `${value}px`))
  Object.entries(elevationSet).forEach(([key, value]) => root.style.setProperty(`--elevation-${key}`, value))
  Object.entries(motion).forEach(([key, value]) => root.style.setProperty(`--motion-${key}`, value))
  Object.entries(typography.size).forEach(([key, value]) => root.style.setProperty(`--font-size-${key}`, `${value}px`))
  Object.entries(typography.weight).forEach(([key, value]) => root.style.setProperty(`--font-weight-${key}`, `${value}`))
  root.style.setProperty('--font-family', typography.family)
  root.style.setProperty('--font-display', typography.display)
  root.style.setProperty('--font-mono', typography.mono)
  // #86 §0.10: shared app-chrome header height (main header + Autopilot rail header).
  root.style.setProperty('--header-h', `${layout.headerHeight}px`)

  // Canonical Brand v2 `--krateo-*` tokens (issue #49 §1.2–1.5): base (mode-independent) +
  // mode-aware semantic + chart. `data-theme` is set by ThemeModeContext; these are emitted
  // imperatively so a tenant Theme CR can re-emit overrides at runtime.
  const krateoSemantic = mode === 'dark' ? KRATEO_SEMANTIC_DARK : KRATEO_SEMANTIC_LIGHT
  const krateoChart = mode === 'dark' ? KRATEO_CHART_DARK : KRATEO_CHART_LIGHT
  Object.entries(KRATEO_BASE).forEach(([key, value]) => root.style.setProperty(`--krateo-${key}`, value))
  Object.entries(krateoSemantic).forEach(([key, value]) => root.style.setProperty(`--krateo-${key}`, value))
  Object.entries(krateoChart).forEach(([key, value]) => root.style.setProperty(`--krateo-${key}`, value))

  // Sidebar rail — issue #52 (per the maintainer's clarification on the issue): the DEFAULT rail
  // has NO colour of its own; it equals colorBgContainer (the app surface = palette.panelbg),
  // emitted flat (identical stops) so the two-stop shape is unchanged but renders flat and the rail
  // blends into the rest of the app. Nav text follows the mode too — light text would vanish on the
  // light-mode surface. The LOGIN marketing panel keeps the Sovereign gradient via the SEPARATE
  // --menubgstart/end-color aliases (Login.module.css); those are deliberately left untouched here.
  // A tenant Theme CR's custom.sidebar overrides the rail at runtime (inline style wins);
  // navGradient()/navGradientFrom() stay exported as an OPT-IN helper for a tenant who wants the
  // rail to track a custom colorPrimary (no longer the default — issue #52 comment).
  const railBg = palette.panelbg
  root.style.setProperty('--krateo-nav-gradient-start', railBg)
  root.style.setProperty('--krateo-nav-gradient-end', railBg)
  const navItem = mode === 'dark' ? 'rgba(255, 255, 255, 0.62)' : 'rgba(0, 0, 0, 0.62)'
  const navItemActive = mode === 'dark' ? '#F5F5F5' : palette.text
  root.style.setProperty('--menuitem-color', navItem)
  root.style.setProperty('--krateo-nav-item', navItem)
  root.style.setProperty('--krateo-nav-item-active', navItemActive)
}
