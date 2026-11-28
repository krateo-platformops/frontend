import type { ThemeMode } from './tokens'

/**
 * The agent's own surfaces — the header toggle, the rail, the Button widget's `intent: agentiko`,
 * the Form's provenance tag. The whole portal wears Agentiko since 2026-11-06 (T11), so the
 * accent here equals the primary; what still sets the agent apart is the "sfumatura" — the brand
 * gradient violet → blue, left → right — which only the agent's filled controls and marks use.
 *
 * Filled agent controls use the BRAND colours in both modes under a WHITE label: the brand manual
 * puts white on violet, blue and the gradient, never dark ink (white is 5.4:1 on #9E00FF and
 * 11.5:1 on #2213CF). `accent` is the violet as TEXT or a thin line: the brand violet on light
 * ground, the tint #C27AFF on dark ground, where #9E00FF is only 3.6:1. The `gradient*` pair is
 * for marks and hairlines on the page ground, tinted in dark mode for the same reason (the brand
 * blue on the dark ground is 1.9:1); `fillStart`/`fillEnd` are the brand gradient itself, for
 * fills. Not tenant-overridable (the Theme widget does not touch it): it is a product mark.
 */
export const agentikoBrand: Record<ThemeMode, {
  accent: string
  accentHover: string
  accentActive: string
  onAccent: string
  subtle: string
  border: string
  gradientStart: string
  gradientEnd: string
  fillStart: string
  fillEnd: string
  onFill: string
}> = {
  dark: {
    accent: '#C27AFF',
    accentActive: '#B35CFF',
    accentHover: '#CF94FF',
    border: 'rgba(194, 122, 255, 0.45)',
    fillEnd: '#2213CF',
    fillStart: '#9E00FF',
    gradientEnd: '#9C8FFF',
    gradientStart: '#C27AFF',
    onAccent: '#141414',
    onFill: '#FFFFFF',
    subtle: 'rgba(158, 0, 255, 0.18)',
  },
  light: {
    accent: '#9E00FF',
    accentActive: '#7200B8',
    accentHover: '#8700DB',
    border: '#DCD8F1',
    fillEnd: '#2213CF',
    fillStart: '#9E00FF',
    gradientEnd: '#2213CF',
    gradientStart: '#9E00FF',
    onAccent: '#FFFFFF',
    onFill: '#FFFFFF',
    subtle: '#F4EEFF',
  },
}

export const agentikoSemantic = (mode: ThemeMode): Record<string, string> => {
  const ap = agentikoBrand[mode]
  return {
    'color-agentiko-accent': ap.accent,
    'color-agentiko-accent-active': ap.accentActive,
    'color-agentiko-accent-hover': ap.accentHover,
    'color-agentiko-border': ap.border,
    'color-agentiko-fill-end': ap.fillEnd,
    'color-agentiko-fill-start': ap.fillStart,
    'color-agentiko-gradient-end': ap.gradientEnd,
    'color-agentiko-gradient-start': ap.gradientStart,
    'color-agentiko-on-accent': ap.onAccent,
    'color-agentiko-on-fill': ap.onFill,
    'color-agentiko-subtle': ap.subtle,
  }
}
