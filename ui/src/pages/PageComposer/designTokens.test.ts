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

  it('uses only spacing steps that exist on the scale', () => {
    const steps = new Set<number>([0, ...Object.values(spacing)])
    const offenders = sources.flatMap(([file, text]) =>
      [...code(text).matchAll(/\b(?:padding|paddingLeft|paddingBlock|margin|marginLeft|marginBottom|marginBlockStart|gap):\s*(\d+)/g)]
        .filter((match) => !steps.has(Number(match[1])))
        .map((match) => `${file}: ${match[0]}`))
    expect(offenders).toEqual([])
  })
})
