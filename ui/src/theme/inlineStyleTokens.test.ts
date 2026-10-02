/**
 * INLINE STYLES ANSWER TO THE SAME TOKEN RULES AS STYLESHEETS — T1, T3 and T4 for TSX.
 *
 * `design/lint/lint-css-tokens.py` reads `.module.css`. A value written in `style={{ … }}` inside
 * TSX is invisible to it, so every rule it enforces had a way round it that no check could see:
 * put the declaration in the component instead of the stylesheet. That is not hypothetical —
 * this file began as a colour-only guard after three colour literals accumulated in TSX following
 * a sweep that declared T1 "at zero across ui/src". The sweep could not have found them because it
 * was looking at stylesheets. Spacing and font-size had the same hole and no guard at all.
 *
 * What the three colour literals cost is the argument for the rule, not an application of it:
 *   - `Notifications.tsx` — `#faad14`, 1.90:1 on the light ground, under the 3:1 floor for a
 *     meaningful icon. Fine in dark (8.97:1), so the defect existed in one theme only.
 *   - `Markdown.tsx` — a 12% grey that renders the same fill in both modes: theme-neutral by
 *     accident rather than by design.
 *   - `PageComposer` — colours behind `var(--krateo-canvas-*, …)` fallbacks naming tokens nothing
 *     emits, which is a literal that reads as a token.
 *
 * WHY AN AST AND NOT A REGEX. The previous guard matched `style=\{\{(.*?)\}\}`, which stops at the
 * first `}}` — so a nested object or a template literal ended the match early — and saw nothing in
 * a style object built outside JSX (`const s: CSSProperties = {…}`, a function returning
 * `CSSProperties`, antd's `styles={{ header: {…} }}`). Parsing with the TypeScript compiler already
 * in devDependencies costs nothing and sees all of them.
 *
 * WHAT COUNTS AS A VIOLATION mirrors the CSS lint, exemption for exemption:
 *   - colour (T1): a hex / rgb() / hsl() literal, or a named colour (`'white'`), anywhere in a
 *     style value — except as a `var(--x, fallback)` fallback, which is defensive, not hardcoded.
 *   - spacing (T4): a raw length on margin* / padding* / gap / rowGap / columnGap. `0`, `auto` and
 *     negative offsets are not spacing. `spacing.sm` or `var(--spacing-sm)` is the fix — a raw `8`
 *     that happens to equal a step still fails, as `8px` does in CSS, because a literal does not
 *     move when the scale does.
 *   - font-size (T3): a raw size. `1em`, `100%` and `inherit` restate the parent and are exempt.
 * An identifier, a property access (`token.marginXS`) or a call is a reference, not a literal, and
 * is left alone: this guard catches values someone typed, not values someone computed.
 *
 * THE BASELINE IS A DEBT LEDGER, same model as `design/lint/css-baseline.json`: per-file counts of
 * what predates the rule. A file above its count fails; so does a file BELOW it — the ledger only
 * shrinks, and a fix that is not recorded is debt that can quietly come back. Regenerate with
 *   UPDATE_INLINE_STYLE_BASELINE=1 npx vitest run src/theme/inlineStyleTokens.test.ts
 * and commit the diff; a reviewer then sees the debt move in the PR.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const BASELINE_PATH = join(__dirname, 'inline-style-baseline.json')

type Rule = 'colour' | 'font-size' | 'spacing'
type Hit = { file: string; line: number; prop: string; rule: Rule; value: string }

const SPACING_PROP = /^(margin|padding)|^(gap|rowGap|columnGap)$/
const FONT_SIZE_PROP = /^fontSize$/

const VAR_FALLBACK = /var\(\s*--[\w-]+\s*,[^)]*\)/g
const COLOUR_LITERAL = /#[0-9A-Fa-f]{3,8}\b|\b(rgba?|hsla?)\(/
// The named colours anyone actually types. The full CSS list is ~150 words, most of which are
// also ordinary English (`tan`, `linen`) and would only produce noise on a whole-value match.
const NAMED_COLOUR = /^(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|silver)$/i
const LENGTH = /(^|[^-\w.])\d*\.?\d+(px|rem|em|pt|vh|vw|%)?(?![\w-])/

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { return walk(path) }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
  })

/** The literal text a value can contribute, one entry per branch (`a ? '4px' : 8` → both). */
const literals = (node: ts.Expression): Array<string | number> => {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return literals(node.expression)
  }
  if (ts.isConditionalExpression(node)) { return [...literals(node.whenTrue), ...literals(node.whenFalse)] }
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
    return [...literals(node.left), ...literals(node.right)]
  }
  if (ts.isNumericLiteral(node)) { return [Number(node.text)] }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return [-Number(node.operand.text)]
  }
  if (ts.isStringLiteralLike(node)) { return [node.text] }
  // Only the typed parts of a template: `${spacing.sm}px` is a reference, `12px ${x}` is not.
  if (ts.isTemplateExpression(node)) { return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)] }
  return []
}

const isColour = (value: string | number): boolean => {
  if (typeof value !== 'string') { return false }
  const stripped = value.replace(VAR_FALLBACK, '')
  return COLOUR_LITERAL.test(stripped) || NAMED_COLOUR.test(stripped.trim())
}

/** A raw length that is not `0`, `auto` or a negative offset — the CSS lint's `_not_a_size`. */
const isRawSpacing = (value: string | number): boolean => {
  if (typeof value === 'number') { return value > 0 }
  const stripped = value.replace(/var\([^)]*\)/g, '').replace(/-\d*\.?\d+[a-z%]*/g, '')
  return stripped.split(/\s+/).some((part) => part !== '' && part !== '0' && LENGTH.test(part))
}

