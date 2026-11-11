/**
 * WCAG 2.x contrast, for the few places that choose a colour at runtime rather than from a token:
 * an ink drawn on a fill that a CR names (a List row's icon disc). The token pairs themselves are
 * pinned in tokens.contrast.test.ts; this module is what code uses to pick between inks.
 */

type Channels = { a: number; b: number; g: number; r: number }

/** `#rgb`, `#rrggbb`, `rgb(r, g, b)` or `rgba(r, g, b, a)` → channels 0-255 and alpha 0-1. */
const parse = (value: string): Channels => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1]
    return { a: 1, b: parseInt(digits.slice(4, 6), 16), g: parseInt(digits.slice(2, 4), 16), r: parseInt(digits.slice(0, 2), 16) }
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim())
  if (rgb) {
    return { a: rgb[4] === undefined ? 1 : Number(rgb[4]), b: Number(rgb[3]), g: Number(rgb[2]), r: Number(rgb[1]) }
  }
  throw new Error(`unparseable colour ${value}`)
}

/** The opaque `#rrggbb` a (possibly translucent) colour renders as over an opaque ground. */
export const opaqueOver = (colour: string, ground: string): string => {
  const top = parse(colour)
  const under = parse(ground)
  const channel = (upper: number, lower: number) => Math.round(upper * top.a + lower * (1 - top.a)).toString(16).padStart(2, '0')
  return `#${channel(top.r, under.r)}${channel(top.g, under.g)}${channel(top.b, under.b)}`
}

const linear = (channel: number): number => {
  const unit = channel / 255
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
}

const luminance = (colour: string): number => {
  const { b, g, r } = parse(colour)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG contrast ratio of two opaque colours (1 to 21). */
export const contrastRatio = (first: string, second: string): number => {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}
