/**
 * A link in a `tone: secondary` Markdown is underlined (mockup v3's "Sign in"): in small muted text
 * colour alone is a weak cue (WCAG 1.4.1). Every other Markdown keeps the portal's link style
 * (Markdown.linkDecorationUnchanged).
 *
 * jsdom applies no stylesheet, so this reads the module's rule.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'Markdown.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('Markdown tone: secondary links', () => {
  it('are underlined', () => {
    const rule = css.match(/\.markdown\.secondary a\s*\{([^{}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/text-decoration:\s*underline;/)
  })
})