const isRawFontSize = (value: string | number): boolean => {
  if (typeof value === 'number') { return true }
  const trimmed = value.trim()
  if (['1em', '100%', 'inherit', ''].includes(trimmed)) { return false }
  return LENGTH.test(trimmed.replace(/var\([^)]*\)/g, ''))
}

const typeNamesCss = (type: ts.TypeNode | undefined): boolean =>
  type !== undefined && /\bCSSProperties\b/.test(type.getText())

/** Is this object literal a style object? JSX `style` / `*Style`, antd `styles`, or CSSProperties-typed. */
const styleDepth = (node: ts.ObjectLiteralExpression): 'style' | 'styles' | null => {
  let { parent } = node
  while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) {
    if ((ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) && typeNamesCss(parent.type)) { return 'style' }
    ({ parent } = parent)
  }
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
    const name = parent.parent.name.getText()
    if (name === 'styles') { return 'styles' }
    return name === 'style' || name.endsWith('Style') ? 'style' : null
  }
  if (ts.isVariableDeclaration(parent) && typeNamesCss(parent.type)) { return 'style' }
  if (ts.isPropertyAssignment(parent) && ts.isObjectLiteralExpression(parent.parent) && styleDepth(parent.parent) === 'styles') {
    return 'style'
  }
  // `(): CSSProperties => ({…})` or `function f(): CSSProperties { return {…} }`
  const fn = ts.isReturnStatement(parent) ? ts.findAncestor(parent, ts.isFunctionLike) : parent
  if (fn && ts.isFunctionLike(fn) && typeNamesCss(fn.type)) { return 'style' }
  return null
}

const scan = (file: string, text: string): Hit[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const hits: Hit[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && styleDepth(node) === 'style') {
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) { continue }
        const prop = property.name.getText().replace(/^['"]|['"]$/g, '')
        const line = source.getLineAndCharacterOfPosition(property.getStart()).line + 1
        for (const value of literals(property.initializer)) {
          const record = (rule: Rule) => hits.push({ file, line, prop, rule, value: String(value) })
          if (isColour(value)) { record('colour') }
          if (SPACING_PROP.test(prop) && isRawSpacing(value)) { record('spacing') }
          if (FONT_SIZE_PROP.test(prop) && isRawFontSize(value)) { record('font-size') }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return hits
}

type Ledger = Record<Rule, Record<string, number>>

const ledger = (hits: Hit[]): Ledger => {
  const out: Ledger = { colour: {}, 'font-size': {}, spacing: {} }
  for (const { file, rule } of hits) { out[rule][file] = (out[rule][file] ?? 0) + 1 }
  return out
}

const sorted = (record: Record<string, number>) =>
  Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)))

const hits = walk(ROOT).flatMap((path) => scan(path.slice(ROOT.length + 1), readFileSync(path, 'utf8')))
const current = ledger(hits)

if (process.env.UPDATE_INLINE_STYLE_BASELINE) {
  const out = Object.fromEntries(Object.entries(current).map(([rule, files]) => [rule, sorted(files)]))
  writeFileSync(BASELINE_PATH, `${JSON.stringify(out, null, 2)}\n`)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Ledger

describe('T1 / T3 / T4 — inline styles use tokens, not literals', () => {
  for (const rule of ['colour', 'spacing', 'font-size'] as const) {
    it(`${rule}: no file is above its baseline`, () => {
      const over = hits
        .filter((hit) => hit.rule === rule && (current[rule][hit.file] ?? 0) > (baseline[rule][hit.file] ?? 0))
        .map(({ file, line, prop, value }) => `${file}:${line} ${prop}: ${value}`)
      expect(over, 'use a token (spacing.*, var(--spacing-*), var(--krateo-text-*), a colour token)').toEqual([])
    })

    it(`${rule}: the baseline records every fix (it only shrinks)`, () => {
      const stale = Object.entries(baseline[rule])
        .filter(([file, count]) => (current[rule][file] ?? 0) < count)
        .map(([file, count]) => `${file}: baseline ${count}, now ${current[rule][file] ?? 0}`)
      expect(stale, 'debt went down — run with UPDATE_INLINE_STYLE_BASELINE=1 and commit the ledger').toEqual([])
    })
  }

  // The scanner itself: a check that has stopped firing is worse than no check.
  it('fires on each form it claims to see, and stays silent on references', () => {
    const fixture = `
      import type { CSSProperties } from 'react'
      const a = <div style={{ color: 'white', margin: 12, fontSize: '11px' }} />
      const b = <div style={{ padding: \`12px \${x}\`, gap: cond ? 6 : spacing.sm }} />
      const c: CSSProperties = { background: '#fff', marginTop: '4px 0' }
      const d = (): CSSProperties => ({ fontSize: 13 })
      const e = <Drawer styles={{ header: { paddingTop: 18 } }} />
      // silent from here down
      const f = <div style={{ color: token.colorText, margin: 0, padding: 'auto', marginTop: -1 }} />
      const g = <div style={{ gap: spacing.sm, fontSize: 'var(--krateo-text-caption)', color: 'var(--x, #fff)' }} />
      const h = <div style={{ width: 200, height: '100vh', fontSize: 'inherit' }} />
    `
    const found = scan('fixture.tsx', fixture).map(({ prop, rule, value }) => `${rule} ${prop}=${value}`)
    expect(found).toEqual([
      'colour color=white', 'spacing margin=12', 'font-size fontSize=11px',
      'spacing padding=12px ', 'spacing gap=6',
      'colour background=#fff', 'spacing marginTop=4px 0',
      'font-size fontSize=13',
      'spacing paddingTop=18',
    ])
  })
})
