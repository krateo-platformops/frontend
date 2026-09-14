// Minimal stand-in for ui/src/theme/tokens.ts, so the fixtures exercise the defined-property
// check rather than falling back to the blanket `var()` exemption. It must define every property
// the clean fixtures reference, or the check reports them and the fixture stops being clean.
export const spacing = { sm: 8, md: 16 }
export const color = { text: '#141414', gray: '#5C5C5C', panelbg: '#FFFFFF' }
export const typography = {
  family: 'Inter, sans-serif',
  size: { sm: 13, md: 15, lg: 18 },
  weight: { regular: 400, bold: 600 },
}
export const KRATEO_BASE = { 'text-body': '15px', 'text-caption': '12px' }

export const cssVariables = (mode: ThemeMode = 'light') => {
  const root = document.documentElement
  const palette = mode === 'dark' ? colorDark : color
  Object.entries(palette).forEach(([key, value]) => root.style.setProperty(`--${key}-color`, value))
  Object.entries(spacing).forEach(([key, value]) => root.style.setProperty(`--spacing-${key}`, `${value}px`))
  Object.entries(typography.size).forEach(([key, value]) => root.style.setProperty(`--font-size-${key}`, `${value}px`))
  Object.entries(typography.weight).forEach(([key, value]) => root.style.setProperty(`--font-weight-${key}`, `${value}`))
  Object.entries(KRATEO_BASE).forEach(([key, value]) => root.style.setProperty(`--krateo-${key}`, value))
}

const buildComponents = (palette: Record<string, string>, mode: ThemeMode): ThemeConfig['components'] => ({
  Button: {
    controlHeight: 32,
  },
})
