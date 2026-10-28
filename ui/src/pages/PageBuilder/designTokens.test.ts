/**
 * The composer's inline styles obey the token rules — because NOTHING ELSE CHECKS THEM.
 *
 * `design/lint/lint-css-tokens.py` reads `.module.css`. The composer does most of its styling in
 * `style={{ … }}` inside TSX, which that lint never sees, so T1 (colour comes from a token, never a
 * hex literal) and T4 (spacing resolves to the scale) were unenforced here and both had drifted.
 *
 * WHAT DRIFTED, AND WHY IT WAS INVISIBLE. The canvas read its colours from
 * `var(--krateo-canvas-accept, #11B2E2)` and two siblings. Those three tokens are emitted by
 * nothing — `cssVariables()` emits 197 and none of them is a `--krateo-canvas-*` — so every canvas
 * colour resolved to its hardcoded fallback. The `var()` wrapper made it LOOK tokenised while the
 * canvas silently ignored the theme: identical in light and dark, and deaf to a tenant Theme CR.
 * A hex literal announces itself; a fallback behind a token that does not exist does not.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { color, radius, spacing } from '../../theme/tokens'

const DIR = __dirname
const sources = readdirSync(DIR)
  .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
  .map((file) => [file, readFileSync(join(DIR, file), 'utf8')] as const)

/** Strip comments — an issue reference like `#304` is not a colour, and a doc block may quote one. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the composer styles from tokens (T1, T4)', () => {
  it('uses NO colour literal in an inline style', () => {
    const offenders = sources.flatMap(([file, text]) =>
      (code(text).match(/#[0-9A-Fa-f]{6}\b|rgba?\([\d.,\s]+\)/g) ?? []).map((hit) => `${file}: ${hit}`))
    expect(offenders).toEqual([])
  })

  it('references only CSS variables the theme actually EMITS', () => {
    // The whole defect in one assertion: a var() naming a token nothing emits is a hex literal
    // wearing a token's clothes, and it reads as correct in review.
    const emitted = new Set([
      ...Object.keys(color).map((key) => `--${key}-color`),
      ...Object.keys(spacing).map((key) => `--spacing-${key}`),
      ...Object.keys(radius).map((key) => `--radius-${key}`),
    ])
    const phantom = sources.flatMap(([file, text]) =>
      [...code(text).matchAll(/var\((--[a-z0-9-]+)/g)]
        .map((match) => match[1])
        // `--krateo-*` are emitted imperatively from the KRATEO_* maps rather than from a plain
        // token record, so they are checked by prefix; everything else must be a known key.
        .filter((name) => !name.startsWith('--krateo-') && !emitted.has(name))
        .map((name) => `${file}: ${name}`))
    expect(phantom).toEqual([])
  })

  /*
   * A STATUS KEYWORD IS NOT A BADGE COLOUR. `<Badge color='default'>` reads as "neutral" and renders
   * RED: antd's `isPresetColor(color, false)` tests the thirteen HUE presets (blue, cyan, gold …),
   * and the five STATUS keywords — success, processing, error, default, warning — are a different
   * set that it does not consult. A non-preset value falls through to `style.background = color`,
   * so the component emits `background: default`, the browser drops it as invalid, and the badge
   * keeps antd's default red. Nothing errors and nothing warns.
   *
   * The composer shipped that on the Objects count for three releases: a red pill reading "3" next
   * to the word Objects, which says three things are wrong with a page where nothing is. Red is
   * exception-only — see the status-indicator rule — so this asserts the mistake cannot return by
   * the same silent route.
   */
  it('passes NO antd status keyword as a Badge or Tag `color`', () => {
    const statusKeywords = ['default', 'processing']
    const offenders = sources.flatMap(([file, text]) =>
      [...code(text).matchAll(/<(Badge|Tag)\b[^>]*?\scolor='([a-z]+)'/g)]
        .filter((match) => statusKeywords.includes(match[2]))
        .map((match) => `${file}: <${match[1]} color='${match[2]}'>`))
    expect(offenders).toEqual([])
  })

  it('uses only spacing steps that exist on the scale', () => {
    const steps = new Set<number>([0, ...Object.values(spacing)])
    const offenders = sources.flatMap(([file, text]) =>
      [...code(text).matchAll(/\b(?:padding|paddingLeft|paddingBlock|margin|marginLeft|marginBottom|marginBlockStart|gap):\s*(\d+)/g)]
        .filter((match) => !steps.has(Number(match[1])))
        .map((match) => `${file}: ${match[0]}`))
    expect(offenders).toEqual([])
  })
})
