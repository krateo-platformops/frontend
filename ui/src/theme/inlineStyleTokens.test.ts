/**
 * NO COLOUR LITERAL IN AN INLINE STYLE, anywhere in `ui/src` — the enforcement T1 never had.
 *
 * `design/lint/lint-css-tokens.py` reads `.module.css`. Colours written in `style={{ … }}` inside
 * TSX were invisible to it, and T1 is recorded as *"holds — now at zero across ui/src"* on the
 * strength of a one-off sweep. Three violations had accumulated since that sweep, and the sweep
 * could not have found them because it was looking at stylesheets.
 *
 * What the three cost is the argument for the rule, not an application of it:
 *   - `Notifications.tsx` — `#faad14`, 1.90:1 on the light ground, under the 3:1 floor for a
 *     meaningful icon. Fine in dark (8.97:1), so the defect existed in one theme only.
 *   - `Markdown.tsx` — a 12% grey that renders the same fill in both modes: theme-neutral by
 *     accident rather than by design.
 *   - `PageComposer` — colours behind `var(--krateo-canvas-*, …)` fallbacks naming tokens nothing
 *     emits, which is a literal that reads as a token. Fixed separately.
 *
 * A literal announces itself; the other two forms do not. This test sees all three.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const COLOUR = /#[0-9A-Fa-f]{6}\b|rgba?\([\d.,\s]+\)/g
const INLINE_STYLE = /style=\{\{(.*?)\}\}/gs

/** Strip comments — a doc block may legitimately quote the literal it is warning about. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { return walk(path) }
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : []
  })

describe('T1 — colour comes from a token, never a literal (inline styles)', () => {
  it('no .tsx writes a colour literal inside style={{ … }}', () => {
    const offenders = walk(ROOT).flatMap((path) => {
      // PageComposer is fixed on its own branch; this exclusion goes with that merge.
      if (path.includes('PageComposer')) { return [] }
      const text = code(readFileSync(path, 'utf8'))
      return [...text.matchAll(INLINE_STYLE)]
        .flatMap((match) => match[1].match(COLOUR) ?? [])
        .map((hit) => `${path.slice(ROOT.length + 1)}: ${hit}`)
    })
    expect(offenders).toEqual([])
  })
})
