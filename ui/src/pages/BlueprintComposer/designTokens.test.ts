/**
 * The Blueprint Composer styles from tokens (T1, T4) — the Page Composer's design-token test, held
 * to this directory, plus the one check its stylesheet needs that the CSS lint does not make.
 *
 * `design/lint/lint-css-tokens.py` reads `.module.css` for hex literals, off-scale spacing and
 * font sizes, and resolves a `var()` only inside a font-size. It never reads TSX, and it does not
 * ask whether a COLOUR var names anything: `var(--accentsoft-color)` — one letter's case away from
 * the real `--accentSoft-color` — would pass it and paint nothing, in both themes, silently. The
 * composer draws every state of the machine from those colour vars, so a dead one is a state the
 * canvas cannot show. Hence: every var() here, in TSX and CSS alike, must be one the theme emits.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { color, elevation, motion, radius, spacing, typography } from '../../theme/tokens'

const DIR = __dirname
const read = (suffix: string, exclude?: string) => readdirSync(DIR)
  .filter((file) => file.endsWith(suffix) && !(exclude && file.endsWith(exclude)))
  .map((file) => [file, readFileSync(join(DIR, file), 'utf8')] as const)
const sources = read('.tsx', '.test.tsx').filter(([file]) => file !== 'blueprintTestHarness.tsx')
const stylesheets = read('.module.css')

/** Strip comments — an issue reference like `#367` is not a colour, and a doc block may quote one. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Every custom property `cssVariables()` emits under a fixed name (the `--krateo-*` maps are checked by prefix). */
const emitted = new Set([
  ...Object.keys(color).map((key) => `--${key}-color`),
  ...Object.keys(spacing).map((key) => `--spacing-${key}`),
  ...Object.keys(radius).map((key) => `--radius-${key}`),
  ...Object.keys(elevation).map((key) => `--elevation-${key}`),
  ...Object.keys(motion).map((key) => `--motion-${key}`),
  ...Object.keys(typography.size).map((key) => `--font-size-${key}`),
  ...Object.keys(typography.weight).map((key) => `--font-weight-${key}`),
  '--font-family', '--font-display', '--font-mono', '--header-h', '--header-icon-size',
])

const phantoms = (files: readonly (readonly [string, string])[]): string[] => files.flatMap(([file, text]) =>
  // Case-SENSITIVE names, case-insensitive capture: `--accentSoft-color` is the real one.
  [...code(text).matchAll(/var\((--[a-zA-Z0-9-]+)/g)]
    .map((match) => match[1])
    .filter((name) => !name.startsWith('--krateo-') && !emitted.has(name))
    .map((name) => `${file}: ${name}`))

describe('the blueprint composer styles from tokens (T1, T4)', () => {
  it('has sources to check — the filters did not silently match nothing', () => {
    expect(sources.map(([file]) => file)).toContain('BlueprintComposer.tsx')
    expect(stylesheets.map(([file]) => file).sort()).toEqual(['ArchitectureCanvas.module.css', 'BlueprintComposer.module.css'])
  })

  it('uses NO colour literal in an inline style or in the stylesheet', () => {
    const offenders = [...sources, ...stylesheets].flatMap(([file, text]) =>
      (code(text).match(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b|rgba?\([\d.,\s/%]+\)/g) ?? []).map((hit) => `${file}: ${hit}`))
    expect(offenders).toEqual([])
  })

  it('references only CSS variables the theme actually EMITS — in TSX and in CSS', () => {
    expect(phantoms(sources)).toEqual([])
    expect(phantoms(stylesheets)).toEqual([])
  })

  it('uses a known --krateo-* role for every type size (the canonical scale, T3)', () => {
    const sizes = stylesheets.flatMap(([file, text]) =>
      [...code(text).matchAll(/font-size:\s*([^;]+);/g)].map((match) => `${file}: ${match[1].trim()}`))
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.filter((size) => !/var\(--krateo-text-[a-z0-9-]+\)$/.test(size.split(': ')[1]))).toEqual([])
  })

  it('passes NO antd status keyword as a Badge or Tag `color` (it renders red)', () => {
    const offenders = sources.flatMap(([file, text]) =>
      [...code(text).matchAll(/<(Badge|Tag)\b[^>]*?\scolor='([a-z]+)'/g)]
        .filter((match) => ['default', 'processing'].includes(match[2]))
        .map((match) => `${file}: <${match[1]} color='${match[2]}'>`))
    expect(offenders).toEqual([])
  })

  it('uses only spacing steps that exist on the scale in inline styles', () => {
    const steps = new Set<number>([0, ...Object.values(spacing)])
    const offenders = sources.flatMap(([file, text]) =>
      [...code(text).matchAll(/\b(?:padding|paddingLeft|paddingBlock|margin|marginLeft|marginBottom|marginBlockStart|gap):\s*(\d+)/g)]
        .filter((match) => !steps.has(Number(match[1])))
        .map((match) => `${file}: ${match[0]}`))
    expect(offenders).toEqual([])
  })
})
